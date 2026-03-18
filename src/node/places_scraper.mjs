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

import "dotenv/config";
import axios from "axios";
import cheerio from "cheerio";
import fs from "fs";
import logger from "./utils/logger.mjs";
import { readCsv, writeCsv, escapeCSV } from "./utils/csv.mjs";

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!API_KEY) {
    logger.error("GOOGLE_PLACES_API_KEY not found in .env");
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
  'email',
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
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { city: '', bizType: 'smoke shop', output: 'leads.csv', maxResults: 200, grid: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--city': opts.city = args[++i]; break;
      case '--type': opts.bizType = args[++i]; break;
      case '--output': opts.output = args[++i]; break;
      case '--max': opts.maxResults = parseInt(args[++i], 10); break;
      case '--grid': opts.grid = true; break;
    }
  }
  if (!opts.city) {
    console.error('Error: --city is required.\nUsage: node places_scraper.js --city "Houston" --type "smoke shop"');
    process.exit(1);
  }
  return opts;
}

// ─── CSV Load/Save using shared utils ────────────────────
async function loadExisting(filePath) {
  const seenIds = new Set();
  let rows = [];
  try {
    rows = await readCsv(filePath);
    rows.forEach(r => { if (r.place_id) seenIds.add(r.place_id); });
    log(`📂 Loaded ${rows.length} existing records from ${filePath}`);
  } catch {
    // File doesn't exist yet, that's fine
  }
  return { rows, seenIds };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── CSV Load/Save using shared utils ────────────────────
async function loadExisting(filePath) {
  const seenIds = new Set();
  let rows = [];
  try {
    rows = await readCsv(filePath);
    rows.forEach(r => { if (r.place_id) seenIds.add(r.place_id); });
    logger.info(`Loaded ${rows.length} existing records from ${filePath}`);
  } catch {
    // File doesn't exist yet, that's fine
  }
  return { rows, seenIds };
}

function saveCSV(filePath, results) {
  if (!results.length) { logger.warn('No results to save.'); return; }
  const header = CSV_FIELDS.map(escapeCSV).join(',');
  const lines = results.map((r) => CSV_FIELDS.map((f) => escapeCSV(r[f])).join(','));
  fs.writeFileSync(filePath, [header, ...lines].join('\n'), 'utf-8');
  logger.info(`Saved ${results.length} records to ${filePath}`);
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
      logger.error(`API error: ${data.status} — ${data.error_message || ''}`);
      break;
    }

    results.push(...(data.results || []));
    nextPageToken = data.next_page_token;

    if (nextPageToken) await sleep(2000);
  } while (nextPageToken);

  return results;
}

/**
 * Fix #14 — Grid-based Nearby Search for more results.
 * Divides the city area into a grid and runs Nearby Search on each cell.
 */
async function searchPlacesGrid(query, location) {
  // First, geocode the city to get center coordinates
  const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(location)}&key=${API_KEY}`;
  const geoResp = await axios.get(geoUrl);
  const geoResult = geoResp.data.results?.[0];
  if (!geoResult) {
    logger.warn('Could not geocode city, falling back to text search');
    return searchPlaces(query, location);
  }

  const { lat, lng } = geoResult.geometry.location;
  const viewport = geoResult.geometry.viewport;

  // Calculate grid from viewport
  const latSpan = viewport.northeast.lat - viewport.southwest.lat;
  const lngSpan = viewport.northeast.lng - viewport.southwest.lng;

  // 3x3 grid = 9 searches × 60 results = up to 540 unique results
  const gridSize = 3;
  const radius = Math.max(2000, Math.round((latSpan * 111000) / gridSize / 2));
  const results = [];
  const seenIds = new Set();

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cellLat = viewport.southwest.lat + (latSpan / gridSize) * (row + 0.5);
      const cellLng = viewport.southwest.lng + (lngSpan / gridSize) * (col + 0.5);

      logger.info(`Grid cell [${row},${col}] @ ${cellLat.toFixed(4)},${cellLng.toFixed(4)} r=${radius}m`);

      let nextPageToken = null;
      do {
        const url = nextPageToken
          ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextPageToken}&key=${API_KEY}`
          : `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${cellLat},${cellLng}&radius=${radius}&keyword=${encodeURIComponent(query)}&key=${API_KEY}`;

        const response = await axios.get(url);
        const data = response.data;

        if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') break;

        for (const place of (data.results || [])) {
          if (!seenIds.has(place.place_id)) {
            seenIds.add(place.place_id);
            results.push(place);
          }
        }

        nextPageToken = data.next_page_token;
        if (nextPageToken) await sleep(2000);
      } while (nextPageToken);

      await sleep(300);
    }
  }

  logger.info(`Grid search found ${results.length} unique results across ${gridSize * gridSize} cells`);
  return results;
}

async function getPlaceDetails(placeId) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${DETAIL_FIELDS}&key=${API_KEY}`;
    const response = await axios.get(url);
    return response.data.result || {};
  } catch (err) {
    logger.error(`Details error for ${placeId}: ${err.message}`);
    return {};
  }
}

/**
 * Fix #1 — Return a proxied photo URL instead of exposing the API key.
 * Falls back to a placeholder if no photos.
 */
function getPhotoUrl(photos) {
  if (!photos || !photos.length) return '';
  const ref = photos[0].photo_reference;
  // Return reference only — server can proxy at /api/photo?ref=...
  return `photo_ref:${ref}`;
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

// ─── SEO Audit + Email Discovery (#11) ───────────────────
async function auditSEO(url) {
  try {
    const { data: html } = await axios.get(url, { timeout: 5000, maxRedirects: 3 });
    const $ = cheerio.load(html);

    // Extract emails from mailto: links and page text
    const emails = new Set();
    $('a[href^="mailto:"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const addr = href.replace(/^mailto:/i, '').split('?')[0].trim().toLowerCase();
      if (addr && addr.includes('@')) emails.add(addr);
    });

    // Scan visible text for email patterns
    const bodyText = $('body').text() || '';
    const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
    const textEmails = bodyText.match(emailRegex) || [];
    textEmails.forEach(e => emails.add(e.toLowerCase()));

    // Filter out common false positives
    const filtered = [...emails].filter(e =>
      !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.gif') &&
      !e.includes('example.com') && !e.includes('wixpress.com') &&
      !e.includes('sentry.io') && !e.includes('wordpress.com')
    );

    return {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      h1: $('h1').first().text().trim(),
      email: filtered[0] || '',
    };
  } catch {
    return { title: '', description: '', h1: '', email: '' };
  }
}

// ─── Opportunity Scoring ─────────────────────────────────
function scoreLead(biz) {
  let score = 0;
  const issues = [];

  if (!biz.website) {
    score += 30;
    issues.push('No website');
  } else {
    const speed = parseInt(biz.speed_ms, 10) || 0;
    if (speed > 4000) {
      score += 20;
      issues.push(`Slow site (${(speed / 1000).toFixed(1)}s)`);
    } else if (speed > 2000) {
      score += 10;
      issues.push(`Moderate speed (${(speed / 1000).toFixed(1)}s)`);
    }

    if (biz.has_title === 'no') { score += 15; issues.push('Missing title tag'); }
    if (biz.has_meta_desc === 'no') { score += 10; issues.push('Missing meta description'); }
    if (biz.has_h1 === 'no') { score += 10; issues.push('Missing H1 tag'); }
  }

  const rating = parseFloat(biz.rating) || 0;
  if (rating > 0 && rating < 3.5) { score += 15; issues.push(`Low rating (${rating})`); }
  else if (rating > 0 && rating < 4.0) { score += 10; issues.push(`Below-average rating (${rating})`); }

  const reviews = parseInt(biz.review_count, 10) || 0;
  if (reviews < 20) { score += 15; issues.push(`Only ${reviews} reviews`); }
  else if (reviews < 50) { score += 10; issues.push(`Low reviews (${reviews})`); }

  return { score, issues: issues.join('; ') };
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  logger.info('Starting Google Places API Lead Scraper + Scorer');
  logger.info(`City: ${opts.city}`);
  logger.info(`Type: ${opts.bizType}`);
  logger.info(`Max Results: ${opts.maxResults}`);
  logger.info(`Grid Search: ${opts.grid ? 'enabled' : 'disabled'}`);
  logger.info(`Output File: ${opts.output}`);

  const { rows: existingRows, seenIds } = await loadExisting(opts.output);
  const results = [...existingRows];
  const startTime = Date.now();

  // Phase 1: Search (Text Search or Grid-based Nearby Search)
  logger.info(`Searching for "${opts.bizType}" in ${opts.city}...`);
  const places = opts.grid
    ? await searchPlacesGrid(opts.bizType, opts.city)
    : await searchPlaces(opts.bizType, opts.city);
  logger.info(`Found ${places.length} results from ${opts.grid ? 'Grid Nearby' : 'Text'} Search API`);

  const newPlaces = places.filter((p) => !seenIds.has(p.place_id));
  const budget = Math.min(newPlaces.length, Math.max(0, opts.maxResults - existingRows.length));
  const toProcess = newPlaces.slice(0, budget);

  logger.info(`${toProcess.length} new businesses to process (${existingRows.length} already scraped)`);

  if (!toProcess.length) {
    logger.info('No new listings to process. Exiting.');
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
        email: '',
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

      // Website audit + email discovery
      if (biz.website) {
        const speed = await checkWebsiteSpeed(biz.website);
        biz.speed_ms = String(speed);

        if (speed < 9999) {
          const seo = await auditSEO(biz.website);
          biz.has_title = seo.title ? 'yes' : 'no';
          biz.has_meta_desc = seo.description ? 'yes' : 'no';
          biz.has_h1 = seo.h1 ? 'yes' : 'no';
          biz.email = seo.email || '';
        } else {
          biz.has_title = 'no';
          biz.has_meta_desc = 'no';
          biz.has_h1 = 'no';
        }
      }

      const { score, issues } = scoreLead(biz);
      biz.score = String(score);
      biz.issues = issues;

      seenIds.add(place.place_id);
      results.push(biz);

      const icon = score >= 50 ? '🔥' : score >= 30 ? '⚡' : '✓';
      if (score >= 50) hotCount++;
      const emailTag = biz.email ? ` | 📧 ${biz.email}` : '';
      logger.info(`[${idx}/${toProcess.length}] ${icon} ${biz.business_name} | Score: ${score}${emailTag} | ${issues || 'clean'}`);

      if (idx % 20 === 0) saveCSV(opts.output, results);
      await sleep(150);
    } catch (err) {
      logger.error(`[${idx}/${toProcess.length}] Error: ${err.message}`);
    }
  }

  saveCSV(opts.output, results);

  const emailCount = results.filter(r => r.email).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  logger.info(`Scraping complete in ${elapsed}s`);
  logger.info(`Total records: ${results.length}`);
  logger.info(`Hot prospects (score >= 50): ${hotCount}`);
  logger.info(`Emails found: ${emailCount}`);
}

// Export for testing
export { scoreLead, getPhotoUrl };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => logger.error(err));
}
