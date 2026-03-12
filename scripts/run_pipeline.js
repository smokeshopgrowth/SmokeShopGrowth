#!/usr/bin/env node
/**
 * Lead Pipeline Orchestrator
 * ==========================
 * Runs the full smoke shop lead generation → audit → outreach → email pipeline.
 *
 * Usage:
 *   node run_pipeline.js --city "Houston" [options]
 *
 * Required env vars (for steps 3 & 4):
 *   OPENAI_API_KEY=sk-...
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS  (for email step)
 *
 * Flags:
 *   --city CITY           City to target (required)
 *   --type TYPE           Business type (default: smoke shop)
 *   --max-results N       Max scrape results (default: 200)
 *   --concurrency N       Auditor concurrency (default: 5)
 *   --skip-lighthouse     Skip Lighthouse in auditor (faster)
 *   --skip-email          Don't send emails (stops after outreach CSV)
 *   --send-email          Enable actual email sending (requires SMTP env vars)
 *   --headless            Run scraper headless
 *   --from-step N         Resume from step N (1=scrape, 2=audit, 3=outreach, 4=email)
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { mkdirSync, appendFileSync } = require('fs');

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const hasFlag = (flag) => args.includes(flag);

const CITY = getArg('--city', '');
const BIZ_TYPE = getArg('--type', 'smoke shop');
const MAX_RESULTS = getArg('--max-results', '200');
const CONCURRENCY = getArg('--concurrency', '5');
const FROM_STEP = parseInt(getArg('--from-step', '1'), 10);
const SKIP_EMAIL = !hasFlag('--send-email');
const HEADLESS = hasFlag('--headless') ? '--headless' : '';
const SKIP_LH = hasFlag('--skip-lighthouse') ? '--skip-lighthouse' : '';

if (!CITY) {
    console.error('ERROR: --city is required.');
    console.error('  Example: node run_pipeline.js --city "Houston"');
    process.exit(1);
}

// ──────────────────────────────────────────────
// Paths
// ──────────────────────────────────────────────
const citySlug = CITY.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const DATA_DIR = path.join('data', citySlug);
const LOGS_DIR = 'logs';
const LEADS_CSV = path.join(DATA_DIR, 'leads.csv');
const AUDITED_CSV = path.join(DATA_DIR, 'audited_leads.csv');
const OUTREACH_CSV = path.join(DATA_DIR, 'outreach_messages.csv');
const EMAIL_LOG = path.join(LOGS_DIR, 'email_log.csv');
const PIPELINE_LOG = path.join(LOGS_DIR, `pipeline_${citySlug}_${datestamp()}.log`);

mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

// ──────────────────────────────────────────────
// Logging
// ──────────────────────────────────────────────
function datestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
}

function log(msg, level = 'INFO') {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    const line = `[${ts}] [${level}] ${msg}`;
    console.log(line);
    appendFileSync(PIPELINE_LOG, line + '\n');
}

function banner(title) {
    const line = '═'.repeat(58);
    log(`\n${line}\n  ${title}\n${line}`);
}

// ──────────────────────────────────────────────
// Step runner
// ──────────────────────────────────────────────
function runProcess(cmd, args, label) {
    return new Promise((resolve, reject) => {
        log(`Starting: ${cmd} ${args.join(' ')}`, 'RUN');
        const proc = spawn(cmd, args, {
            stdio: 'inherit',
            shell: false,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1',
            },
        });
        proc.on('close', code => {
            if (code === 0) {
                log(`✓ ${label} completed successfully.`);
                resolve();
            } else {
                const err = new Error(`${label} exited with code ${code}`);
                log(`✗ ${label} failed (exit ${code})`, 'ERROR');
                reject(err);
            }
        });
        proc.on('error', err => {
            log(`✗ Failed to start ${label}: ${err.message}`, 'ERROR');
            reject(err);
        });
    });
}

// ──────────────────────────────────────────────
// Individual steps
// ──────────────────────────────────────────────

async function step1_scrape() {
    banner('STEP 1 — Scrape Google Maps');
    const scraperArgs = [
        'scraper.py',
        '--city', CITY,
        '--type', BIZ_TYPE,
        '--max-results', MAX_RESULTS,
        '--output', LEADS_CSV,
    ];
    if (HEADLESS) scraperArgs.push('--headless');
    await runProcess('python', scraperArgs, 'Google Maps Scraper');
}

async function step2_audit() {
    banner('STEP 2 — Audit Websites');
    if (!fs.existsSync(LEADS_CSV)) {
        throw new Error(`Leads file not found: ${LEADS_CSV}. Run step 1 first.`);
    }
    const auditorArgs = [
        'auditor.js',
        '--input', LEADS_CSV,
        '--output', AUDITED_CSV,
        '--concurrency', CONCURRENCY,
    ];
    if (SKIP_LH) auditorArgs.push('--skip-lighthouse');
    await runProcess('node', auditorArgs, 'Website Auditor');
}

async function step3_outreach() {
    banner('STEP 3 — Generate AI Outreach Messages');
    if (!fs.existsSync(AUDITED_CSV)) {
        throw new Error(`Audited leads file not found: ${AUDITED_CSV}. Run step 2 first.`);
    }
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set. Export it before running this step.');
    }
    await runProcess('node', [
        'generate_outreach.js',
        '--input', AUDITED_CSV,
        '--output', OUTREACH_CSV,
    ], 'Outreach Generator');
}

async function step4_email() {
    banner('STEP 4 — Send Emails');
    if (SKIP_EMAIL) {
        log('Email sending is disabled (pass --send-email to enable).', 'SKIP');
        log(`Outreach messages ready at: ${OUTREACH_CSV}`);
        return;
    }
    if (!fs.existsSync(OUTREACH_CSV)) {
        throw new Error(`Outreach CSV not found: ${OUTREACH_CSV}. Run step 3 first.`);
    }
    await runProcess('node', [
        'send_emails.js',
        '--input', OUTREACH_CSV,
        '--log', EMAIL_LOG,
    ], 'Email Sender');
}

// ──────────────────────────────────────────────
// Pipeline summary
// ──────────────────────────────────────────────
function printSummary(results) {
    banner('PIPELINE COMPLETE');
    results.forEach(({ step, label, status, duration }) => {
        const icon = status === 'ok' ? '✓' : status === 'skipped' ? '⏭' : '✗';
        log(`  ${icon} Step ${step}: ${label.padEnd(30)} ${duration}s`);
    });
    log('');
    log(`Data directory : ${DATA_DIR}`);
    log(`Leads          : ${LEADS_CSV}`);
    log(`Audited        : ${AUDITED_CSV}`);
    log(`Outreach msgs  : ${OUTREACH_CSV}`);
    if (!SKIP_EMAIL) log(`Email log      : ${EMAIL_LOG}`);
    log(`Pipeline log   : ${PIPELINE_LOG}`);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
    banner(`SMOKE SHOP LEAD PIPELINE — ${CITY.toUpperCase()}`);
    log(`Business type : ${BIZ_TYPE}`);
    log(`Max results   : ${MAX_RESULTS}`);
    log(`Starting from : Step ${FROM_STEP}`);
    log(`Data dir      : ${DATA_DIR}`);
    log(`Pipeline log  : ${PIPELINE_LOG}`);

    const steps = [
        { step: 1, label: 'Scrape Google Maps', fn: step1_scrape },
        { step: 2, label: 'Audit Websites', fn: step2_audit },
        { step: 3, label: 'Generate Outreach', fn: step3_outreach },
        { step: 4, label: 'Send Emails', fn: step4_email },
    ];

    const results = [];
    const pipelineStart = Date.now();

    for (const { step, label, fn } of steps) {
        if (step < FROM_STEP) {
            results.push({ step, label, status: 'skipped', duration: 0 });
            log(`Skipping step ${step} (--from-step ${FROM_STEP}).`, 'SKIP');
            continue;
        }

        const t0 = Date.now();
        try {
            await fn();
            results.push({ step, label, status: 'ok', duration: ((Date.now() - t0) / 1000).toFixed(1) });
        } catch (err) {
            results.push({ step, label, status: 'error', duration: ((Date.now() - t0) / 1000).toFixed(1) });
            log(`Pipeline stopped at step ${step}: ${err.message}`, 'ERROR');
            printSummary(results);
            process.exit(1);
        }
    }

    const total = ((Date.now() - pipelineStart) / 1000).toFixed(1);
    log(`Total pipeline time: ${total}s`);
    printSummary(results);
}

main().catch(err => {
    console.error('Fatal pipeline error:', err.message);
    process.exit(1);
});
