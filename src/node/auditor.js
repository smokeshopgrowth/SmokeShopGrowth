#!/usr/bin/env node
/**
 * Website Auditor
 * ===============
 * Reads data/leads.csv, audits each business website, and saves results
 * to data/audited_leads.csv.
 *
 * Usage:
 *   node auditor.js [--concurrency N] [--skip-lighthouse] [--input PATH] [--output PATH]
 *
 * Flags:
 *   --concurrency N      Parallel workers (default: 5)
 *   --skip-lighthouse    Skip Lighthouse (faster, no mobile/perf score)
 *   --input PATH         Input CSV  (default: data/leads.csv)
 *   --output PATH        Output CSV (default: data/audited_leads.csv)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { createReadStream, mkdirSync } = require('fs');

const axios = require('axios');
const cheerio = require('cheerio');
const csv = require('csv-parser');
const { format } = require('@fast-csv/format');
const pLimit = require('p-limit');
const chromeLauncher = require('chrome-launcher');
const lighthouse = require('lighthouse');

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
};
const hasFlag = (flag) => args.includes(flag);

const CONCURRENCY = parseInt(getArg('--concurrency', '5'), 10);
const SKIP_LIGHTHOUSE = hasFlag('--skip-lighthouse');
const INPUT_FILE = getArg('--input', 'data/leads.csv');
const OUTPUT_FILE = getArg('--output', 'data/audited_leads.csv');
const AXIOS_TIMEOUT_MS = 12_000;
const LH_TIMEOUT_MS = 45_000;

// ──────────────────────────────────────────────
// Output columns
// ──────────────────────────────────────────────
const OUTPUT_COLUMNS = [
    'business_name',
    'website',
    'has_website',
    'website_status',
    'ssl',
    'load_time',
    'mobile_friendly',
    'audit_summary',
];

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Normalise a URL — prepend https:// if protocol is missing. */
function normaliseUrl(raw) {
    if (!raw || !raw.trim()) return null;
    let url = raw.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try {
        new URL(url); // validate
        return url;
    } catch {
        return null;
    }
}

/** Log with timestamp prefix. */
function log(msg) {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
}

// ──────────────────────────────────────────────
// Phase 1 — fast HTTP + Cheerio audit
// ──────────────────────────────────────────────

/**
 * Perform a fast HTTP audit of a URL using Axios + Cheerio.
 * Returns: { status, ssl, loadTime, html, issues }
 */
async function fastAudit(url) {
    const start = Date.now();
    let response;

    try {
        response = await axios.get(url, {
            timeout: AXIOS_TIMEOUT_MS,
            maxRedirects: 5,
            validateStatus: () => true, // never throw on HTTP errors
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Linux; Android 11; Pixel 5) ' +
                    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                    'Chrome/122.0.0.0 Mobile Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            httpsAgent: new https.Agent(),
            httpAgent: new http.Agent(),
        });
    } catch (err) {
        return {
            status: 0,
            ssl: url.startsWith('https://'),
            loadTime: null,
            html: '',
            issues: [`Connection failed: ${err.code || err.message}`],
        };
    }

    const loadTime = ((Date.now() - start) / 1000).toFixed(2);
    const ssl = /^https:\/\//i.test(response.config?.url || url);
    const status = response.status;
    const html = typeof response.data === 'string' ? response.data : '';

    const issues = analyseHtml(html, url, ssl, parseFloat(loadTime));

    return { status, ssl, loadTime, html, issues };
}

/**
 * Parse HTML with Cheerio and detect design/tech issues.
 * Returns an array of human-readable issue strings.
 */
function analyseHtml(html, url, ssl, loadTimeSec) {
    const issues = [];

    if (!ssl) issues.push('No SSL (HTTP only)');
    if (loadTimeSec > 4) issues.push(`Slow load time (${loadTimeSec}s)`);
    else if (loadTimeSec > 2) issues.push(`Moderate load time (${loadTimeSec}s)`);

    if (!html) return issues;

    const $ = cheerio.load(html);

    // Mobile viewport
    const hasViewport = $('meta[name="viewport"]').length > 0;
    if (!hasViewport) issues.push('Missing mobile viewport meta tag');

    // Title tag
    const title = $('title').text().trim();
    if (!title) issues.push('Missing <title> tag');

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content') || '';
    if (!metaDesc) issues.push('Missing meta description');

    // Images without alt
    const imgsTotal = $('img').length;
    const imgsMissingAlt = $('img:not([alt]), img[alt=""]').length;
    if (imgsTotal > 0 && imgsMissingAlt > imgsTotal / 2) {
        issues.push(`${imgsMissingAlt}/${imgsTotal} images missing alt text`);
    }

    // Detect table-based layouts (sign of very old sites)
    const tableCount = $('table').length;
    const tdCount = $('td').length;
    if (tableCount > 3 && tdCount > 20) {
        issues.push('Likely table-based layout (outdated design)');
    }

    // No semantic HTML5 landmarks
    const hasNav = $('nav, [role="navigation"]').length > 0;
    const hasMain = $('main, [role="main"]').length > 0;
    const hasHeader = $('header, [role="banner"]').length > 0;
    if (!hasNav && !hasMain && !hasHeader) {
        issues.push('No semantic HTML5 landmarks (header/nav/main)');
    }

    // Inline styles heavy use = old CMS / bad practice
    const inlineStyleCount = $('[style]').length;
    if (inlineStyleCount > 30) {
        issues.push(`Excessive inline styles (${inlineStyleCount} elements)`);
    }

    // No Open Graph / social meta
    const hasOG = $('meta[property^="og:"]').length > 0;
    if (!hasOG) issues.push('No Open Graph social meta tags');

    return issues;
}

// ──────────────────────────────────────────────
// Phase 2 — Lighthouse audit
// ──────────────────────────────────────────────

let sharedChromePort = null;
let chromeProcess = null;

async function launchSharedChrome() {
    if (chromeProcess) return sharedChromePort;
    chromeProcess = await chromeLauncher.launch({
        chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'],
    });
    sharedChromePort = chromeProcess.port;
    log(`Chrome launched on port ${sharedChromePort}`);
    return sharedChromePort;
}

async function killSharedChrome() {
    if (chromeProcess) {
        await chromeProcess.kill();
        chromeProcess = null;
        sharedChromePort = null;
    }
}

/**
 * Run Lighthouse on a URL and return key metrics.
 * Returns null on error.
 */
async function lighthouseAudit(url) {
    try {
        const port = await launchSharedChrome();
        const result = await lighthouse(url, {
            port,
            output: 'json',
            logLevel: 'error',
            formFactor: 'mobile',
            screenEmulation: {
                mobile: true,
                width: 412,
                height: 823,
                deviceScaleFactor: 1.75,
                disabled: false,
            },
            throttlingMethod: 'simulate',
            onlyCategories: ['performance', 'best-practices'],
        }, {
            extends: 'lighthouse:default',
            settings: { maxWaitForLoad: LH_TIMEOUT_MS },
        });

        const lhr = result.lhr;
        const perf = lhr.categories?.performance?.score;
        const bestPrac = lhr.categories?.['best-practices']?.score;

        // Mobile friendly = performance ≥ 0.5 AND has viewport (already checked in Cheerio)
        const mobileFriendly = perf !== null && perf >= 0.5;

        // Lighthouse-reported FCP / LCP
        const fcp = lhr.audits?.['first-contentful-paint']?.displayValue || '';
        const lcp = lhr.audits?.['largest-contentful-paint']?.displayValue || '';

        return {
            mobileFriendly,
            perfScore: perf !== null ? Math.round(perf * 100) : null,
            bpScore: bestPrac !== null ? Math.round(bestPrac * 100) : null,
            fcp,
            lcp,
        };
    } catch (err) {
        log(`  ⚠  Lighthouse failed for ${url}: ${err.message}`);
        return null;
    }
}

// ──────────────────────────────────────────────
// Summary builder
// ──────────────────────────────────────────────

function buildSummary({ hasWebsite, websiteStatus, ssl, loadTime, mobileFriendly, issues, lhData }) {
    if (!hasWebsite) {
        return 'No website found — could benefit from a modern online presence.';
    }

    if (!websiteStatus || websiteStatus === 0) {
        return 'Website is unreachable — visitors cannot access the site.';
    }

    if (websiteStatus >= 400) {
        return `Website returns error ${websiteStatus} — site may be broken or misconfigured.`;
    }

    if (issues.length === 0) {
        const loadStr = loadTime ? ` in ${loadTime}s` : '';
        return `Website loads successfully${loadStr} with SSL and appears well-optimised.`;
    }

    const topIssues = issues.slice(0, 3).join('; ');
    const extra = issues.length > 3 ? ` (+${issues.length - 3} more)` : '';
    const loadStr = loadTime ? ` Load: ${loadTime}s.` : '';
    const sslStr = ssl ? '' : ' No SSL.';

    return `Issues found: ${topIssues}${extra}.${sslStr}${loadStr}`;
}

// ──────────────────────────────────────────────
// Per-lead audit
// ──────────────────────────────────────────────

async function auditLead(lead, idx, total) {
    const { business_name = '', website: rawWebsite = '' } = lead;
    const label = `[${idx}/${total}] ${business_name}`;

    const url = normaliseUrl(rawWebsite);

    if (!url) {
        log(`${label} — no website`);
        return {
            business_name,
            website: rawWebsite || '',
            has_website: 'No',
            website_status: '',
            ssl: 'No',
            load_time: '',
            mobile_friendly: '',
            audit_summary: 'No website found — could benefit from a modern online presence.',
        };
    }

    log(`${label} → ${url}`);

    // Fast HTTP + Cheerio check
    const fast = await fastAudit(url);
    let issues = [...fast.issues];

    let mobileFriendly = null;
    let lhData = null;

    if (!SKIP_LIGHTHOUSE && fast.status > 0 && fast.status < 400) {
        lhData = await lighthouseAudit(url);
        if (lhData) {
            mobileFriendly = lhData.mobileFriendly;
            if (!mobileFriendly) issues.push('Not mobile-friendly (Lighthouse)');
            if (lhData.perfScore !== null && lhData.perfScore < 50) {
                issues.push(`Low Lighthouse performance score (${lhData.perfScore}/100)`);
            }
        }
    }

    // Fallback mobile-friendly check from Cheerio (viewport tag)
    if (mobileFriendly === null) {
        const hasViewportInIssues = issues.some(i => i.includes('viewport'));
        mobileFriendly = !hasViewportInIssues;
    }

    const statusOk = fast.status > 0 && fast.status < 400;

    const summary = buildSummary({
        hasWebsite: true,
        websiteStatus: fast.status,
        ssl: fast.ssl,
        loadTime: fast.loadTime,
        mobileFriendly,
        issues,
        lhData,
    });

    log(
        `  ✓ status=${fast.status} ssl=${fast.ssl} load=${fast.loadTime}s ` +
        `mobile=${mobileFriendly} issues=${issues.length}`
    );

    return {
        business_name,
        website: url,
        has_website: 'Yes',
        website_status: fast.status || 'Error',
        ssl: fast.ssl ? 'Yes' : 'No',
        load_time: fast.loadTime ? `${fast.loadTime}s` : '',
        mobile_friendly: mobileFriendly ? 'Yes' : 'No',
        audit_summary: summary,
    };
}

// ──────────────────────────────────────────────
// CSV I/O
// ──────────────────────────────────────────────

function readLeads(filePath) {
    return new Promise((resolve, reject) => {
        const leads = [];
        if (!fs.existsSync(filePath)) {
            return reject(new Error(`Input file not found: ${filePath}`));
        }
        createReadStream(filePath)
            .pipe(csv())
            .on('data', row => leads.push(row))
            .on('end', () => resolve(leads))
            .on('error', reject);
    });
}

function writeResults(filePath, rows) {
    return new Promise((resolve, reject) => {
        mkdirSync(path.dirname(filePath), { recursive: true });
        const ws = fs.createWriteStream(filePath);
        const stream = format({ headers: OUTPUT_COLUMNS });
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
    console.log(' Website Auditor');
    console.log(`  Input       : ${INPUT_FILE}`);
    console.log(`  Output      : ${OUTPUT_FILE}`);
    console.log(`  Concurrency : ${CONCURRENCY}`);
    console.log(`  Lighthouse  : ${SKIP_LIGHTHOUSE ? 'disabled (fast mode)' : 'enabled'}`);
    console.log('='.repeat(60));

    // 1. Read leads
    let leads;
    try {
        leads = await readLeads(INPUT_FILE);
    } catch (err) {
        console.error('ERROR:', err.message);
        process.exit(1);
    }
    log(`Loaded ${leads.length} leads from ${INPUT_FILE}`);

    if (leads.length === 0) {
        console.warn('No leads found in the input file. Exiting.');
        process.exit(0);
    }

    // 2. Launch Chrome once (if Lighthouse is enabled)
    if (!SKIP_LIGHTHOUSE) {
        await launchSharedChrome();
    }

    // 3. Audit with concurrency control
    // Lighthouse is heavy — cap its concurrency at 2 regardless of flag
    const effectiveConcurrency = SKIP_LIGHTHOUSE ? CONCURRENCY : Math.min(CONCURRENCY, 2);
    const limit = pLimit(effectiveConcurrency);
    const total = leads.length;
    const start = Date.now();

    const tasks = leads.map((lead, i) =>
        limit(() => auditLead(lead, i + 1, total))
    );

    let results = [];
    try {
        results = await Promise.all(tasks);
    } catch (err) {
        log(`Fatal error during auditing: ${err.message}`);
    } finally {
        if (!SKIP_LIGHTHOUSE) await killSharedChrome();
    }

    // 4. Write results
    if (results.length > 0) {
        await writeResults(OUTPUT_FILE, results);
    } else {
        log('No results to write.');
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log('='.repeat(60));
    log(`Done! Audited ${results.length} leads in ${elapsed}s.`);
    log(`Results saved to: ${OUTPUT_FILE}`);

    // 5. Quick stats
    const hasWebsite = results.filter(r => r.has_website === 'Yes').length;
    const noWebsite = results.filter(r => r.has_website === 'No').length;
    const siteUp = results.filter(r => r.website_status && r.website_status < 400 && r.website_status > 0).length;
    const sslEnabled = results.filter(r => r.ssl === 'Yes').length;
    const mobileFriendly = results.filter(r => r.mobile_friendly === 'Yes').length;

    console.log('\n📊 Audit Summary:');
    console.log(`  Total leads    : ${total}`);
    console.log(`  Has website    : ${hasWebsite} (${pct(hasWebsite, total)})`);
    console.log(`  No website     : ${noWebsite} (${pct(noWebsite, total)})`);
    console.log(`  Site up (2xx/3xx): ${siteUp}`);
    console.log(`  SSL enabled    : ${sslEnabled} (${pct(sslEnabled, hasWebsite)})`);
    console.log(`  Mobile friendly: ${mobileFriendly} (${pct(mobileFriendly, hasWebsite)})`);
    console.log('='.repeat(60));
}

function pct(n, d) {
    return d === 0 ? '0%' : `${Math.round((n / d) * 100)}%`;
}

main().catch(err => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
