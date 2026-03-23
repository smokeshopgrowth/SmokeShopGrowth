/**
 * Dashboard Server
 * ================
 * Express web server that powers the lead generation dashboard.
 * Provides a form UI, runs the pipeline steps as child processes,
 * streams real-time progress via SSE, and exports to Google Sheets.
 *
 * Start:  node server.js
 * Open:   http://localhost:3000
 */

'use strict';
require('dotenv').config();

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { mkdirSync } = require('fs');
const { google } = require('googleapis');
const csv = require('csv-parser');

const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// Route: frontend config (safe public values only)
// The browser fetches this to get the Vapi public key for the Web SDK.
// NEVER include server-side secrets here.
// ──────────────────────────────────────────────
app.get('/api/config', (req, res) => {
    res.json({
        vapiPublicKey: process.env.VAPI_PUBLIC_KEY || null,
        vapiAssistantId: process.env.VAPI_ASSISTANT_ID || null,
        demoBaeUrl: process.env.DEMO_BASE_URL || null,
    });
});

// ──────────────────────────────────────────────
// Persistent job store
// Jobs are kept in memory for fast SSE access and flushed to disk so they
// survive server restarts.  Only serialisable fields are persisted (clients
// array is ephemeral and is always re-initialised to []).
// ──────────────────────────────────────────────
const JOBS_FILE = path.join(__dirname, 'data', 'jobs.json');

function _loadJobsFromDisk() {
    try {
        if (fs.existsSync(JOBS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
            const map = new Map();
            for (const [id, job] of Object.entries(raw)) {
                map.set(id, { ...job, clients: [] }); // clients are always fresh on restart
            }
            console.log(`[Jobs] Loaded ${map.size} job(s) from disk.`);
            return map;
        }
    } catch (e) {
        console.warn(`[Jobs] Could not load jobs.json: ${e.message}`);
    }
    return new Map();
}

function _saveJobsToDisk() {
    try {
        mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
        const obj = {};
        for (const [id, job] of jobs.entries()) {
            const { clients, ...serialisable } = job; // omit non-serialisable SSE clients
            obj[id] = serialisable;
        }
        fs.writeFileSync(JOBS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
        console.warn(`[Jobs] Could not save jobs.json: ${e.message}`);
    }
}

const jobs = _loadJobsFromDisk(); // jobId → { status, logs, city, type, files, clients }

function makeJobId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ──────────────────────────────────────────────
// Route: start a pipeline job
// ──────────────────────────────────────────────
app.post('/api/run', (req, res) => {
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

    // Input validation
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
    mkdirSync(dataDir, { recursive: true });
    mkdirSync('logs', { recursive: true });

    const files = {
        leads: path.join(dataDir, 'leads.csv'),
        audited: path.join(dataDir, 'audited_leads.csv'),
        outreach: path.join(dataDir, 'outreach_messages.csv'),
        demo: path.join(dataDir, 'demo_leads.csv'),
        emailLog: path.join('logs', 'email_log.csv'),
    };

    jobs.set(jobId, {
        status: 'running',
        step: 0,
        logs: [],
        city, bizType, maxResults, citySlug, dataDir, files,
        exportSheets, sheetsId, generateDemo,
        clients: [], // SSE subscribers
    });

    // Start pipeline asynchronously
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

// ──────────────────────────────────────────────
// Route: SSE stream for a job
// ──────────────────────────────────────────────
app.get('/api/status/:jobId', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Replay history
    job.logs.forEach(entry => {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
    });

    // If already done, send close event
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

// Health check
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────
// Route: list finished jobs
// ──────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
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

// ──────────────────────────────────────────────
// Route: Zapier webhook → trigger ElevenLabs call
// ──────────────────────────────────────────────
// Zapier POSTs: { business_name, phone, city, agent_name? }
app.post('/webhook/call', webhookLimiter, async (req, res) => {
    const requiredKey = process.env.API_KEY;
    if (!requiredKey || req.headers['x-api-key'] !== requiredKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

// ── Global error handler ────────────────────────────────────────────────────
// Must be defined AFTER all routes
app.use((err, req, res, _next) => {
    console.error('[ERROR]', err.stack || err.message || err);
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message || 'Internal server error',
    });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
    });
}

// ──────────────────────────────────────────────
// Template Form Submission Endpoint
// ──────────────────────────────────────────────
const templateSubmissions = [];

app.post('/api/template-submission', webhookLimiter, async (req, res) => {
    try {
        const { shopName, city, phone, email } = req.body;

        if (!shopName || !city || !phone || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const submission = {
            id: makeJobId(),
            shopName: shopName.trim(),
            city: city.trim(),
            phone: phone.trim(),
            email: email.trim(),
            timestamp: new Date().toISOString()
        };

        templateSubmissions.push(submission);
        console.log(`✓ Form received: ${submission.shopName} (${submission.city})`);

        res.status(200).json({
            success: true,
            message: 'Thank you! We\'ll contact you shortly.',
            submissionId: submission.id
        });
    } catch (err) {
        console.error('Form submission error:', err.message);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

app.get('/api/template-submissions', (req, res) => {
    res.json({
        count: templateSubmissions.length,
        submissions: templateSubmissions
    });
});

// ──────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
});
