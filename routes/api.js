'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const n8nService = require('../src/node/n8n_service');
const { jobs, makeJobId, pushLog, broadcast } = require('../services/sse');
const { runPipeline } = require('../services/pipeline');
const { webhookLimiter } = require('../middleware/rate-limit');

// POST /api/run — start a pipeline job
router.post('/api/run', (req, res) => {
    let {
        city = '',
        bizType = 'smoke shop',
        maxResults = 100,
        skipLighthouse = true,
        generateDemo = true,
        exportSheets = false,
        sheetsId = '',
    } = req.body;

    if (!city.trim()) {
        return res.status(400).json({ error: 'City is required.' });
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
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', 'email_log.csv'),
    };

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
            pushLog(jobId, `[ERROR] ${err.message}`, 'error');
            job.status = 'failed';
            broadcast(jobId, { type: 'done', status: 'failed' });
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

// GET /api/leads — list captured leads
router.get('/api/leads', (req, res) => {
    try {
        const csvPath = path.join(__dirname, '..', 'data', 'submissions.csv');
        if (!fs.existsSync(csvPath)) return res.json({ leads: [] });

        const content = fs.readFileSync(csvPath, 'utf8');
        const lines = content.trim().split('\n');
        const headers = lines[0].split(',');
        const leads = lines.slice(1).map(line => {
            const values = line.split(',');
            const lead = {};
            headers.forEach((h, i) => lead[h.toLowerCase().replace(/ /g, '_')] = values[i] || '');
            return lead;
        });
        res.json({ leads });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read leads' });
    }
});

module.exports = router;
