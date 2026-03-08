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
// In-memory job store
// ──────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, logs, city, type, files }

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

// ──────────────────────────────────────────────
// Route: download a result file
// ──────────────────────────────────────────────
app.get('/api/download/:jobId/:file', (req, res) => {
    const job = jobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const fileMap = {
        leads: job.files.leads,
        audited: job.files.audited,
        outreach: job.files.outreach,
        demo: job.files.demo,
    };
    const filePath = fileMap[req.params.file];
    if (!filePath || !fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not ready.' });
    }

    res.download(filePath);
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
    const agentId = process.env.ELEVENLABS_AGENT_ID || 'agent_0901kk068cm9fats660z2mzqwnhy';
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

    if (!apiKey) {
        return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    }
    if (!phoneNumberId) {
        return res.status(500).json({ error: 'ELEVENLABS_PHONE_NUMBER_ID not set. Please add it to your .env file.' });
    }

    // Note: This webhook call is not associated with a specific job, so we use a placeholder 'call'
    // for the jobId. This log will not appear in the SSE stream for a pipeline job.
    pushLog('call', `Attempting call to ${phone} using agent ${agentId}…`, 'log');

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
                // Passing dynamic variables (might need to go inside conversation_initiation_client_data depending on your firm config)
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
// Pipeline runner
// ──────────────────────────────────────────────
async function runPipeline(jobId) {
    const job = jobs.get(jobId);

    // ── Step 1: Scrape ────────────────────────
    pushLog(jobId, '🔍 Step 1/3 — Scraping Google Maps…', 'step');
    job.step = 1;
    await runChild(jobId, 'python', [
        'scraper.py',
        '--city', job.city,
        '--type', job.bizType,
        '--max-results', String(job.maxResults),
        '--output', job.files.leads,
        '--headless',
    ]);

    if (!fs.existsSync(job.files.leads)) {
        throw new Error('Scraper completed but no leads.csv was created.');
    }

    const leadCount = await countCsvRows(job.files.leads);
    pushLog(jobId, `✅ Scraped ${leadCount} businesses.`, 'success');

    // ── Step 2: Audit ─────────────────────────
    pushLog(jobId, '🌐 Step 2/3 — Auditing websites…', 'step');
    job.step = 2;
    const auditorArgs = [
        'auditor.js',
        '--input', job.files.leads,
        '--output', job.files.audited,
        '--concurrency', '8',
    ];
    if (job.skipLighthouse !== false) auditorArgs.push('--skip-lighthouse');
    await runChild(jobId, 'node', auditorArgs);

    const auditedCount = await countCsvRows(job.files.audited);
    pushLog(jobId, `✅ Audited ${auditedCount} websites.`, 'success');

    // ── Step 3: Outreach ──────────────────────
    if (process.env.OPENAI_API_KEY) {
        pushLog(jobId, '✍️  Step 3/3 — Generating outreach messages…', 'step');
        job.step = 3;
        await runChild(jobId, 'node', [
            'generate_outreach.js',
            '--input', job.files.audited,
            '--output', job.files.outreach,
        ]);
        const outreachCount = await countCsvRows(job.files.outreach);
        pushLog(jobId, `✅ Generated ${outreachCount} outreach messages.`, 'success');
    } else {
        pushLog(jobId, '⚠️  Step 3 skipped — OPENAI_API_KEY not set.', 'warn');
    }

    // ── Step 4: Demo Video ────────────────────
    if (job.generateDemo && process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '🎥 Step 4/4 — Generating Minimax demo videos…', 'step');
        job.step = 4;
        await runChild(jobId, 'node', [
            'generate_demo.js',
            '--input', fs.existsSync(job.files.outreach) ? job.files.outreach : job.files.audited,
            '--output', job.files.demo,
            '--limit', '10' // Only do top 10 to save API costs & time
        ]);
        const demoCount = await countCsvRows(job.files.demo);
        pushLog(jobId, `✅ Generated demo video entries  (${demoCount} leads processed).`, 'success');
    } else if (job.generateDemo && !process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '⚠️  Step 4 skipped — MINIMAX_API_KEY not set.', 'warn');
    } else {
        pushLog(jobId, '⏩ Step 4 skipped — Demo generation turned off.', 'log');
    }

    // ── Step 5: Export to Google Sheets ───────
    if (job.exportSheets && job.sheetsId) {
        pushLog(jobId, '📊 Exporting to Google Sheets…', 'step');
        try {
            // Determine the final file to export
            let finalOutput = job.files.audited;
            if (fs.existsSync(job.files.demo)) finalOutput = job.files.demo;
            else if (fs.existsSync(job.files.outreach)) finalOutput = job.files.outreach;

            await exportToSheets(job.sheetsId, finalOutput, job.city);
            pushLog(jobId, '✅ Exported to Google Sheets.', 'success');
        } catch (err) {
            pushLog(jobId, `⚠️  Google Sheets export failed: ${err.message}`, 'warn');
        }
    }

    job.status = 'done';
    job.step = 5;
    pushLog(jobId, '🎉 Pipeline complete!', 'success');
    broadcast(jobId, { type: 'done', status: 'done', files: job.files });
}

// ──────────────────────────────────────────────
// Child process helper
// ──────────────────────────────────────────────
function runChild(jobId, cmd, args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            shell: false,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        const onData = (data) => {
            String(data).split('\n').forEach(line => {
                line = line.trim();
                if (line) pushLog(jobId, line, 'log');
            });
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('close', code => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}

// ──────────────────────────────────────────────
// SSE helpers
// ──────────────────────────────────────────────
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
    job.clients.forEach(res => { try { res.write(data); } catch { } });
    if (payload.type === 'done') {
        job.clients.forEach(res => { try { res.end(); } catch { } });
        job.clients = [];
    }
}

// ──────────────────────────────────────────────
// CSV row counter
// ──────────────────────────────────────────────
function countCsvRows(filePath) {
    return new Promise(resolve => {
        if (!fs.existsSync(filePath)) return resolve(0);
        let count = 0;
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', () => count++)
            .on('end', () => resolve(count))
            .on('error', () => resolve(0));
    });
}

// ──────────────────────────────────────────────
// Google Sheets export
// ──────────────────────────────────────────────
async function exportToSheets(spreadsheetId, csvPath, sheetTitle) {
    // Requires: credentials.json (service account) in project root
    const credPath = path.join(__dirname, 'credentials.json');
    if (!fs.existsSync(credPath)) {
        throw new Error('credentials.json not found. See README for Google Sheets setup.');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read CSV into 2D array
    const rows = await new Promise((resolve, reject) => {
        const data = [];
        let headerPushed = false;
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', row => {
                if (!headerPushed) {
                    data.push(Object.keys(row));
                    headerPushed = true;
                }
                data.push(Object.values(row));
            })
            .on('end', () => resolve(data))
            .on('error', reject);
    });

    // Create or clear a sheet tab named after the city
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(
        s => s.properties.title === sheetTitle
    );

    if (existingSheet) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetTitle}!A1:Z10000`,
        });
    } else {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: sheetTitle } } }],
            },
        });
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
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
