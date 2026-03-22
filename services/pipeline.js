'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const n8nService = require('../src/node/n8n_service');
const { jobs, pushLog, broadcast } = require('./sse');

async function runPipeline(jobId) {
    const job = jobs.get(jobId);

    // Step 1: Scrape
    pushLog(jobId, '🔍 Step 1/3 — Scraping Google Maps…', 'step');
    job.step = 1;
    await runChild(jobId, 'python', [
        path.join(__dirname, '..', 'src', 'python', 'scraper.py'),
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

    // Step 2: Audit
    pushLog(jobId, '🌐 Step 2/3 — Auditing websites…', 'step');
    job.step = 2;
    const auditorArgs = [
        path.join(__dirname, '..', 'src', 'node', 'auditor.mjs'),
        '--input', job.files.leads,
        '--output', job.files.audited,
        '--concurrency', '8',
    ];
    if (job.skipLighthouse !== false) auditorArgs.push('--skip-lighthouse');
    await runChild(jobId, 'node', auditorArgs);

    const auditedCount = await countCsvRows(job.files.audited);
    pushLog(jobId, `✅ Audited ${auditedCount} websites.`, 'success');

    // Step 2.5: Social Audit
    pushLog(jobId, '📱 Step 2.5 — Social Audit…', 'step');
    await runChild(jobId, 'node', [
        path.join(__dirname, '..', 'src', 'node', 'social_audit.mjs'),
        '--input', job.files.audited,
        '--output', job.files.socialAudited
    ]);
    const socialAuditedCount = await countCsvRows(job.files.socialAudited);
    pushLog(jobId, `✅ Social Audited ${socialAuditedCount} websites.`, 'success');

    // Step 2.8: Firecrawl Enrichment
    if (process.env.FIRECRAWL_API_KEY) {
        pushLog(jobId, '🔥 Step 2.8 — Enriching leads with Firecrawl…', 'step');
        job.step = 2.8;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'firecrawl_enrich.mjs'),
            job.files.socialAudited,
            job.files.enriched,
        ]);
        const enrichedCount = await countCsvRows(job.files.enriched);
        pushLog(jobId, `✅ Firecrawl enriched ${enrichedCount} leads with products, hours, and branding.`, 'success');
    } else {
        pushLog(jobId, '⚠️  Step 2.8 skipped — FIRECRAWL_API_KEY not set.', 'warn');
        // Fall back to copy social audited
        fs.copyFileSync(job.files.socialAudited, job.files.enriched);
    }

    // Step 3: Outreach
    if (process.env.OPENAI_API_KEY) {
        pushLog(jobId, '✍️  Step 3/3 — Generating outreach messages…', 'step');
        job.step = 3;
        const outreachInput = fs.existsSync(job.files.enriched) ? job.files.enriched : job.files.socialAudited;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'generate_outreach.mjs'),
            '--input', outreachInput,
            '--output', job.files.outreach,
            '--base-url', job.baseUrl,
        ]);

        const outreachCount = await countCsvRows(job.files.outreach);
        pushLog(jobId, `✅ Generated ${outreachCount} outreach messages.`, 'success');
    } else {
        pushLog(jobId, '⚠️  Step 3 skipped — OPENAI_API_KEY not set.', 'warn');
    }

    // Step 4: Demo Sites
    if (job.generateDemo) {
        pushLog(jobId, '🏗️  Step 4 — Generating demo sites from templates…', 'step');
        job.step = 4;
        const demoInput = fs.existsSync(job.files.outreach) ? job.files.outreach
                        : fs.existsSync(job.files.enriched) ? job.files.enriched
                        : job.files.socialAudited;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'generate-from-templates.mjs'),
            '--input', demoInput,
            '--output', job.files.demos || path.join('public', 'demos'),
        ]);
        pushLog(jobId, '✅ Demo sites generated.', 'success');
    } else {
        pushLog(jobId, '⏩ Step 4 skipped — Demo generation turned off.', 'log');
    }

    // Step 4b: Demo Video (Minimax)
    if (job.generateDemo && process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '🎥 Step 4b — Generating Minimax demo videos…', 'step');
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'generate_demo.js'),
            '--input', fs.existsSync(job.files.outreach) ? job.files.outreach : job.files.socialAudited,
            '--output', job.files.demo,
            '--limit', '10'
        ]);

        const demoCount = await countCsvRows(job.files.demo);
        pushLog(jobId, `✅ Generated demo video entries (${demoCount} leads processed).`, 'success');
    } else if (job.generateDemo && !process.env.MINIMAX_API_KEY) {
        pushLog(jobId, '⚠️  Step 4b skipped — MINIMAX_API_KEY not set.', 'warn');
    }

    // Step 5: Send Emails
    const smtpConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
    const emailInput = fs.existsSync(job.files.outreach) ? job.files.outreach : null;
    if (smtpConfigured && emailInput) {
        pushLog(jobId, '📧 Step 5 — Sending outreach emails…', 'step');
        job.step = 5;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'send_emails.mjs'),
            '--input', emailInput,
            '--log', job.files.emailLog,
        ]);
        pushLog(jobId, '✅ Emails sent.', 'success');
    } else if (!smtpConfigured) {
        pushLog(jobId, '⚠️  Step 5 skipped — SMTP env vars not configured (SMTP_HOST, SMTP_USER, SMTP_PASS).', 'warn');
    } else {
        pushLog(jobId, '⚠️  Step 5 skipped — No outreach CSV available.', 'warn');
    }

    // Step 6: Export to Google Sheets
    if (job.exportSheets && job.sheetsId) {
        pushLog(jobId, '📊 Exporting to Google Sheets…', 'step');
        try {
            let finalOutput = job.files.audited;
            if (fs.existsSync(job.files.demo)) finalOutput = job.files.demo;
            else if (fs.existsSync(job.files.outreach)) finalOutput = job.files.outreach;
            else if (fs.existsSync(job.files.socialAudited)) finalOutput = job.files.socialAudited;

            const { exportToSheets } = require('./sheets');
            await exportToSheets(job.sheetsId, finalOutput, job.city);
            pushLog(jobId, '✅ Exported to Google Sheets.', 'success');
        } catch (err) {
            pushLog(jobId, `⚠️  Google Sheets export failed: ${err.message}`, 'warn');
        }
    }

    // Step 7: Make AI Calls via Vapi
    const vapiConfigured = process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID && process.env.VAPI_PHONE_NUMBER_ID;
    const callInput = fs.existsSync(job.files.outreach) ? job.files.outreach
                    : fs.existsSync(job.files.socialAudited) ? job.files.socialAudited
                    : fs.existsSync(job.files.audited) ? job.files.audited
                    : job.files.leads;
    if (vapiConfigured && fs.existsSync(callInput)) {
        pushLog(jobId, '📞 Step 7 — Making AI outbound calls via Vapi…', 'step');
        job.step = 7;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'make_calls.js'),
            '--input', callInput,
            '--log', job.files.callLog,
            '--limit', String(Math.min(job.maxResults, 50)),
            '--delay', '30',
        ]);
        pushLog(jobId, '✅ AI calls completed.', 'success');
    } else if (!vapiConfigured) {
        pushLog(jobId, '⚠️  Step 7 skipped — VAPI env vars not configured.', 'warn');
    } else {
        pushLog(jobId, '⚠️  Step 7 skipped — No lead CSV available for calls.', 'warn');
    }

    job.status = 'done';
    job.step = 8;
    pushLog(jobId, '🎉 Pipeline complete!', 'success');
    broadcast(jobId, { type: 'done', status: 'done', files: job.files });

    n8nService.notifyPipelineEvent('success', {
        jobId,
        city: job.city,
        bizType: job.bizType,
        files: job.files
    });
}

function runChild(jobId, cmd, args, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            shell: false,
            env: { ...process.env, PYTHONUNBUFFERED: '1' },
        });

        let timedOut = false;
        const timeout = setTimeout(() => {
            timedOut = true;
            proc.kill('SIGTERM');
            reject(new Error(`${cmd} timeout exceeded (${timeoutMs}ms). Process killed.`));
        }, timeoutMs);

        const onData = (data) => {
            String(data).split('\n').forEach(line => {
                line = line.trim();
                if (line) pushLog(jobId, line, 'log');
            });
        };

        proc.stdout.on('data', onData);
        proc.stderr.on('data', onData);
        proc.on('close', code => {
            clearTimeout(timeout);
            if (timedOut) return;  // Already rejected
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
        proc.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

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

/**
 * runSingleBusiness — runs Firecrawl → Outreach → Demo → Email → Call
 * for a single pre-populated leads.csv (no scraping step).
 */
async function runSingleBusiness(jobId) {
    const job = jobs.get(jobId);

    pushLog(jobId, `🚀 Starting single-business pipeline for: ${job.city}`, 'step');

    // Step 1: Copy leads as "audited" (skip scraper & auditor for single business)
    fs.copyFileSync(job.files.leads, job.files.audited);
    fs.copyFileSync(job.files.leads, job.files.socialAudited);
    pushLog(jobId, '✅ Lead data ready — skipping scrape & audit for single business.', 'success');

    // Step 2: Firecrawl Enrichment
    if (process.env.FIRECRAWL_API_KEY) {
        pushLog(jobId, '🔥 Enriching with Firecrawl…', 'step');
        job.step = 2;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'firecrawl_enrich.mjs'),
            job.files.socialAudited,
            job.files.enriched,
        ]);
        pushLog(jobId, '✅ Firecrawl enrichment complete.', 'success');
    } else {
        fs.copyFileSync(job.files.socialAudited, job.files.enriched);
        pushLog(jobId, '⚠️  Firecrawl skipped — FIRECRAWL_API_KEY not set.', 'warn');
    }

    // Step 3: Outreach
    if (process.env.OPENAI_API_KEY) {
        pushLog(jobId, '✍️  Generating personalized outreach…', 'step');
        job.step = 3;
        const outreachInput = fs.existsSync(job.files.enriched) ? job.files.enriched : job.files.socialAudited;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'generate_outreach.mjs'),
            '--input', outreachInput,
            '--output', job.files.outreach,
            '--base-url', job.baseUrl,
        ]);
        pushLog(jobId, '✅ Outreach message generated.', 'success');
    } else {
        pushLog(jobId, '⚠️  Outreach skipped — OPENAI_API_KEY not set.', 'warn');
    }

    // Step 4: Demo Site
    if (job.generateDemo) {
        pushLog(jobId, '🏗️  Generating demo site…', 'step');
        job.step = 4;
        const demoInput = fs.existsSync(job.files.outreach) ? job.files.outreach
                        : fs.existsSync(job.files.enriched) ? job.files.enriched
                        : job.files.socialAudited;
        await runChild(jobId, 'node', [
            path.join(__dirname, '..', 'src', 'node', 'generate-from-templates.mjs'),
            '--input', demoInput,
            '--output', job.files.demos || path.join('public', 'demos'),
        ]);
        pushLog(jobId, '✅ Demo site generated.', 'success');
    }

    // Step 5: Send Email
    if (job.sendEmail) {
        const smtpConfigured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
        const emailInput = fs.existsSync(job.files.outreach) ? job.files.outreach : null;
        if (smtpConfigured && emailInput) {
            pushLog(jobId, '📧 Sending outreach email…', 'step');
            job.step = 5;
            await runChild(jobId, 'node', [
                path.join(__dirname, '..', 'src', 'node', 'send_emails.mjs'),
                '--input', emailInput,
                '--log', job.files.emailLog,
            ]);
            pushLog(jobId, '✅ Email sent.', 'success');
        } else {
            pushLog(jobId, '⚠️  Email skipped — SMTP not configured or no outreach data.', 'warn');
        }
    }

    // Step 7: AI Call
    if (job.makeCall) {
        const vapiConfigured = process.env.VAPI_API_KEY && process.env.VAPI_ASSISTANT_ID && process.env.VAPI_PHONE_NUMBER_ID;
        const callInput = fs.existsSync(job.files.outreach) ? job.files.outreach
                        : fs.existsSync(job.files.enriched) ? job.files.enriched
                        : job.files.leads;
        if (vapiConfigured) {
            pushLog(jobId, '📞 Placing AI call via Vapi…', 'step');
            job.step = 7;
            await runChild(jobId, 'node', [
                path.join(__dirname, '..', 'src', 'node', 'make_calls.js'),
                '--input', callInput,
                '--log', job.files.callLog,
                '--limit', '1',
                '--delay', '0',
            ]);
            pushLog(jobId, '✅ AI call placed.', 'success');
        } else {
            pushLog(jobId, '⚠️  Call skipped — Vapi env vars not configured.', 'warn');
        }
    }

    job.status = 'done';
    job.step = 8;
    pushLog(jobId, '🎉 Done! Single-business pipeline complete.', 'success');
    broadcast(jobId, { type: 'done', status: 'done', files: job.files });

    n8nService.notifyPipelineEvent('single_business_complete', {
        jobId,
        city: job.city,
        files: job.files,
    });
}

module.exports = { runPipeline, runSingleBusiness, runChild, countCsvRows };
