#!/usr/bin/env node
/**
 * generate_site.js
 * ================
 * Generates a personalized HTML demo site for each smoke shop lead.
 * Sites are served by the Express server at /demo/:slug
 *
 * Usage:
 *   node generate_site.js --input data/houston-tx/audited_leads.csv
 *                         --output data/houston-tx/demo_leads.csv
 *                         --sites-dir data/demos
 *                         --base-url https://smokeshopgrowth-production.up.railway.app
 */
'use strict';
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const csv  = require('csv-parser');
const { stringify } = require('fast-csv');

const args    = process.argv.slice(2);
const getArg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i+1] : def; };

const INPUT_FILE = getArg('--input',     'data/audited_leads.csv');
const OUTPUT_FILE= getArg('--output',    INPUT_FILE.replace('audited_leads','demo_leads'));
const SITES_DIR  = getArg('--sites-dir', 'data/demos');
const BASE_URL   = getArg('--base-url',  process.env.DEMO_BASE_URL || 'http://localhost:3000');
const CONTACT_PHONE = process.env.CONTACT_PHONE || '8552503624';
const TEMPLATE   = fs.readFileSync(path.join(__dirname, '../../templates/smoke-shop-sites/index.html'), 'utf8');

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function stars(rating) {
  const r = Math.round(parseFloat(rating) || 0);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
}

function splitName(name) {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return [name, ''];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function buildSite(lead) {
  const name    = (lead.business_name || 'Smoke Shop').trim();
  const city    = (lead.city || '').trim();
  const state   = (lead.state || 'TX').trim();
  const address = (lead.address || '').trim();
  const phone   = (lead.phone || '').trim();
  const rating  = parseFloat(lead.rating) || 4.5;
  const reviews = lead.review_count || '50+';
  const hours   = lead.hours || 'Mon–Sun 9am–10pm';

  const phoneClean = phone.replace(/\D/g, '');
  const [line1, line2] = splitName(name);
  const addrEncoded = encodeURIComponent(`${name}, ${address}, ${city}, ${state}`);

  return TEMPLATE
    .replace(/\{\{BUSINESS_NAME\}\}/g, name)
    .replace(/\{\{BUSINESS_NAME_LINE1\}\}/g, line1)
    .replace(/\{\{BUSINESS_NAME_LINE2\}\}/g, line2 || name)
    .replace(/\{\{CITY\}\}/g, city)
    .replace(/\{\{STATE\}\}/g, state)
    .replace(/\{\{ADDRESS\}\}/g, address)
    .replace(/\{\{ADDRESS_ENCODED\}\}/g, addrEncoded)
    .replace(/\{\{PHONE\}\}/g, phone || 'Call us')
    .replace(/\{\{PHONE_CLEAN\}\}/g, phoneClean)
    .replace(/\{\{RATING\}\}/g, rating.toFixed(1))
    .replace(/\{\{REVIEW_COUNT\}\}/g, reviews)
    .replace(/\{\{STARS\}\}/g, stars(rating))
    .replace(/\{\{HOURS\}\}/g, hours)
    .replace(/\{\{CONTACT_PHONE\}\}/g, `+1${CONTACT_PHONE}`)
    .replace(/\{\{CONTACT_PHONE_LINK\}\}/g, `tel:+1${CONTACT_PHONE}`);
}

async function main() {
  const leads = await new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(INPUT_FILE)
      .pipe(csv())
      .on('data', r => rows.push(r))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });

  console.log(`\n🌐 Demo Site Generator`);
  console.log(`   Input: ${INPUT_FILE} (${leads.length} leads)`);
  console.log(`   Output dir: ${SITES_DIR}\n`);

  fs.mkdirSync(SITES_DIR, { recursive: true });

  const results = [];
  let success = 0, skip = 0;

  for (const lead of leads) {
    if (!lead.business_name) { results.push(lead); skip++; continue; }

    const s = slug(lead.business_name);
    const filePath = path.join(SITES_DIR, `${s}.html`);
    const demoUrl  = `${BASE_URL}/demo/${s}`;

    try {
      const html = buildSite(lead);
      fs.writeFileSync(filePath, html, 'utf8');
      results.push({ ...lead, demo_url: demoUrl, demo_slug: s, demo_status: 'generated' });
      console.log(`  ✅ ${lead.business_name} → /demo/${s}`);
      success++;
    } catch (err) {
      results.push({ ...lead, demo_url: '', demo_slug: '', demo_status: `failed: ${err.message}` });
      console.error(`  ❌ ${lead.business_name}: ${err.message}`);
    }
  }

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(OUTPUT_FILE);
    const stream = stringify({ headers: true });
    stream.pipe(ws);
    results.forEach(r => stream.write(r));
    stream.end();
    ws.on('finish', resolve);
    ws.on('error', reject);
  });

  console.log(`\n✅ Done! Generated ${success} sites, skipped ${skip}`);
  console.log(`   Output CSV: ${OUTPUT_FILE}`);
  console.log(`   Sites dir: ${SITES_DIR}\n`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
