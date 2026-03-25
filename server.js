/**
 * SmokeShopGrowth Server
 * ======================
 * Express web server — serves the public marketing site at /,
 * the internal lead-gen dashboard at /dashboard, and all API +
 * webhook routes for the pipeline, voice agent, and Stripe.
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

// ──────────────────────────────────────────────
// Dashboard route — serves the internal tool at /dashboard
// ──────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files (public/index.html = marketing landing page)
app.use(express.static(path.join(__dirname, 'public')));

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

function pushLog(jobId, message, type = 'log') {
    const entry = { type, message, ts: Date.now() };
    const job = jobs.get(jobId);
    if (!job) return;
    job.logs.push(entry);
    broadcast(jobId, entry);
}

function broadcast(jobId, payload) {
    const job = jobs.get(jobId);
    if (!job) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    const deadClients = [];
    job.clients.forEach((res, idx) => {
        try { res.write(data); } catch (err) { deadClients.push(idx); }
    });
    deadClients.reverse().forEach(idx => job.clients.splice(idx, 1));
    if (payload.type === 'done') {
        job.clients.forEach(res => { try { res.end(); } catch { /* ignore */ } });
        job.clients = [];
    }
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

// Health check (legacy path)
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

    const {
        business_name = '',
        phone = '',
        city = '',
        agent_name = process.env.AGENT_NAME || 'Alex',
    } = req.body;

    if (!phone) {
        return res.status(400).json({ error: 'phone is required' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

    if (!apiKey) return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    if (!agentId) return res.status(500).json({ error: 'ELEVENLABS_AGENT_ID not set' });
    if (!phoneNumberId) return res.status(500).json({ error: 'ELEVENLABS_PHONE_NUMBER_ID not set' });

    try {
        const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agent_id: agentId,
                agent_phone_number_id: phoneNumberId,
                to_number: phone,
                dynamic_variables: { business_name, city, agent_name },
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message || JSON.stringify(data));

        console.log(`📞 Call started → ${business_name} (${phone}) — conversation: ${data.conversation_id}`);
        res.json({ success: true, conversation_id: data.conversation_id });
    } catch (err) {
        console.error(`❌ Call failed for ${phone}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ──────────────────────────────────────────────
// Demo preview route — renders template.html with query params
// ──────────────────────────────────────────────
app.get('/demo', (req, res) => {
    const templatePath = path.join(__dirname, 'template.html');
    if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Demo template not found.');
    }

    const business = {
        name: req.query.name || req.query.shop || 'Your Smoke Shop',
        city: req.query.city || 'Your City',
        state: req.query.state || 'TX',
        phone: req.query.phone || '(000) 000-0000',
        hours: req.query.hours || 'Mon–Sun 9am–10pm',
        rating: req.query.rating || '4.5',
        reviews: req.query.reviews || '50+',
    };

    let html = fs.readFileSync(templatePath, 'utf8');

    const nameParts = business.name.split(' ');
    const mid = Math.ceil(nameParts.length / 2);
    const stars = '★'.repeat(Math.round(parseFloat(business.rating))) +
                  '☆'.repeat(5 - Math.round(parseFloat(business.rating)));

    html = html.replace(/{{BUSINESS_NAME}}/g, business.name);
    html = html.replace(/{{BUSINESS_LINE1}}/g, nameParts.slice(0, mid).join(' '));
    html = html.replace(/{{BUSINESS_LINE2}}/g, nameParts.slice(mid).join(' '));
    html = html.replace(/{{CITY}}/g, business.city);
    html = html.replace(/{{STATE}}/g, business.state);
    html = html.replace(/{{ADDRESS}}/g, `${business.city}, ${business.state}`);
    html = html.replace(/{{PHONE}}/g, business.phone);
    html = html.replace(/{{PHONE_CLEAN}}/g, business.phone.replace(/\D/g, ''));
    html = html.replace(/{{RATING}}/g, business.rating);
    html = html.replace(/{{STARS}}/g, stars);
    html = html.replace(/{{REVIEWS}}/g, business.reviews);
    html = html.replace(/{{HOURS}}/g, business.hours);
    html = html.replace(/{{SLUG}}/g, business.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    html = html.replace(/{{MAP_EMBED}}/g, `https://www.google.com/maps?q=${encodeURIComponent(business.name + ', ' + business.city + ', ' + business.state)}&output=embed`);
    html = html.replace(/{{CONTACT_PHONE}}/g, process.env.CONTACT_PHONE || '2813230450');
    html = html.replace(/{{CONTACT_PHONE_FORMATTED}}/g, '(281) 323-0450');

    // Fill any remaining placeholders with empty string to avoid {{...}} showing
    html = html.replace(/{{REVIEW_AUTHOR_\d+}}/g, 'Happy Customer');
    html = html.replace(/{{REVIEW_TEXT_\d+}}/g, 'Great shop with amazing selection. Highly recommend!');
    html = html.replace(/{{[A-Z_]+}}/g, '');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

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

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n🚀 SmokeShopGrowth running at http://localhost:${PORT}`);
    console.log(`   Landing page: http://localhost:${PORT}/`);
    console.log(`   Dashboard:    http://localhost:${PORT}/dashboard\n`);
});
