#!/usr/bin/env node
/**
 * make_calls.js
 * =============
 * Reads a CSV of leads and places outbound Vapi AI calls to each one.
 * 
 * Usage:
 *   node make_calls.js --input data/austin/leads.csv [--limit 10] [--delay 30]
 * 
 * Env vars required:
 *   VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID
 *   DEMO_BASE_URL (optional, for demo link in call context)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const https = require('https');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}

const INPUT = getArg('input', '');
const LIMIT = parseInt(getArg('limit', '50'), 10);
const DELAY_SEC = parseInt(getArg('delay', '30'), 10); // seconds between calls
const LOG_FILE = getArg('log', path.join('logs', 'call_log.csv'));

if (!INPUT) {
    console.error('Usage: node make_calls.js --input <csv> [--limit N] [--delay seconds]');
    process.exit(1);
}

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const DEMO_BASE_URL = process.env.DEMO_BASE_URL || '';

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
    console.error('❌ Missing VAPI env vars (VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID)');
    process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanPhone(raw) {
    if (!raw) return null;
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return null;
}

function makeSlug(name) {
    return (name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function vapiCall(lead) {
    return new Promise((resolve, reject) => {
        const phone = cleanPhone(lead.phone);
        if (!phone) return resolve({ status: 'skipped', reason: 'no_phone', lead });

        const slug = makeSlug(lead.name);
        const demoUrl = DEMO_BASE_URL ? `${DEMO_BASE_URL}/demo/${slug}` : '';

        const body = JSON.stringify({
            assistantId: VAPI_ASSISTANT_ID,
            phoneNumberId: VAPI_PHONE_NUMBER_ID,
            customer: { number: phone, name: lead.name || '' },
            assistantOverrides: {
                firstMessage: `Hi, is this ${lead.name || 'the owner'}? This is Alex from Smoke Shop Growth. I noticed your shop${lead.city ? ' in ' + lead.city : ''} and I actually built a free website preview for you. Do you have 30 seconds?`,
                metadata: {
                    business_name: lead.name || '',
                    city: lead.city || '',
                    website: lead.website || '',
                    demo_url: demoUrl,
                    email: lead.email || '',
                    rating: lead.rating || '',
                }
            }
        });

        const req = https.request({
            hostname: 'api.vapi.ai',
            path: '/call/phone',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VAPI_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode === 201) {
                        resolve({ status: 'queued', callId: json.id, phone, lead });
                    } else {
                        resolve({ status: 'error', code: res.statusCode, message: json.message || data, phone, lead });
                    }
                } catch (e) {
                    resolve({ status: 'error', message: data, phone, lead });
                }
            });
        });

        req.on('error', (e) => resolve({ status: 'error', message: e.message, phone, lead }));
        req.write(body);
        req.end();
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log(`📞 Loading leads from ${INPUT}...`);

    const leads = await new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(INPUT)
            .pipe(csv())
            .on('data', row => rows.push(row))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });

    const callable = leads.filter(l => cleanPhone(l.phone)).slice(0, LIMIT);
    console.log(`📋 ${leads.length} total leads, ${callable.length} with valid phone numbers (limit: ${LIMIT})`);

    if (callable.length === 0) {
        console.log('⚠️  No leads with phone numbers to call.');
        return;
    }

    // Ensure log directory
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

    // Write CSV header if new file
    if (!fs.existsSync(LOG_FILE)) {
        fs.writeFileSync(LOG_FILE, 'timestamp,name,phone,call_id,status,message\n');
    }

    let queued = 0, skipped = 0, errors = 0;

    for (let i = 0; i < callable.length; i++) {
        const lead = callable[i];
        console.log(`📞 [${i + 1}/${callable.length}] Calling ${lead.name || 'Unknown'} at ${lead.phone}...`);

        const result = await vapiCall(lead);

        const logLine = [
            new Date().toISOString(),
            `"${(lead.name || '').replace(/"/g, '""')}"`,
            cleanPhone(lead.phone),
            result.callId || '',
            result.status,
            `"${(result.message || '').replace(/"/g, '""')}"`,
        ].join(',');
        fs.appendFileSync(LOG_FILE, logLine + '\n');

        if (result.status === 'queued') {
            console.log(`  ✅ Call queued → ${result.callId}`);
            queued++;
        } else if (result.status === 'skipped') {
            console.log(`  ⏩ Skipped: ${result.reason}`);
            skipped++;
        } else {
            console.log(`  ❌ Error: ${result.message}`);
            errors++;
        }

        // Delay between calls to avoid rate limits and be respectful
        if (i < callable.length - 1) {
            console.log(`  ⏱️  Waiting ${DELAY_SEC}s before next call...`);
            await sleep(DELAY_SEC * 1000);
        }
    }

    console.log(`\n📊 Call Summary:`);
    console.log(`   ✅ Queued:  ${queued}`);
    console.log(`   ⏩ Skipped: ${skipped}`);
    console.log(`   ❌ Errors:  ${errors}`);
    console.log(`   📄 Log:     ${LOG_FILE}`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
});
