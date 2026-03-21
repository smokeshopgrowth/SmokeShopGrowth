'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const n8nService = require('../src/node/n8n_service');
const { jobs, makeJobId, pushLog, broadcast } = require('../services/sse');
const { runPipeline } = require('../services/pipeline');
const { webhookLimiter, pipelineRunLimiter } = require('../middleware/rate-limit');
const { apiKeyAuth } = require('../middleware/auth');
const db = require('../src/node/db');

// POST /api/run — start a pipeline job (requires auth)
router.post('/api/run', pipelineRunLimiter, apiKeyAuth, (req, res) => {
    let {
        city = '',
        bizType = 'smoke shop',
        maxResults = 100,
        skipLighthouse = true,
        generateDemo = true,
        exportSheets = false,
        sheetsId = '',
    } = req.body;

    // Validate city: 2-50 chars, alphanumeric + spaces and hyphens
    city = city.trim();
    const MIN_CITY_LEN = 2, MAX_CITY_LEN = 50;
    if (!city || city.length < MIN_CITY_LEN || city.length > MAX_CITY_LEN) {
        return res.status(400).json({ error: `City must be ${MIN_CITY_LEN}-${MAX_CITY_LEN} characters.` });
    }
    if (!/^[a-zA-Z0-9\s\-]+$/.test(city)) {
        return res.status(400).json({ error: 'City contains invalid characters (only letters, numbers, spaces, hyphens allowed).' });
    }

    if (typeof bizType !== 'string' || bizType.length > 100) {
        return res.status(400).json({ error: 'bizType must be a string (max 100 chars).' });
    }
    maxResults = Math.min(Math.max(parseInt(maxResults, 10) || 100, 1), 500);
    if (sheetsId && !/^[a-zA-Z0-9_-]+$/.test(sheetsId)) {
        return res.status(400).json({ error: 'Invalid sheetsId format.' });
    }

    const jobId = makeJobId();
    const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dataDir = path.join('data', citySlug);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync('logs', { recursive: true });

    const files = {
        leads: path.join(dataDir, 'leads.csv'),
        audited: path.join(dataDir, 'audited_leads.csv'),
        socialAudited: path.join(dataDir, 'social_audited.csv'),
        enriched: path.join(dataDir, 'enriched_leads.csv'),
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demos: path.join('public', 'demos', citySlug),
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', 'email_log.csv'),
        callLog: path.join('logs', 'call_log.csv'),
    };

    // Persist job to DB (Fix #10)
    try {
        db.insertJob.run({
            id: jobId, city, biz_type: bizType, status: 'running', step: 0,
            config: JSON.stringify({ maxResults, skipLighthouse, generateDemo, exportSheets, sheetsId }),
            files: JSON.stringify(files),
        });
    } catch (e) { /* ignore dup */ }

    jobs.set(jobId, {
        status: 'running',
        step: 0,
        logs: [],
        city, bizType, maxResults, skipLighthouse, citySlug, dataDir, files,
        exportSheets, sheetsId,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        generateDemo,
        clients: [],
    });

    n8nService.notifyPipelineEvent('started', { jobId, city, bizType });

    runPipeline(jobId).catch(err => {
        const job = jobs.get(jobId);
        if (job) {
            const errorDetails = `${err.message}\n${err.stack || ''}`;
            console.error('[PIPELINE ERROR]', err.stack || err);
            pushLog(jobId, `[ERROR] ${errorDetails}`, 'error');
            job.status = 'failed';
            job.error = err.message;
            broadcast(jobId, { type: 'done', status: 'failed', error: err.message });
        }
    });

    res.json({ jobId, dataDir, files });
});

// GET /api/status/:jobId — SSE stream for a job
router.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    job.logs.forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    if (job.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: job.status })}\n\n`);
        res.end();
        return;
    }

    job.clients.push(res);
    req.on('close', () => {
        job.clients = job.clients.filter(c => c !== res);
    });
});

// GET /api/download/:jobId/:file — download a result file
router.get('/api/download/:jobId/:file', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const fileMap = {
        leads: job.files.leads,
        audited: job.files.audited,
        socialAudited: job.files.socialAudited,
        outreach: job.files.outreach,
        demo: job.files.demo,
    };
    const filePath = fileMap[req.params.file];
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not ready.' });
    }

    res.download(filePath);
});

// GET /api/jobs — list finished jobs
router.get('/api/jobs', (req, res) => {
    const list = [];
    for (const [id, job] of jobs.entries()) {
        list.push({
            id, city: job.city, bizType: job.bizType,
            status: job.status, step: job.step,
            files: job.files,
        });
    }
    res.json(list.reverse());
});

// POST /api/lead — CRM lead capture webhook
router.post('/api/lead', webhookLimiter, (req, res) => {
    const { name, email, phone, city, outcome } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    const lead = {
        name: name || 'Unknown',
        email,
        phone: phone || '',
        city: city || '',
        outcome: outcome || 'interested',
        captured_at: new Date().toISOString(),
    };

    const leadsLogPath = path.join('logs', 'captured_leads.jsonl');
    fs.mkdirSync('logs', { recursive: true });
    fs.appendFileSync(leadsLogPath, JSON.stringify(lead) + '\n');

    console.log(`New lead captured: ${lead.name} — ${lead.email}`);
    n8nService.notifyLeadCapture(lead);

    res.json({ ok: true, lead });
});

// GET /api/leads — list captured leads (legacy CSV endpoint)
router.get('/api/leads/captured', (req, res) => {
    try {
        const csvPath = path.join(__dirname, '..', 'data', 'submissions.csv');
        if (!fs.existsSync(csvPath)) return res.json({ leads: [] });

        const leads = [];
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', (row) => leads.push(row))
            .on('end', () => res.json({ leads }))
            .on('error', (err) => res.status(500).json({ error: 'Failed to parse CSV' }));
    } catch (err) {
        res.status(500).json({ error: 'Failed to read leads' });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// ADMIN DASHBOARD API ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/dashboard/stats — dashboard overview stats
router.get('/api/dashboard/stats', (req, res) => {
    try {
        const stats = db.getDashboardStats.get();
        res.json(stats);
    } catch (err) {
        console.error('[API] Dashboard stats error:', err);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// ── LEADS CRM ───────────────────────────────────────────────────────────────

// GET /api/leads — list all leads with pagination and filters
router.get('/api/leads', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const offset = (page - 1) * limit;
        const status = req.query.status || null;
        const city = req.query.city || null;
        const search = req.query.search || null;

        let leads, total;

        if (search) {
            const searchPattern = `%${search}%`;
            leads = db.searchLeads.all(searchPattern, searchPattern, searchPattern);
            total = leads.length;
        } else if (status && city) {
            leads = db.getLeadsByCityAndStatus.all(city, status);
            total = leads.length;
            leads = leads.slice(offset, offset + limit);
        } else if (status) {
            const countResult = db.getLeadsByStatusCount.get(status);
            total = countResult.total;
            leads = db.getLeadsByStatusPaginated.all(status, limit, offset);
        } else if (city) {
            const countResult = db.getLeadsByCityCount.get(city);
            total = countResult.total;
            leads = db.getLeadsByCityPaginated.all(city, limit, offset);
        } else {
            const countResult = db.getLeadsCount.get();
            total = countResult.total;
            leads = db.getLeadsPaginated.all(limit, offset);
        }

        res.json({
            leads,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('[API] Leads list error:', err);
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
});

// GET /api/leads/:placeId — get single lead
router.get('/api/leads/:placeId', (req, res) => {
    try {
        const lead = db.getLeadByPlaceId.get(req.params.placeId);
        if (!lead) return res.status(404).json({ error: 'Lead not found' });
        res.json(lead);
    } catch (err) {
        console.error('[API] Lead get error:', err);
        res.status(500).json({ error: 'Failed to fetch lead' });
    }
});

// PUT /api/leads/:placeId — update lead
router.put('/api/leads/:placeId', (req, res) => {
    try {
        const existing = db.getLeadByPlaceId.get(req.params.placeId);
        if (!existing) return res.status(404).json({ error: 'Lead not found' });

        const { business_name, email, phone, status, score } = req.body;
        db.updateLead.run({
            place_id: req.params.placeId,
            business_name: business_name ?? existing.business_name,
            email: email ?? existing.email,
            phone: phone ?? existing.phone,
            status: status ?? existing.status,
            score: score ?? existing.score,
        });

        const updated = db.getLeadByPlaceId.get(req.params.placeId);
        res.json(updated);
    } catch (err) {
        console.error('[API] Lead update error:', err);
        res.status(500).json({ error: 'Failed to update lead' });
    }
});

// DELETE /api/leads/:placeId — delete lead
router.delete('/api/leads/:placeId', (req, res) => {
    try {
        const existing = db.getLeadByPlaceId.get(req.params.placeId);
        if (!existing) return res.status(404).json({ error: 'Lead not found' });

        db.deleteLead.run(req.params.placeId);
        res.json({ ok: true });
    } catch (err) {
        console.error('[API] Lead delete error:', err);
        res.status(500).json({ error: 'Failed to delete lead' });
    }
});

// POST /api/leads/bulk — bulk actions on leads
router.post('/api/leads/bulk', (req, res) => {
    try {
        const { action, placeIds, status } = req.body;
        if (!Array.isArray(placeIds) || placeIds.length === 0) {
            return res.status(400).json({ error: 'placeIds array is required' });
        }

        let affected = 0;
        if (action === 'updateStatus' && status) {
            for (const placeId of placeIds) {
                db.updateLeadStatus.run(status, placeId);
                affected++;
            }
        } else if (action === 'delete') {
            for (const placeId of placeIds) {
                db.deleteLead.run(placeId);
                affected++;
            }
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        res.json({ ok: true, affected });
    } catch (err) {
        console.error('[API] Bulk action error:', err);
        res.status(500).json({ error: 'Failed to perform bulk action' });
    }
});

// GET /api/leads/export/csv — export leads to CSV
router.get('/api/leads/export/csv', (req, res) => {
    try {
        const leads = db.getAllLeads.all();
        const headers = ['place_id', 'business_name', 'address', 'phone', 'email', 'website', 'rating', 'review_count', 'city_slug', 'score', 'status', 'created_at'];
        const csvRows = [headers.join(',')];
        
        for (const lead of leads) {
            const row = headers.map(h => {
                const val = lead[h] || '';
                return `"${String(val).replace(/"/g, '""')}"`;
            });
            csvRows.push(row.join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=leads_export.csv');
        res.send(csvRows.join('\n'));
    } catch (err) {
        console.error('[API] CSV export error:', err);
        res.status(500).json({ error: 'Failed to export leads' });
    }
});

// ── EMAIL CAMPAIGNS ─────────────────────────────────────────────────────────

// GET /api/campaigns — list all campaigns
router.get('/api/campaigns', (req, res) => {
    try {
        const campaigns = db.getAllCampaigns.all();
        // Attach stats to each campaign
        const campaignsWithStats = campaigns.map(c => {
            const stats = db.getCampaignStats.get(c.id);
            return { ...c, stats };
        });
        res.json({ campaigns: campaignsWithStats });
    } catch (err) {
        console.error('[API] Campaigns list error:', err);
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
});

// GET /api/campaigns/:id — get campaign with recipients
router.get('/api/campaigns/:id', (req, res) => {
    try {
        const campaign = db.getCampaign.get(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        const recipients = db.getCampaignRecipients.all(req.params.id);
        const stats = db.getCampaignStats.get(req.params.id);

        res.json({ ...campaign, recipients, stats });
    } catch (err) {
        console.error('[API] Campaign get error:', err);
        res.status(500).json({ error: 'Failed to fetch campaign' });
    }
});

// POST /api/campaigns — create new campaign
router.post('/api/campaigns', (req, res) => {
    try {
        const { name, subject, body, scheduled_at, recipientFilter } = req.body;
        if (!name || !subject || !body) {
            return res.status(400).json({ error: 'name, subject, and body are required' });
        }

        const result = db.insertCampaign.run({
            name,
            subject,
            body,
            status: scheduled_at ? 'scheduled' : 'draft',
            scheduled_at: scheduled_at || null,
        });

        const campaignId = result.lastInsertRowid;

        // Add recipients based on filter
        if (recipientFilter) {
            let leads;
            if (recipientFilter.status) {
                leads = db.getLeadsByStatus.all(recipientFilter.status);
            } else if (recipientFilter.city) {
                leads = db.getLeadsByCity.all(recipientFilter.city);
            } else {
                leads = db.getAllLeads.all();
            }

            // Filter leads with email
            const leadsWithEmail = leads.filter(l => l.email && l.email.includes('@'));
            const recipients = leadsWithEmail.map(l => ({
                campaign_id: campaignId,
                lead_id: l.place_id,
                status: 'pending',
            }));

            if (recipients.length > 0) {
                db.insertCampaignRecipientMany(recipients);
            }
        }

        const campaign = db.getCampaign.get(campaignId);
        res.json(campaign);
    } catch (err) {
        console.error('[API] Campaign create error:', err);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// PUT /api/campaigns/:id — update campaign
router.put('/api/campaigns/:id', (req, res) => {
    try {
        const existing = db.getCampaign.get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Campaign not found' });

        if (existing.status === 'sent' || existing.status === 'sending') {
            return res.status(400).json({ error: 'Cannot edit sent/sending campaign' });
        }

        const { name, subject, body, scheduled_at } = req.body;
        db.updateCampaign.run({
            id: req.params.id,
            name: name ?? existing.name,
            subject: subject ?? existing.subject,
            body: body ?? existing.body,
            status: scheduled_at ? 'scheduled' : 'draft',
            scheduled_at: scheduled_at || null,
        });

        const campaign = db.getCampaign.get(req.params.id);
        res.json(campaign);
    } catch (err) {
        console.error('[API] Campaign update error:', err);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

// POST /api/campaigns/:id/send — send campaign (mock for now)
router.post('/api/campaigns/:id/send', (req, res) => {
    try {
        const campaign = db.getCampaign.get(req.params.id);
        if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

        if (campaign.status === 'sent') {
            return res.status(400).json({ error: 'Campaign already sent' });
        }

        // Mark as sending then sent
        db.updateCampaignStatus.run('sending', null, req.params.id);

        // In production, this would trigger actual email sending
        // For now, we'll simulate by marking recipients as sent
        const recipients = db.getCampaignRecipients.all(req.params.id);
        const sentAt = new Date().toISOString();
        
        for (const r of recipients) {
            db.updateRecipientStatus.run('sent', sentAt, null, null, r.id);
        }

        db.updateCampaignStatus.run('sent', sentAt, req.params.id);

        res.json({ ok: true, sent: recipients.length });
    } catch (err) {
        console.error('[API] Campaign send error:', err);
        res.status(500).json({ error: 'Failed to send campaign' });
    }
});

// DELETE /api/campaigns/:id — delete campaign
router.delete('/api/campaigns/:id', (req, res) => {
    try {
        const existing = db.getCampaign.get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Campaign not found' });

        db.deleteCampaign.run(req.params.id);
        res.json({ ok: true });
    } catch (err) {
        console.error('[API] Campaign delete error:', err);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

// ── CALL CENTER LOG ─────────────────────────────────────────────────────────

// GET /api/calls — list all calls with pagination
router.get('/api/calls', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const offset = (page - 1) * limit;
        const outcome = req.query.outcome || null;

        let calls, total;

        if (outcome) {
            calls = db.getCallsByOutcome.all(outcome);
            total = calls.length;
            calls = calls.slice(offset, offset + limit);
        } else {
            const countResult = db.getCallsCount.get();
            total = countResult.total;
            calls = db.getCallsPaginated.all(limit, offset);
        }

        res.json({
            calls,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (err) {
        console.error('[API] Calls list error:', err);
        res.status(500).json({ error: 'Failed to fetch calls' });
    }
});

// GET /api/calls/:id — get single call
router.get('/api/calls/:id', (req, res) => {
    try {
        const call = db.getCall.get(req.params.id);
        if (!call) return res.status(404).json({ error: 'Call not found' });
        res.json(call);
    } catch (err) {
        console.error('[API] Call get error:', err);
        res.status(500).json({ error: 'Failed to fetch call' });
    }
});

// PUT /api/calls/:id — update call notes/outcome
router.put('/api/calls/:id', (req, res) => {
    try {
        const existing = db.getCall.get(req.params.id);
        if (!existing) return res.status(404).json({ error: 'Call not found' });

        const { outcome, summary } = req.body;
        db.updateCall.run(
            outcome ?? existing.outcome,
            summary ?? existing.summary,
            req.params.id
        );

        const updated = db.getCall.get(req.params.id);
        res.json(updated);
    } catch (err) {
        console.error('[API] Call update error:', err);
        res.status(500).json({ error: 'Failed to update call' });
    }
});

// ── PAYMENTS ────────────────────────────────────────────────────────────────

// GET /api/payments — list all payments with pagination
router.get('/api/payments', (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 25, 100);
        const offset = (page - 1) * limit;

        const countResult = db.getPaymentsCount.get();
        const payments = db.getPaymentsPaginated.all(limit, offset);

        res.json({
            payments,
            pagination: {
                page,
                limit,
                total: countResult.total,
                totalPages: Math.ceil(countResult.total / limit),
            },
        });
    } catch (err) {
        console.error('[API] Payments list error:', err);
        res.status(500).json({ error: 'Failed to fetch payments' });
    }
});

// GET /api/payments/stats — payment statistics
router.get('/api/payments/stats', (req, res) => {
    try {
        const stats = db.getPaymentStats.get();
        const byMonth = db.getPaymentStatsByMonth.all();
        const byCity = db.getPaymentStatsByCity.all();
        const byTier = db.getPaymentStatsByTier.all();
        const recent = db.getRecentPayments.all(5);

        res.json({
            ...stats,
            byMonth,
            byCity,
            byTier,
            recent,
        });
    } catch (err) {
        console.error('[API] Payment stats error:', err);
        res.status(500).json({ error: 'Failed to fetch payment stats' });
    }
});

// ── POST /api/run-single — run pipeline on one business (no scraping) ──────
router.post('/api/run-single', apiKeyAuth, pipelineRunLimiter, async (req, res) => {
    const {
        businessName,
        website,
        phone = '',
        city = '',
        generateDemo = true,
        makeCall = false,
        sendEmail = false,
    } = req.body || {};

    if (!businessName) return res.status(400).json({ error: 'businessName is required' });

    const jobId = `single-${Date.now()}`;
    const dataDir = path.join('data', jobId);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync('logs', { recursive: true });

    // Write a single-row leads CSV so the pipeline can use it
    const normalizedWebsite = website ? (website.startsWith('http') ? website : `https://${website}`) : '';
    const leadsPath = path.join(dataDir, 'leads.csv');
    fs.writeFileSync(leadsPath,
        `name,phone,website,city,address,rating,reviews,business_name\n` +
        `"${businessName}","${phone}","${normalizedWebsite}","${city}","","","","${businessName}"\n`
    );

    const files = {
        leads: leadsPath,
        audited: path.join(dataDir, 'audited_leads.csv'),
        socialAudited: path.join(dataDir, 'social_audited.csv'),
        enriched: path.join(dataDir, 'enriched_leads.csv'),
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demos: path.join('public', 'demos', jobId),
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', `email_log_${jobId}.csv`),
        callLog: path.join('logs', `call_log_${jobId}.csv`),
    };

    const job = {
        status: 'running',
        step: 0,
        logs: [],
        city: city || businessName,
        bizType: 'smoke shop',
        maxResults: 1,
        skipLighthouse: true,
        citySlug: jobId,
        dataDir,
        files,
        generateDemo,
        makeCall,
        sendEmail,
        exportSheets: false,
        sheetsId: null,
        baseUrl: `${req.protocol}://${req.get('host')}`,
    };

    jobs.set(jobId, job);
    res.json({ jobId, message: `Single-business pipeline started for "${businessName}"` });

    // Run async
    const { runSingleBusiness } = require('../services/pipeline');
    runSingleBusiness(jobId).catch(err => {
        pushLog(jobId, `❌ Pipeline error: ${err.message}`, 'error');
        job.status = 'error';
        broadcast(jobId, { type: 'error', message: err.message });
    });
});

module.exports = router;
