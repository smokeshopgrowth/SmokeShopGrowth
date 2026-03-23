'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const n8nService = require('../src/node/n8n_service');
const { jobs, makeJobId, pushLog, broadcast } = require('../services/sse');
const { runPipeline, runSingleBusiness } = require('../services/pipeline');
const { webhookLimiter, pipelineRunLimiter } = require('../middleware/rate-limit');
const { apiKeyAuth } = require('../middleware/auth');
const db = require('../src/node/db');
const { createLogger } = require('../utils/logger');
const { asyncHandler, NotFoundError, ValidationError } = require('../utils/errors');
const { validate, schemas } = require('../utils/validation');

const logger = createLogger('API');

// ════════════════════════════════════════════════════════════════════════════
// PIPELINE ROUTES
// ════════════════════════════════════════════════════════════════════════════

// POST /api/run — start a pipeline job (requires auth)
router.post('/api/run', pipelineRunLimiter, apiKeyAuth, asyncHandler(async (req, res) => {
    const validated = validate(req.body, schemas.pipelineRun);
    const {
        city,
        bizType,
        maxResults,
        skipLighthouse,
        generateDemo,
        exportSheets,
        sheetsId,
    } = validated;

    logger.info('Starting pipeline', { city, bizType, maxResults });

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

    // Persist job to DB
    try {
        db.insertJob.run({
            id: jobId,
            city,
            biz_type: bizType,
            status: 'running',
            step: 0,
            config: JSON.stringify({ maxResults, skipLighthouse, generateDemo, exportSheets, sheetsId }),
            files: JSON.stringify(files),
        });
    } catch (e) {
        logger.warn('Failed to persist job to DB', { error: e.message });
    }

    jobs.set(jobId, {
        status: 'running',
        step: 0,
        logs: [],
        city,
        bizType,
        maxResults,
        skipLighthouse,
        citySlug,
        dataDir,
        files,
        exportSheets,
        sheetsId,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        generateDemo,
        clients: [],
    });

    n8nService.notifyPipelineEvent('started', { jobId, city, bizType });

    runPipeline(jobId).catch(err => {
        const job = jobs.get(jobId);
        if (job) {
            const errorDetails = `${err.message}\n${err.stack || ''}`;
            logger.error('Pipeline failed', { jobId, error: err.message });
            pushLog(jobId, `[ERROR] ${errorDetails}`, 'error');
            job.status = 'failed';
            job.error = err.message;
            broadcast(jobId, { type: 'done', status: 'failed', error: err.message });
        }
    });

    res.json({ jobId, dataDir, files });
}));

// GET /api/status/:jobId — SSE stream for a job
router.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send existing logs
    job.logs.forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // If job is already done, close immediately
    if (job.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'done', status: job.status })}\n\n`);
        res.end();
        return;
    }

    // Add client to listeners
    job.clients.push(res);

    // Cleanup on close
    req.on('close', () => {
        job.clients = job.clients.filter(c => c !== res);
    });
});

// GET /api/download/:jobId/:file — download a result file
router.get('/api/download/:jobId/:file', asyncHandler(async (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
        throw new NotFoundError('Job');
    }

    const fileMap = {
        leads: job.files.leads,
        audited: job.files.audited,
        socialAudited: job.files.socialAudited,
        outreach: job.files.outreach,
        demo: job.files.demo,
    };

    const filePath = fileMap[req.params.file];
    if (!filePath || !fs.existsSync(filePath)) {
        throw new NotFoundError('File');
    }

    res.download(filePath);
}));

// GET /api/jobs — list finished jobs
router.get('/api/jobs', apiKeyAuth, (req, res) => {
    const list = [];
    for (const [id, job] of jobs.entries()) {
        list.push({
            id,
            city: job.city,
            bizType: job.bizType,
            status: job.status,
            step: job.step,
            files: job.files,
        });
    }
    res.json(list.reverse());
});

// ════════════════════════════════════════════════════════════════════════════
// LEAD CAPTURE & CRM
// ════════════════════════════════════════════════════════════════════════════

// POST /api/lead — CRM lead capture webhook
router.post('/api/lead', webhookLimiter, asyncHandler(async (req, res) => {
    const validated = validate(req.body, schemas.leadCapture);
    const { name, email, phone, city } = validated;
    const outcome = req.body.outcome || 'interested';

    const lead = {
        name,
        email,
        phone,
        city,
        outcome,
        captured_at: new Date().toISOString(),
    };

    const leadsLogPath = path.join('logs', 'captured_leads.jsonl');
    fs.mkdirSync('logs', { recursive: true });
    fs.appendFileSync(leadsLogPath, JSON.stringify(lead) + '\n');

    logger.info('New lead captured', { name, email });
    n8nService.notifyLeadCapture(lead);

    res.json({ ok: true, lead });
}));

// GET /api/leads — list all leads with pagination and filters
router.get('/api/leads', apiKeyAuth, asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;
    const city = req.query.city || null;
    const search = req.query.search || null;

    let leads, total;

    try {
        if (search) {
            const searchPattern = `%${search}%`;
            leads = db.searchLeads?.all(searchPattern, searchPattern, searchPattern) || [];
            total = leads.length;
        } else if (status && city) {
            leads = db.getLeadsByCityAndStatus?.all(city, status) || [];
            total = leads.length;
            leads = leads.slice(offset, offset + limit);
        } else if (status) {
            const countResult = db.getLeadsByStatusCount?.get(status) || { total: 0 };
            total = countResult.total;
            leads = db.getLeadsByStatusPaginated?.all(status, limit, offset) || [];
        } else if (city) {
            const countResult = db.getLeadsByCityCount?.get(city) || { total: 0 };
            total = countResult.total;
            leads = db.getLeadsByCityPaginated?.all(city, limit, offset) || [];
        } else {
            const countResult = db.getLeadsCount?.get() || { total: 0 };
            total = countResult.total;
            leads = db.getLeadsPaginated?.all(limit, offset) || [];
        }
    } catch (err) {
        logger.warn('Database query failed, falling back to empty results', { error: err.message });
        leads = [];
        total = 0;
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
}));

// GET /api/leads/:placeId — get single lead
router.get('/api/leads/:placeId', apiKeyAuth, asyncHandler(async (req, res) => {
    const lead = db.getLeadByPlaceId?.get(req.params.placeId);
    if (!lead) {
        throw new NotFoundError('Lead');
    }
    res.json(lead);
}));

// PUT /api/leads/:placeId — update lead
router.put('/api/leads/:placeId', apiKeyAuth, asyncHandler(async (req, res) => {
    const existing = db.getLeadByPlaceId?.get(req.params.placeId);
    if (!existing) {
        throw new NotFoundError('Lead');
    }

    const { business_name, email, phone, status, score } = req.body;
    db.updateLead?.run({
        place_id: req.params.placeId,
        business_name: business_name ?? existing.business_name,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        status: status ?? existing.status,
        score: score ?? existing.score,
    });

    const updated = db.getLeadByPlaceId?.get(req.params.placeId);
    res.json(updated);
}));

// DELETE /api/leads/:placeId — delete lead
router.delete('/api/leads/:placeId', apiKeyAuth, asyncHandler(async (req, res) => {
    const existing = db.getLeadByPlaceId?.get(req.params.placeId);
    if (!existing) {
        throw new NotFoundError('Lead');
    }

    db.deleteLead?.run(req.params.placeId);
    res.json({ ok: true });
}));

// POST /api/leads/bulk — bulk actions on leads
router.post('/api/leads/bulk', apiKeyAuth, asyncHandler(async (req, res) => {
    const { action, placeIds, status } = req.body;
    if (!Array.isArray(placeIds) || placeIds.length === 0) {
        throw new ValidationError('placeIds array is required');
    }

    let affected = 0;
    if (action === 'updateStatus' && status) {
        for (const placeId of placeIds) {
            db.updateLeadStatus?.run(status, placeId);
            affected++;
        }
    } else if (action === 'delete') {
        for (const placeId of placeIds) {
            db.deleteLead?.run(placeId);
            affected++;
        }
    } else {
        throw new ValidationError('Invalid action');
    }

    res.json({ ok: true, affected });
}));

// GET /api/leads/export/csv — export leads to CSV
router.get('/api/export/leads', apiKeyAuth, asyncHandler(async (req, res) => {
    const leads = db.getAllLeads?.all() || [];
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
}));

// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/dashboard/stats — dashboard overview stats
router.get('/api/dashboard/stats', apiKeyAuth, asyncHandler(async (req, res) => {
    try {
        const stats = db.getDashboardStats?.get() || {
            total_leads: 0,
            contacted: 0,
            converted: 0,
            avg_score: 0,
        };
        res.json(stats);
    } catch (err) {
        logger.warn('Failed to fetch dashboard stats', { error: err.message });
        res.json({
            total_leads: 0,
            contacted: 0,
            converted: 0,
            avg_score: 0,
        });
    }
}));

// GET /api/stats — get dashboard statistics
router.get('/api/stats', asyncHandler(async (req, res) => {
    const csvPath = path.join(__dirname, '..', 'data', 'submissions.csv');

    let leads = [];
    if (fs.existsSync(csvPath)) {
        await new Promise((resolve, reject) => {
            fs.createReadStream(csvPath)
                .pipe(csv())
                .on('data', (row) => leads.push(row))
                .on('end', resolve)
                .on('error', reject);
        });
    }

    const totalLeads = leads.length;
    const conversions = leads.filter(l => l.status === 'converted').length;
    const conversionRate = totalLeads > 0 ? (conversions / totalLeads * 100).toFixed(1) : 0;

    const tierPrices = { starter: 99, growth: 299, pro: 499 };
    const revenue = leads
        .filter(l => l.tier && l.status === 'converted')
        .reduce((sum, l) => sum + (tierPrices[l.tier?.toLowerCase()] || 0), 0);

    const scores = leads.filter(l => l.score).map(l => parseInt(l.score) || 0);
    const avgScore = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    const now = new Date();
    const weeklyData = [0, 0, 0, 0];
    leads.forEach(l => {
        const date = new Date(l.date || l.captured_at || now);
        const week = Math.min(3, Math.floor((now - date) / (7 * 24 * 60 * 60 * 1000)));
        weeklyData[3 - week]++;
    });

    const sources = { 'Google Maps': 0, 'Website Form': 0, 'Referral': 0, 'Social': 0 };
    leads.forEach(l => {
        const source = l.source || 'Website Form';
        if (sources[source] !== undefined) sources[source]++;
        else sources['Website Form']++;
    });

    res.json({
        totalLeads,
        conversions,
        conversionRate,
        revenue,
        avgScore,
        weeklyData,
        sources,
    });
}));

// ════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/campaigns — list all campaigns
router.get('/api/campaigns', apiKeyAuth, asyncHandler(async (req, res) => {
    const campaigns = db.getAllCampaigns?.all() || [];
    const campaignsWithStats = campaigns.map(c => {
        const stats = db.getCampaignStats?.get(c.id) || { sent: 0, opened: 0, clicked: 0 };
        return { ...c, stats };
    });
    res.json({ campaigns: campaignsWithStats });
}));

// GET /api/campaigns/:id — get campaign with recipients
router.get('/api/campaigns/:id', apiKeyAuth, asyncHandler(async (req, res) => {
    const campaign = db.getCampaign?.get(req.params.id);
    if (!campaign) {
        throw new NotFoundError('Campaign');
    }

    const recipients = db.getCampaignRecipients?.all(req.params.id) || [];
    const stats = db.getCampaignStats?.get(req.params.id) || {};

    res.json({ ...campaign, recipients, stats });
}));

// POST /api/campaigns — create new campaign
router.post('/api/campaigns', apiKeyAuth, asyncHandler(async (req, res) => {
    const { name, subject, body, scheduled_at, recipientFilter } = req.body;
    if (!name || !subject || !body) {
        throw new ValidationError('name, subject, and body are required');
    }

    const result = db.insertCampaign?.run({
        name,
        subject,
        body,
        status: scheduled_at ? 'scheduled' : 'draft',
        scheduled_at: scheduled_at || null,
    });

    const campaignId = result?.lastInsertRowid;
    if (!campaignId) {
        throw new Error('Failed to create campaign');
    }

    // Add recipients based on filter
    if (recipientFilter) {
        let leads = [];
        if (recipientFilter.status) {
            leads = db.getLeadsByStatus?.all(recipientFilter.status) || [];
        } else if (recipientFilter.city) {
            leads = db.getLeadsByCity?.all(recipientFilter.city) || [];
        } else {
            leads = db.getAllLeads?.all() || [];
        }

        const leadsWithEmail = leads.filter(l => l.email && l.email.includes('@'));
        for (const l of leadsWithEmail) {
            db.insertCampaignRecipient?.run({
                campaign_id: campaignId,
                lead_id: l.place_id,
                status: 'pending',
            });
        }
    }

    const campaign = db.getCampaign?.get(campaignId);
    res.json(campaign);
}));

// PUT /api/campaigns/:id — update campaign
router.put('/api/campaigns/:id', apiKeyAuth, asyncHandler(async (req, res) => {
    const existing = db.getCampaign?.get(req.params.id);
    if (!existing) {
        throw new NotFoundError('Campaign');
    }

    if (existing.status === 'sent' || existing.status === 'sending') {
        throw new ValidationError('Cannot edit sent/sending campaign');
    }

    const { name, subject, body, scheduled_at } = req.body;
    db.updateCampaign?.run({
        id: req.params.id,
        name: name ?? existing.name,
        subject: subject ?? existing.subject,
        body: body ?? existing.body,
        status: scheduled_at ? 'scheduled' : 'draft',
        scheduled_at: scheduled_at || null,
    });

    const campaign = db.getCampaign?.get(req.params.id);
    res.json(campaign);
}));

// POST /api/campaigns/:id/send — send campaign
router.post('/api/campaigns/:id/send', apiKeyAuth, asyncHandler(async (req, res) => {
    const campaign = db.getCampaign?.get(req.params.id);
    if (!campaign) {
        throw new NotFoundError('Campaign');
    }

    if (campaign.status === 'sent') {
        throw new ValidationError('Campaign already sent');
    }

    db.updateCampaignStatus?.run('sending', null, req.params.id);

    const recipients = db.getCampaignRecipients?.all(req.params.id) || [];
    const sentAt = new Date().toISOString();

    for (const r of recipients) {
        db.updateRecipientStatus?.run('sent', sentAt, null, null, r.id);
    }

    db.updateCampaignStatus?.run('sent', sentAt, req.params.id);

    res.json({ ok: true, sent: recipients.length });
}));

// DELETE /api/campaigns/:id — delete campaign
router.delete('/api/campaigns/:id', apiKeyAuth, asyncHandler(async (req, res) => {
    const existing = db.getCampaign?.get(req.params.id);
    if (!existing) {
        throw new NotFoundError('Campaign');
    }

    db.deleteCampaign?.run(req.params.id);
    res.json({ ok: true });
}));

// ════════════════════════════════════════════════════════════════════════════
// CALLS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/calls — list all calls with pagination
router.get('/api/calls', apiKeyAuth, asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;
    const outcome = req.query.outcome || null;

    let calls, total;

    try {
        if (outcome) {
            calls = db.getCallsByOutcome?.all(outcome) || [];
            total = calls.length;
            calls = calls.slice(offset, offset + limit);
        } else {
            const countResult = db.getCallsCount?.get() || { total: 0 };
            total = countResult.total;
            calls = db.getCallsPaginated?.all(limit, offset) || [];
        }
    } catch {
        calls = [];
        total = 0;
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
}));

// POST /api/call — initiate a quick call
router.post('/api/call', apiKeyAuth, webhookLimiter, asyncHandler(async (req, res) => {
    const validated = validate(req.body, schemas.quickCall);
    const { phone, business_name, city } = validated;

    logger.info('Initiating call', { phone, business_name });

    // Call ElevenLabs or VAPI
    const callId = `call-${Date.now()}`;

    // Log the call
    try {
        db.insertCall?.run({
            id: callId,
            phone,
            business_name: business_name || 'Unknown',
            city: city || '',
            outcome: 'pending',
            initiated_at: new Date().toISOString(),
        });
    } catch (e) {
        logger.warn('Failed to log call to DB', { error: e.message });
    }

    res.json({ ok: true, callId, message: 'Call initiated' });
}));

// ════════════════════════════════════════════════════════════════════════════
// SINGLE BUSINESS PIPELINE
// ════════════════════════════════════════════════════════════════════════════

// POST /api/single — run pipeline on one business (no scraping)
router.post('/api/single', apiKeyAuth, pipelineRunLimiter, asyncHandler(async (req, res) => {
    const {
        name: businessName,
        website,
        phone = '',
        city = '',
        placeCall = false,
    } = req.body;

    if (!businessName) {
        throw new ValidationError('Business name is required');
    }

    const jobId = `single-${Date.now()}`;
    const dataDir = path.join('data', jobId);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync('logs', { recursive: true });

    const normalizedWebsite = website ? (website.startsWith('http') ? website : `https://${website}`) : '';
    const leadsPath = path.join(dataDir, 'leads.csv');
    fs.writeFileSync(leadsPath,
        `name,phone,website,city,address,rating,reviews,business_name\n` +
        `"${businessName}","${phone}","${normalizedWebsite}","${city}","","","","${businessName}"\n`
    );

    const files = {
        leads: leadsPath,
        audited: path.join(dataDir, 'audited_leads.csv'),
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demos: path.join('public', 'demos', jobId),
        demo: path.join(dataDir, 'demo_leads.csv'),
    };

    jobs.set(jobId, {
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
        generateDemo: true,
        makeCall: placeCall,
        exportSheets: false,
        baseUrl: `${req.protocol}://${req.get('host')}`,
        clients: [],
    });

    logger.info('Starting single business pipeline', { businessName, jobId });

    // Run async
    runSingleBusiness(jobId).catch(err => {
        const job = jobs.get(jobId);
        if (job) {
            pushLog(jobId, `Pipeline error: ${err.message}`, 'error');
            job.status = 'error';
            broadcast(jobId, { type: 'error', message: err.message });
        }
    });

    res.json({ jobId, message: `Pipeline started for "${businessName}"` });
}));

// ════════════════════════════════════════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════════════════════════════════════════

// GET /api/payments — list all payments
router.get('/api/payments', apiKeyAuth, asyncHandler(async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 25, 100);
    const offset = (page - 1) * limit;

    const countResult = db.getPaymentsCount?.get() || { total: 0 };
    const payments = db.getPaymentsPaginated?.all(limit, offset) || [];

    res.json({
        payments,
        pagination: {
            page,
            limit,
            total: countResult.total,
            totalPages: Math.ceil(countResult.total / limit),
        },
    });
}));

// GET /api/payments/stats — payment statistics
router.get('/api/payments/stats', apiKeyAuth, asyncHandler(async (req, res) => {
    const stats = db.getPaymentStats?.get() || { total: 0, count: 0 };
    const byMonth = db.getPaymentStatsByMonth?.all() || [];
    const byCity = db.getPaymentStatsByCity?.all() || [];
    const byTier = db.getPaymentStatsByTier?.all() || [];
    const recent = db.getRecentPayments?.all(5) || [];

    res.json({
        ...stats,
        byMonth,
        byCity,
        byTier,
        recent,
    });
}));

module.exports = router;
