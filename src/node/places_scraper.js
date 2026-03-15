/**
 * Google Places API Lead Scraper + Opportunity Scorer
 * =====================================================
 * Scrapes → Audits → Scores → Outputs pipeline-ready leads.
 *
 * Scoring:
 *   +30  No website (🔥 hot prospect)
 *   +20  Website loads > 4s
 *   +10  Website loads > 2s
 *   +15  Missing <title> tag
 *   +10  Missing meta description
 *   +10  Missing H1 tag
 *   +10  Rating < 4.0
 *   +15  Rating < 3.5
 *   +10  Reviews < 50
 *   +15  Reviews < 20
 *
 * Usage:
 *   node src/node/places_scraper.js --city "Houston" --type "smoke shop"
 *   node src/node/places_scraper.js --city "Houston" --type "smoke shop" --output houston.csv
 *
 * Requires: GOOGLE_PLACES_API_KEY in .env
 */

require('dotenv').config();
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!API_KEY) {
  console.error('❌ GOOGLE_PLACES_API_KEY not found in .env');
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────
const DETAIL_FIELDS = [
  'name',
  'formatted_address',
  'formatted_phone_number',
  'website',
  'rating',
  'user_ratings_total',
  'url',
  'photos',
  'place_id',
].join(',');

const CSV_FIELDS = [
  'business_name',
  'address',
  'phone',
  'website',
  'rating',
  'review_count',
  'google_maps_url',
  'image_url',
  'place_id',
  'has_website',
  'speed_ms',
  'has_title',
  'has_meta_desc',
  'has_h1',
  'score',
  'issues',
];

// ─── Helpers ──────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function escapeCSV(value) {
  const str = String(value || '');
  return `"${str.replace(/"/g, '""')}"`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { city: '', bizType: 'smoke shop', output: 'leads.csv', maxResults: 200 };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--city': opts.city = args[++i]; break;
      case '--type': opts.bizType = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--max': opts.maxResults = parseInt(args[++i], 10); break;
    }
  }
  if (!opts.city) {
    console.error('Error: --city is required.\nUsage: node places_scraper.js --city "Houston" --type "smoke shop"');
    process.exit(1);
  }
  return opts;
}

// ─── CSV Load/Save ───────────────────────────────────────
function loadExisting(filePath) {
  const rows = [];
  const seenIds = new Set();
  if (!fs.existsSync(filePath)) return { rows, seenIds };

  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return { rows, seenIds };

  const lines = raw.split('\n');
  const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());

  for (let i = 1; i < lines.length; i++) {
    let inQuote = false;
    let val = '';
    const vals = [];
    for (const ch of lines[i]) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { vals.push(val.trim()); val = ''; }
      else { val += ch; }
    }
    vals.push(val.trim());
    const row = {};
    headers.forEach((h, idx) => { row[h] = vals[idx] || ''; });
    if (row.place_id) seenIds.add(row.place_id);
    rows.push(row);
  }

  console.log(`📂 Loaded ${rows.length} existing records from ${filePath}`);
  return { rows, seenIds };
}

function saveCSV(filePath, results) {
  if (!results.length) { console.log('⚠️  No results to save.'); return; }
  const header = CSV_FIELDS.map(escapeCSV).join(',');
  const lines = results.map((r) => CSV_FIELDS.map((f) => escapeCSV(r[f])).join(','));
  fs.writeFileSync(filePath, [header, ...lines].join('\n'), 'utf-8');
  console.log(`💾 Saved ${results.length} records to ${filePath}`);
}

// ─── Places API ──────────────────────────────────────────
async function searchPlaces(query, location) {
  const results = [];
  let nextPageToken = null;

  do {
    const url = nextPageToken
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${nextPageToken}&key=${API_KEY}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' in ' + location)}&key=${API_KEY}`;

    const response = await axios.get(url);
    const data = response.data;

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error(`⚠️  API error: ${data.status} — ${data.error_message || ''}`);
      break;
    }

    results.push(...(data.results || []));
    nextPageToken = data.next_page_token;

    if (nextPageToken) await sleep(2000);
  } while (nextPageToken);

  return results;
}

async function getPlaceDetails(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${DETAIL_FIELDS}&key=${API_KEY}`;
    const response = await axios.get(url);
    return response.data.result || {};
  } catch (err) {
    console.error(`  ⚠️  Details error for ${placeId}: ${err.message}`);
    return {};
  }
}

function getPhotoUrl(photos) {
  if (!photos || !photos.length) return '';
  const ref = photos[0].photo_reference;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${ref}&key=${API_KEY}`;
}

// ─── Website Speed Check ─────────────────────────────────
async function checkWebsiteSpeed(url) {
  const start = Date.now();
  try {
    await axios.get(url, { timeout: 5000, maxRedirects: 3 });
    return Date.now() - start;
  } catch {
    return 9999;
  }
}

// ─── SEO Audit ───────────────────────────────────────────
async function auditSEO(url) {
  try {
    const { data: html } = await axios.get(url, { timeout: 5000, maxRedirects: 3 });
    const $ = cheerio.load(html);
    return {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      h1: $('h1').first().text().trim(),
    };
  } catch {
    return { title: '', description: '', h1: '' };
  }
}

// ─── Opportunity Scoring ─────────────────────────────────
function scoreLead(biz) {
  let score = 0;
  const issues = [];

  // No website — hottest prospect
  if (!biz.website) {
    score += 30;
    issues.push('No website');
  } else {
    // Website speed
    const speed = parseInt(biz.speed_ms, 10) || 0;
    if (speed > 4000) {
      score += 20;
      issues.push(`Slow site (${(speed / 1000).toFixed(1)}s)`);
    } else if (speed > 2000) {
      score += 10;
      issues.push(`Moderate speed (${(speed / 1000).toFixed(1)}s)`);
    }

    // SEO issues
    if (biz.has_title === 'no') {
      score += 15;
      issues.push('Missing title tag');
    }
    if (biz.has_meta_desc === 'no') {
      score += 10;
      issues.push('Missing meta description');
    }
    if (biz.has_h1 === 'no') {
      score += 10;
      issues.push('Missing H1 tag');
    }
  }

  // Rating
  const rating = parseFloat(biz.rating) || 0;
  if (rating > 0 && rating < 3.5) {
    score += 15;
    issues.push(`Low rating (${rating})`);
  } else if (rating > 0 && rating < 4.0) {
    score += 10;
    issues.push(`Below-average rating (${rating})`);
  }

  // Reviews
  const reviews = parseInt(biz.review_count, 10) || 0;
  if (reviews < 20) {
    score += 15;
    issues.push(`Only ${reviews} reviews`);
  } else if (reviews < 50) {
    score += 10;
    issues.push(`Low reviews (${reviews})`);
  }

  return { score, issues: issues.join('; ') };
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  console.log('═'.repeat(60));
  console.log('  Google Places API Lead Scraper + Scorer');
  console.log(`  City   : ${opts.city}`);
  console.log(`  Type   : ${opts.bizType}`);
  console.log(`  Max    : ${opts.maxResults}`);
  console.log(`  Output : ${opts.output}`);
  console.log('═'.repeat(60));

  const { rows: existingRows, seenIds } = loadExisting(opts.output);
  const results = [...existingRows];
  const startTime = Date.now();

  // Phase 1: Text Search
  console.log(`\n🔍 Searching: "${opts.bizType}" in ${opts.city}...`);
  const places = await searchPlaces(opts.bizType, opts.city);
  console.log(`📋 Found ${places.length} results from Text Search API`);

  const newPlaces = places.filter((p) => !seenIds.has(p.place_id));
  const budget = Math.min(newPlaces.length, Math.max(0, opts.maxResults - existingRows.length));
  const toProcess = newPlaces.slice(0, budget);

  console.log(`🆕 ${toProcess.length} new businesses to process\n`);

  if (!toProcess.length) {
    console.log('⚠️  No new listings. Exiting.');
    return;
  }

  // Phase 2: Details + Audit + Score
  let hotCount = 0;
  for (let i = 0; i < toProcess.length; i++) {
    const place = toProcess[i];
    const idx = i + 1;

    try {
      const details = await getPlaceDetails(place.place_id);

      const biz = {
        business_name: details.name || place.name || '',
        address: details.formatted_address || place.formatted_address || '',
        phone: details.formatted_phone_number || '',
        website: details.website || '',
        rating: String(details.rating || place.rating || ''),
        review_count: String(details.user_ratings_total || ''),
        google_maps_url: details.url || '',
        image_url: getPhotoUrl(details.photos || place.photos),
        place_id: place.place_id,
        has_website: details.website ? 'yes' : 'no',
        speed_ms: '',
        has_title: '',
        has_meta_desc: '',
        has_h1: '',
        score: '0',
        issues: '',
      };

      // Website audit (if they have a website)
      if (biz.website) {
        // Speed check
        const speed = await checkWebsiteSpeed(biz.website);
        biz.speed_ms = String(speed);

        // SEO audit (reuse the response if speed was OK)
        if (speed < 9999) {
          const seo = await auditSEO(biz.website);
          biz.has_title = seo.title ? 'yes' : 'no';
          biz.has_meta_desc = seo.description ? 'yes' : 'no';
          biz.has_h1 = seo.h1 ? 'yes' : 'no';
        } else {
          biz.has_title = 'no';
          biz.has_meta_desc = 'no';
          biz.has_h1 = 'no';
        }
      }

      // Score the lead
      const { score, issues } = scoreLead(biz);
      biz.score = String(score);
      biz.issues = issues;

      seenIds.add(place.place_id);
      results.push(biz);

      const icon = score >= 50 ? '🔥' : score >= 30 ? '⚡' : '✓';
      if (score >= 50) hotCount++;
      console.log(`  [${idx}/${toProcess.length}] ${icon} ${biz.business_name} | Score: ${score} | ${issues || 'clean'}`);

      // Periodic save
      if (idx % 20 === 0) saveCSV(opts.output, results);

      await sleep(150);
    } catch (err) {
      console.log(`  [${idx}/${toProcess.length}] ⚠️  Error: ${err.message}`);
    }
  }

  saveCSV(opts.output, results);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ✅ Done in ${elapsed}s`);
  console.log(`  📊 Total records : ${results.length}`);
  console.log(`  🔥 Hot prospects : ${hotCount} (score ≥ 50)`);
  console.log('═'.repeat(60));
}

main().catch(console.error);
