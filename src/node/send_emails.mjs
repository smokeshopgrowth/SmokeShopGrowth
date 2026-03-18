#!/usr/bin/env node
/**
 * Email Sender
 * ============
 * Reads data/{city}/outreach_messages.csv and sends each personalised email
 * via SMTP (nodemailer). Logs results to logs/email_log.csv.
 *
 * Required env vars:
 *   SMTP_HOST     e.g. smtp.gmail.com
 *   SMTP_PORT     e.g. 587
 *   SMTP_USER     e.g. you@gmail.com
 *   SMTP_PASS     App password (NOT your main password)
 *   FROM_EMAIL    Sender address shown to recipient
 *   FROM_NAME     Sender display name (e.g. "Your Name | Web Design")
 *
 * Optional env vars:
 *   REPLY_TO      Reply-to address (defaults to FROM_EMAIL)
 *
 * Usage:
 *   node send_emails.js --input data/houston/outreach_messages.csv [--log logs/email_log.csv] [--dry-run] [--delay-ms 2000]
 */

'use strict';

import fs from 'fs';
import path from 'path';
import { createReadStream, mkdirSync, appendFileSync, existsSync } from 'fs';

import nodemailer from 'nodemailer';
import csv from 'csv-parser';
import { format } from '@fast-csv/format';

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };
const hasFlag = (flag) => args.includes(flag);

const INPUT_FILE = getArg('--input', 'data/outreach_messages.csv');
const LOG_FILE = getArg('--log', 'logs/email_log.csv');
const DRY_RUN = hasFlag('--dry-run');
const DELAY_MS = parseInt(getArg('--delay-ms', '2000'), 10); // courtesy delay between sends

// ──────────────────────────────────────────────
// Env validation
// ──────────────────────────────────────────────
const REQUIRED_ENV = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL'];

function validateEnv() {
    const missing = REQUIRED_ENV.filter(k => !process.env[k]);
    if (missing.length) {
        console.error('ERROR: Missing required environment variables:');
        missing.forEach(k => console.error(`  ${k}`));
        console.error('\nSet them in your shell:');
        console.error('  set SMTP_HOST=smtp.gmail.com');
        console.error('  set SMTP_PORT=587');
        console.error('  set SMTP_USER=you@gmail.com');
        console.error('  set SMTP_PASS=your_app_password');
        console.error('  set FROM_EMAIL=you@gmail.com');
        process.exit(1);
    }
}

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

/** Look up recipient email from an optional contacts lookup or skip if unknown. */
function getRecipientEmail(lead) {
    // In a real pipeline this would come from an extra CSV column or CRM lookup.
    // For now we check if the CSV row has an 'email' column.
    return (lead.email || '').trim() || null;
}

/** Build subject line from business name. */
function buildSubject(businessName) {
    return `Quick website tip for ${businessName}`;
}

// ──────────────────────────────────────────────
// CSV I/O
// ──────────────────────────────────────────────
function readCsv(filePath) {
    return new Promise((resolve, reject) => {
        if (!existsSync(filePath)) return reject(new Error(`File not found: ${filePath}`));
        const rows = [];
        createReadStream(filePath)
            .pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}

function initLog(filePath) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) {
        appendFileSync(filePath, 'timestamp,business_name,recipient_email,status,error\n');
    }
}

function writeLogRow(filePath, { businessName, email, status, error = '' }) {
    const ts = new Date().toISOString();
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const row = [ts, esc(businessName), esc(email), esc(status), esc(error)].join(',');
    appendFileSync(filePath, row + '\n');
}

// ──────────────────────────────────────────────
// Mailer
// ──────────────────────────────────────────────
function createTransport() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
}

async function sendEmail(transporter, { to, subject, text, fromName, fromEmail, replyTo }) {
    await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        replyTo: replyTo || fromEmail,
        to,
        subject,
        text,
    });
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
    if (!DRY_RUN) validateEnv();

    const fromEmail = process.env.FROM_EMAIL || 'noreply@example.com';
    const fromName = process.env.FROM_NAME || 'Web Design Team';
    const replyTo = process.env.REPLY_TO || fromEmail;

    console.log('='.repeat(60));
    console.log(' Email Sender');
    console.log(`  Input    : ${INPUT_FILE}`);
    console.log(`  Log      : ${LOG_FILE}`);
    console.log(`  From     : ${fromName} <${fromEmail}>`);
    console.log(`  Dry run  : ${DRY_RUN}`);
    console.log(`  Delay    : ${DELAY_MS}ms between sends`);
    console.log('='.repeat(60));

    // Load messages
    let leads;
    try {
        leads = await readCsv(INPUT_FILE);
    } catch (err) {
        console.error('ERROR:', err.message);
        process.exit(1);
    }
    log(`Loaded ${leads.length} outreach messages`);

    initLog(LOG_FILE);

    const transporter = DRY_RUN ? null : createTransport();

    const stats = { sent: 0, skipped: 0, failed: 0 };
    const total = leads.length;

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        const businessName = lead.business_name || `Lead #${i + 1}`;
        const message = lead.email_message || '';
        const recipient = getRecipientEmail(lead);
        const subject = buildSubject(businessName);

        log(`[${i + 1}/${total}] ${businessName}`);

        if (!recipient) {
            log(`  ΓÜü  No email address ΓÇö skipping.`);
            writeLogRow(LOG_FILE, { businessName, email: '', status: 'skipped', error: 'No email address' });
            stats.skipped++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`\n  To      : ${recipient}`);
            console.log(`  Subject : ${subject}`);
            console.log(`  Body    :\n${message}\n`);
            writeLogRow(LOG_FILE, { businessName, email: recipient, status: 'dry-run' });
            stats.sent++;
            continue;
        }

        try {
            await sendEmail(transporter, {
                to: recipient, subject, text: message, fromName, fromEmail, replyTo,
            });
            log(`  Γ£ô Sent to ${recipient}`);
            writeLogRow(LOG_FILE, { businessName, email: recipient, status: 'sent' });
            stats.sent++;
        } catch (err) {
            log(`  Γ✗ Failed: ${err.message}`);
            writeLogRow(LOG_FILE, { businessName, email: recipient, status: 'failed', error: err.message });
            stats.failed++;
        }

        // Courtesy delay to avoid SMTP rate limits
        if (i < leads.length - 1) await sleep(DELAY_MS);
    }

    console.log('\nΓÿê Email Summary:');
    console.log(`  Sent    : ${stats.sent}`);
    console.log(`  Skipped : ${stats.skipped} (no email address on file)`);
    console.log(`  Failed  : ${stats.failed}`);
    console.log(`  Log     : ${LOG_FILE}`);
    console.log('='.repeat(60));

    if (stats.skipped === total) {
        console.log('\nΓÿí Tip: Add an "email" column to your outreach CSV to enable sending.');
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
