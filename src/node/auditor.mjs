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

import "dotenv/config";
import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { createReadStream, mkdirSync } from "fs";
import { readCsv, writeCsv } from './utils/csv.mjs';

async function readExistingAudits() {
    try {
        const rows = await readCsv(OUTPUT_FILE);
        return rows;
    } catch {
        return [];
    }
}
import axios from "axios";
import * as cheerio from "cheerio";
import csv from "csv-parser";
import { format } from "@fast-csv/format";
import pLimit from "p-limit";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";
import logger from "./utils/logger.mjs";

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
// Output columns: We will preserve all input columns and add/update these:
const AUDIT_COLUMNS = [
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

// Audit result cache — keyed by normalized URL
const auditCache = new Map();

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

    const { issues, socials } = analyseHtml(html, url, ssl, parseFloat(loadTime));

    return { status, ssl, loadTime, html, issues, socials };
}

/**
 * Parse HTML with Cheerio and detect design/tech issues.
 * Returns an array of human-readable issue strings.
 */
function analyseHtml(html, url, ssl, loadTimeSec) {
    const issues = [];
    const socials = { instagram: '', facebook: '', email: '' };

    if (!ssl) issues.push('No SSL (HTTP only)');
    if (loadTimeSec > 4) issues.push(`Slow load time (${loadTimeSec}s)`);
    else if (loadTimeSec > 2) issues.push(`Moderate load time (${loadTimeSec}s)`);

    if (!html) return { issues, socials };

    const $ = cheerio.load(html);

    // Extract social links and mailto: emails
    const emailCandidates = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        const hrefLower = href.toLowerCase();
        if (hrefLower.includes('instagram.com/') && !socials.instagram) {
            socials.instagram = hrefLower;
        }
        if (hrefLower.includes('facebook.com/') && !socials.facebook) {
            socials.facebook = hrefLower;
        }
        // Extract mailto: links
        const mailtoMatch = hrefLower.match(/^mailto:([^\s?]+)/);
        if (mailtoMatch) {
            emailCandidates.push(mailtoMatch[1].trim());
        }
    });

    // Also scan page text for email patterns
    const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const bodyText = $.text();
    const textEmails = bodyText.match(EMAIL_RE) || [];
    emailCandidates.push(...textEmails.map(e => e.toLowerCase()));

    // Filter out false positives and pick the first valid email
    const FAKE_DOMAINS = ['example.com', 'sentry.io', 'sentry-next.wixpress.com', 'wixpress.com', 'placeholder.com'];
    const FAKE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
    const seen = new Set();
    for (const raw of emailCandidates) {
        const em = raw.toLowerCase().trim();
        if (seen.has(em)) continue;
        seen.add(em);
        const domain = em.split('@')[1] || '';
        if (FAKE_DOMAINS.some(d => domain === d || domain.endsWith('.' + d))) continue;
        if (FAKE_EXTENSIONS.some(ext => em.endsWith(ext))) continue;
        if (domain.startsWith('sentry')) continue;
        socials.email = em;
        break;
    }

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

    return { issues, socials };
}

// ──────────────────────────────────────────────
// Phase 2 — Lighthouse audit
// ──────────────────────────────────────────────

let sharedChromePort = null;
let chromeProcess = null;

async function lighthouseAudit(url) {
    let chrome;
    try {
        chrome = await chromeLauncher.launch({
            chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'],
        });
        const port = chrome.port;
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

        await chrome.kill();

        return {
            mobileFriendly,
            perfScore: perf !== null ? Math.round(perf * 100) : null,
            bpScore: bestPrac !== null ? Math.round(bestPrac * 100) : null,
            fcp,
            lcp,
        };
    } catch (err) {
        logger.warn(`Lighthouse failed for ${url}: ${err.message}`);
        if (chrome) await chrome.kill();
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
        logger.info(`${label} — no website`);
        return {
            ...lead,
            website: rawWebsite || '',
            has_website: 'No',
            website_status: '',
            ssl: 'No',
            load_time: '',
            mobile_friendly: '',
            audit_summary: 'No website found — could benefit from a modern online presence.',
        };

    }

    // Check cache for repeated URLs
    if (auditCache.has(url)) {
        logger.info(`${label} → ${url} (cached)`);
        const cached = auditCache.get(url);
        return {
            ...lead,
            website: cached.website,
            email: lead.email || cached.email || '',
            instagram: lead.instagram || cached.instagram || '',
            facebook: lead.facebook || cached.facebook || '',
            has_website: cached.has_website,
            website_status: cached.website_status,
            ssl: cached.ssl,
            load_time: cached.load_time,
            mobile_friendly: cached.mobile_friendly,
            audit_summary: cached.audit_summary,
        };
    }

    logger.info(`${label} → ${url}`);

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

    logger.info(
        `✓ status=${fast.status} ssl=${fast.ssl} load=${fast.loadTime}s ` +
        `mobile=${mobileFriendly} issues=${issues.length}`
    );

    const result = {
        ...lead,
        website: url,
        email: lead.email || fast.socials.email || '',
        instagram: lead.instagram || fast.socials.instagram || '',
        facebook: lead.facebook || fast.socials.facebook || '',
        has_website: 'Yes',
        website_status: fast.status || 'Error',
        ssl: fast.ssl ? 'Yes' : 'No',
        load_time: fast.loadTime ? `${fast.loadTime}s` : '',
        mobile_friendly: mobileFriendly ? 'Yes' : 'No',
        audit_summary: summary,
    };

    // Cache the result for future repeats
    auditCache.set(url, {
        website: url,
        email: result.email,
        instagram: result.instagram,
        facebook: result.facebook,
        has_website: result.has_website,
        website_status: result.website_status,
        ssl: result.ssl,
        load_time: result.load_time,
        mobile_friendly: result.mobile_friendly,
        audit_summary: result.audit_summary,
    });

    return result;
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
        // Extract all unique headers from all rows to ensure we don't miss anything
        const allHeaders = new Set();
        rows.forEach(r => Object.keys(r).forEach(k => allHeaders.add(k)));
        const stream = format({ headers: Array.from(allHeaders) });
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
    logger.info('Starting Website Auditor');
    logger.info(`Input: ${INPUT_FILE}`);
    logger.info(`Output: ${OUTPUT_FILE}`);
    logger.info(`Concurrency: ${CONCURRENCY}`);
    logger.info(`Lighthouse: ${SKIP_LIGHTHOUSE ? 'disabled' : 'enabled'}`);

    // 1. Load leads
    let leads;
    try {
        leads = await readCsv(INPUT_FILE);
    } catch (err) {
        logger.error(err.message);
        process.exit(1);
    }
    logger.info(`Loaded ${leads.length} leads`);

    // 2. Filter out already-audited leads
    const existingRows = await readExistingAudits();
    const auditedWebsites = new Set(existingRows.map(r => normaliseUrl(r.website)).filter(Boolean));
    const toAudit = leads.filter(l => l.website && !auditedWebsites.has(normaliseUrl(l.website)));

    logger.info(`Found ${toAudit.length} new leads to audit (${leads.length - toAudit.length} already done)`);

    // 3. Process new leads
    if (toAudit.length > 0) {
        const limit = pLimit(CONCURRENCY);
        const total = toAudit.length;
        const start = Date.now();

        const tasks = toAudit.map((lead, i) =>
            limit(() => auditLead(lead, i + 1, total))
        );

        const auditedLeads = await Promise.all(tasks);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        logger.info(`Audited ${auditedLeads.length} new leads in ${elapsed}s`);

        // Append new results to the output file
        await writeCsv(OUTPUT_FILE, [...existingRows, ...auditedLeads]);
    }
}


main().catch(err => {
    logger.error('Unhandled error:', err);
    process.exit(1);
});
