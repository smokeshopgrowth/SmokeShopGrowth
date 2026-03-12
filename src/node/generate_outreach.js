#!/usr/bin/env node
/**
 * Outreach Message Generator
 * ==========================
 * Reads data/audited_leads.csv, calls OpenAI to craft a personalised
 * 2–3 sentence audit + friendly website-build pitch for each business,
 * and saves results to data/outreach_messages.csv.
 *
 * Usage:
 *   node generate_outreach.js [--input PATH] [--output PATH] [--concurrency N] [--model MODEL]
 *
 * Required env var:
 *   OPENAI_API_KEY=sk-...
 *
 * Flags:
 *   --input PATH        Input CSV  (default: data/audited_leads.csv)
 *   --output PATH       Output CSV (default: data/outreach_messages.csv)
 *   --concurrency N     Parallel OpenAI calls (default: 5)
 *   --model MODEL       OpenAI model (default: gpt-4o-mini)
 *   --dry-run           Print first 3 messages to console, don't write CSV
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { createReadStream, mkdirSync, writeFileSync } = require('fs');

const { OpenAI } = require('openai');
const csv = require('csv-parser');
const { format } = require('@fast-csv/format');
const pLimit = require('p-limit');

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const hasFlag = (flag) => args.includes(flag);

const INPUT_FILE = getArg('--input', 'data/audited_leads.csv');
const OUTPUT_FILE = getArg('--output', 'data/outreach_messages.csv');
const CONCURRENCY = parseInt(getArg('--concurrency', '5'), 10);
const MODEL = getArg('--model', 'gpt-4o-mini');
const DRY_RUN = hasFlag('--dry-run');

// ──────────────────────────────────────────────
// OpenAI client
// ──────────────────────────────────────────────
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
    console.error('ERROR: OPENAI_API_KEY environment variable is not set.');
    console.error('  Set it with: set OPENAI_API_KEY=sk-...');
    process.exit(1);
}

const openai = new OpenAI({ apiKey });

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Build a structured prompt from the audited lead row.
 */
function buildPrompt(lead) {
    const {
        business_name = 'this business',
        has_website = 'No',
        website = '',
        website_status = '',
        ssl = '',
        load_time = '',
        mobile_friendly = '',
        audit_summary = '',
        rating = '',
        review_count = '',
    } = lead;

    const websiteInfo = has_website === 'Yes'
        ? `They have a website (${website}). Status: ${website_status}, SSL: ${ssl}, Load time: ${load_time}, Mobile-friendly: ${mobile_friendly}.`
        : 'They have NO website.';

    const reviewInfo = rating
        ? `Google rating: ${rating} stars (${review_count} reviews).`
        : '';

    return `
You are a friendly local web design consultant writing a short outreach email to a small business owner.

Business: ${business_name}
${websiteInfo}
${reviewInfo}
Audit findings: ${audit_summary}

Write a short, warm, non-pushy email to this business owner. Structure it as:

1. One or two sentences acknowledging something positive about their business or their presence online.
2. One or two sentences highlighting a specific problem or opportunity (based on the audit data above). Be specific, not generic.
3. One friendly sentence offering to help — a simple modern website, or site improvements — without being salesy.

Tone: friendly, helpful, honest, short. Do NOT use buzzwords like "digital transformation" or "online presence optimization". Do NOT use bullet points. Write in plain paragraphs as if talking to a neighbour.

Reply with only the email body text. No subject line. No "Dear [Name]". No sign-off. Just the 3–4 sentence body.
`.trim();
}

// ──────────────────────────────────────────────
// Core: generate one outreach message
// ──────────────────────────────────────────────
async function generateMessage(lead, idx, total, retries = 3) {
    const name = lead.business_name || `Lead #${idx}`;
    const prompt = buildPrompt(lead);

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const completion = await openai.chat.completions.create({
                model: MODEL,
                temperature: 0.75,
                max_tokens: 300,
                messages: [
                    {
                        role: 'system',
                        content: 'You write short, warm, plainspoken outreach emails for a local web design consultant. Be specific and genuine. Never use jargon.',
                    },
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
            });

            const message = completion.choices[0]?.message?.content?.trim() || '';
            log(`[${idx}/${total}] ✓ ${name}`);
            return { business_name: name, email_message: message };

        } catch (err) {
            const isRateLimit = err?.status === 429 || err?.code === 'rate_limit_exceeded';
            if (isRateLimit && attempt < retries) {
                const wait = 2 ** attempt * 1500;
                log(`[${idx}/${total}] Rate limited — waiting ${wait / 1000}s before retry ${attempt + 1}/${retries}…`);
                await sleep(wait);
            } else {
                log(`[${idx}/${total}] ✗ ${name} — ${err?.message || err}`);
                return {
                    business_name: name,
                    email_message: `[Error generating message: ${err?.message || 'unknown error'}]`,
                };
            }
        }
    }
}

// ──────────────────────────────────────────────
// CSV I/O
// ──────────────────────────────────────────────
function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Input file not found: ${filePath}`));
        }
        const rows = [];
        createReadStream(filePath)
            .pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

function writeCsv(filePath, rows) {
    return new Promise((resolve, reject) => {
        mkdirSync(path.dirname(filePath), { recursive: true });
        const ws = fs.createWriteStream(filePath);
        const stream = format({ headers: ['business_name', 'email_message'] });
        stream.pipe(ws);
        for (const row of rows) stream.write(row);
        stream.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
    });
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
    console.log('='.repeat(60));
    console.log(' Outreach Message Generator');
    console.log(`  Input       : ${INPUT_FILE}`);
    console.log(`  Output      : ${OUTPUT_FILE}`);
    console.log(`  Model       : ${MODEL}`);
    console.log(`  Concurrency : ${CONCURRENCY}`);
    console.log(`  Dry run     : ${DRY_RUN}`);
    console.log('='.repeat(60));

    // 1. Load leads
    let leads;
    try {
        leads = await readCsv(INPUT_FILE);
    } catch (err) {
        console.error('ERROR:', err.message);
        process.exit(1);
    }
    log(`Loaded ${leads.length} audited leads`);

    // 2. Filter — skip leads where generating a message wouldn't make sense
    const eligible = leads.filter(l => l.business_name && l.business_name.trim());
    if (eligible.length < leads.length) {
        log(`Skipping ${leads.length - eligible.length} rows with no business name`);
    }

    // 3. Generate messages with concurrency control
    const limit = pLimit(CONCURRENCY);
    const total = eligible.length;
    const start = Date.now();

    const tasks = eligible.map((lead, i) =>
        limit(() => generateMessage(lead, i + 1, total))
    );

    const results = await Promise.all(tasks);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`Generated ${results.length} messages in ${elapsed}s`);

    // 4. Dry-run preview
    if (DRY_RUN) {
        console.log('\n──── DRY RUN PREVIEW (first 3) ────\n');
        results.slice(0, 3).forEach(r => {
            console.log(`Business: ${r.business_name}\n`);
            console.log(r.email_message);
            console.log('\n' + '─'.repeat(50) + '\n');
        });
        return;
    }

    // 5. Write CSV
    await writeCsv(OUTPUT_FILE, results);
    log(`Saved to ${OUTPUT_FILE}`);

    // 6. Estimate cost
    const approxTokensPerCall = 400;
    const totalTokens = total * approxTokensPerCall;
    const costPer1M = MODEL.includes('gpt-4o-mini') ? 0.15 : 2.50; // input price
    const estCost = ((totalTokens / 1_000_000) * costPer1M).toFixed(4);

    console.log('\n📊 Summary:');
    console.log(`  Messages generated : ${results.length}`);
    console.log(`  Time elapsed       : ${elapsed}s`);
    console.log(`  Est. cost (approx) : ~$${estCost} (${MODEL})`);
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
