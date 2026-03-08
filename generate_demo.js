/**
 * generate_demo.js
 * ================
 * Uses Minimax T2V API to generate a short demo video for each business.
 * The video shows a sleek modern website concept for the shop.
 * Prioritizes businesses with no website or a poor audit score.
 *
 * Usage:
 *   node generate_demo.js --input data/houston-tx/audited_leads.csv
 *                         --output data/houston-tx/demo_leads.csv
 *                         --limit 10
 *
 * Output adds columns: demo_video_url, demo_video_path, demo_status
 */

'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const csv = require('csv-parser');
const { stringify } = require('fast-csv');

// ── Args ─────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : def;
};

const INPUT_FILE = getArg('--input', 'data/audited_leads.csv');
const OUTPUT_FILE = getArg('--output', INPUT_FILE.replace('audited_leads', 'demo_leads'));
const LIMIT = parseInt(getArg('--limit', '20'));
const DRY_RUN = args.includes('--dry-run');
const VIDEOS_DIR = getArg('--videos-dir', 'data/videos');

const API_KEY = process.env.MINIMAX_API_KEY;
const API_BASE = 'https://api.minimax.io/v1';

if (!API_KEY) {
    console.error('❌  MINIMAX_API_KEY not set in .env');
    process.exit(1);
}

// ── Helpers ───────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function buildVideoPrompt(business) {
    const name = business.business_name || 'Local Smoke Shop';
    const city = business.city || '';
    const rating = parseFloat(business.rating) || 0;
    const reviews = business.review_count || '';

    return [
        `Cinematic screen recording of a modern, premium smoke shop website for "${name}"${city ? ' in ' + city : ''}.`,
        `The website has a sleek dark theme with gold accents, hero section with the shop name,`,
        `a product grid showing hookahs, vapes, and accessories, a Google Maps section showing location,`,
        `and a contact button. Smooth scroll animations. Professional and clean design.`,
        rating >= 4 ? `Star rating badge showing ${rating} stars and ${reviews} reviews.` : '',
        `Camera slowly pans across the homepage. No text overlays. Photorealistic UI.`,
    ].filter(Boolean).join(' ');
}

// ── Minimax T2V API ───────────────────────────
async function submitVideoJob(prompt) {
    const body = JSON.stringify({
        model: 'video-01',
        prompt,
    });

    const res = await fetch(`${API_BASE}/video_generation`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
        },
        body,
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.base_resp?.status_msg || JSON.stringify(data));
    return data.task_id;
}

async function pollVideoJob(taskId, maxWaitMs = 300_000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        await sleep(8000);
        const res = await fetch(`${API_BASE}/query/video_generation?task_id=${taskId}`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` },
        });
        const data = await res.json();
        const status = data.status;

        if (status === 'Success') return data.file_id;
        if (status === 'Fail') throw new Error(`Video generation failed: ${data.base_resp?.status_msg}`);
        process.stdout.write('.');
    }
    throw new Error(`Timed out waiting for video (task: ${taskId})`);
}

async function getDownloadUrl(fileId) {
    const res = await fetch(`${API_BASE}/files/retrieve?file_id=${fileId}`, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.base_resp?.status_msg || JSON.stringify(data));
    return data.file?.download_url;
}

async function downloadVideo(url, destPath) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        proto.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlink(destPath, () => {});
                return downloadVideo(res.headers.location, destPath).then(resolve, reject);
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(destPath); });
        }).on('error', err => {
            fs.unlink(destPath, () => { });
            reject(err);
        });
    });
}

// ── Main ──────────────────────────────────────
async function main() {
    // Load leads
    const leads = await new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(INPUT_FILE)
            .pipe(csv())
            .on('data', r => rows.push(r))
            .on('end', () => resolve(rows))
            .on('error', reject);
    });

    console.log(`\n📹 Minimax Demo Video Generator`);
    console.log(`   Input:  ${INPUT_FILE} (${leads.length} leads)`);
    console.log(`   Limit:  ${LIMIT}`);
    console.log(`   Dry run: ${DRY_RUN}\n`);

    // Prioritise: no website first, then low rating
    const prioritised = leads
        .filter(l => l.business_name)
        .sort((a, b) => {
            // no website first
            if (!a.website && b.website) return -1;
            if (a.website && !b.website) return 1;
            // then lowest rating
            return parseFloat(a.rating || 5) - parseFloat(b.rating || 5);
        })
        .slice(0, LIMIT);

    console.log(`   Processing ${prioritised.length} prioritised leads...\n`);

    if (DRY_RUN) {
        prioritised.forEach((l, i) => {
            console.log(`[${i + 1}] ${l.business_name}`);
            console.log(`    Prompt: ${buildVideoPrompt(l).slice(0, 120)}...`);
        });
        console.log('\n[dry-run] No videos generated.');
        return;
    }

    fs.mkdirSync(VIDEOS_DIR, { recursive: true });

    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < prioritised.length; i++) {
        const lead = prioritised[i];
        const name = lead.business_name;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const prompt = buildVideoPrompt(lead);

        console.log(`\n[${i + 1}/${prioritised.length}] 🎬 ${name}`);
        console.log(`   Submitting video job...`);

        try {
            const taskId = await submitVideoJob(prompt);
            console.log(`   Task ID: ${taskId} — polling`, '');

            const fileId = await pollVideoJob(taskId);
            console.log(' done');

            const dlUrl = await getDownloadUrl(fileId);
            const vidPath = path.join(VIDEOS_DIR, `${slug}.mp4`);

            console.log(`   Downloading → ${vidPath}`);
            await downloadVideo(dlUrl, vidPath);

            results.push({ ...lead, demo_video_url: dlUrl, demo_video_path: vidPath, demo_status: 'success' });
            successCount++;

        } catch (err) {
            console.error(`\n   ❌ Failed: ${err.message}`);
            results.push({ ...lead, demo_video_url: '', demo_video_path: '', demo_status: `failed: ${err.message}` });
            failCount++;
        }

        // Pace requests
        if (i < prioritised.length - 1) await sleep(3000);
    }

    // Also include leads that were not processed (keep all rows in output)
    const processedNames = new Set(prioritised.map(l => l.business_name));
    leads
        .filter(l => !processedNames.has(l.business_name))
        .forEach(l => results.push({ ...l, demo_video_url: '', demo_video_path: '', demo_status: 'skipped' }));

    // Write output CSV
    await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(OUTPUT_FILE);
        const stream = stringify({ headers: true });
        stream.pipe(ws);
        results.forEach(r => stream.write(r));
        stream.end();
        ws.on('finish', resolve);
        ws.on('error', reject);
    });

    console.log(`\n✅  Done!`);
    console.log(`   Generated: ${successCount} videos`);
    console.log(`   Failed:    ${failCount}`);
    console.log(`   Output:    ${OUTPUT_FILE}`);
    console.log(`   Videos:    ${VIDEOS_DIR}/\n`);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
