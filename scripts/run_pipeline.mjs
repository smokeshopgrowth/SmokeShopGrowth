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
 *   --skip-email          Don't send emails (default: emails are ON)
 *   --headless            Run scraper headless
 *   --from-step N         Resume from step N (1=scrape, 2=audit, 3=social-audit, 4=outreach, 5=demos, 6=email)
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import 'dotenv/config';


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
const SKIP_EMAIL = hasFlag('--skip-email');
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
const SOCIAL_AUDITED_CSV = path.join(DATA_DIR, 'social_audited.csv');
const OUTREACH_CSV = path.join(DATA_DIR, 'outreach_messages.csv');
const DEMOS_DIR = path.join('public', 'demos', citySlug);
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
        path.join('src', 'python', 'scraper.py'),
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
        path.join('src', 'node', 'auditor.mjs'),
        '--input', LEADS_CSV,
        '--output', AUDITED_CSV,
        '--concurrency', CONCURRENCY,
    ];
    if (SKIP_LH) auditorArgs.push('--skip-lighthouse');
    await runProcess('node', auditorArgs, 'Website Auditor');
}

async function step3_socialAudit() {
    banner('STEP 3 — Social Audit');
    if (!fs.existsSync(AUDITED_CSV)) {
        throw new Error(`Audited leads file not found: ${AUDITED_CSV}. Run step 2 first.`);
    }
    await runProcess('node', [
        path.join('src', 'node', 'social_audit.mjs'),
        '--input', AUDITED_CSV,
        '--output', SOCIAL_AUDITED_CSV,
    ], 'Social Auditor');
}

async function step4_outreach() {
    banner('STEP 4 — Generate AI Outreach Messages');
    const inputCsv = fs.existsSync(SOCIAL_AUDITED_CSV) ? SOCIAL_AUDITED_CSV : AUDITED_CSV;
    if (!fs.existsSync(inputCsv)) {
        throw new Error(`Input file not found: ${inputCsv}. Run previous steps first.`);
    }
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set. Export it before running this step.');
    }
    await runProcess('node', [
        path.join('src', 'node', 'generate_outreach.mjs'),
        '--input', inputCsv,
        '--output', OUTREACH_CSV,
    ], 'Outreach Generator');
}

async function step5_demos() {
    banner('STEP 5 — Generate Demo Sites');
    const inputCsv = fs.existsSync(OUTREACH_CSV) ? OUTREACH_CSV :
                     fs.existsSync(SOCIAL_AUDITED_CSV) ? SOCIAL_AUDITED_CSV : AUDITED_CSV;
    if (!fs.existsSync(inputCsv)) {
        throw new Error(`Input file not found for demo generation. Run previous steps first.`);
    }
    await runProcess('node', [
        path.join('src', 'node', 'generate-from-templates.mjs'),
        '--input', inputCsv,
        '--output', DEMOS_DIR,
    ], 'Demo Site Generator');
}

async function step6_email() {
    banner('STEP 6 — Send Emails');
    if (SKIP_EMAIL) {
        log('Email sending is disabled (pass --skip-email to remove, it is on by default).', 'SKIP');
        log(`Outreach messages ready at: ${OUTREACH_CSV}`);
        return;
    }
    const smtpConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    if (!smtpConfigured) {
        log('SMTP env vars not set (SMTP_HOST, SMTP_USER, SMTP_PASS). Skipping email.', 'WARN');
        return;
    }
    if (!fs.existsSync(OUTREACH_CSV)) {
        throw new Error(`Outreach CSV not found: ${OUTREACH_CSV}. Run step 4 first.`);
    }
    await runProcess('node', [
        path.join('src', 'node', 'send_emails.mjs'),
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
    log(`Social audited : ${SOCIAL_AUDITED_CSV}`);
    log(`Outreach msgs  : ${OUTREACH_CSV}`);
    log(`Demo sites     : ${DEMOS_DIR}`);
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
        { step: 3, label: 'Social Audit', fn: step3_socialAudit },
        { step: 4, label: 'Generate Outreach', fn: step4_outreach },
        { step: 5, label: 'Generate Demo Sites', fn: step5_demos },
        { step: 6, label: 'Send Emails', fn: step6_email },
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
