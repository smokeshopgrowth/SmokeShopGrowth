/**
 * Batch Google Places API Scraper
 * ================================
 * Runs the Places API scraper for multiple city+type queries,
 * all results go into one combined CSV (deduped by place_id).
 *
 * Usage:
 *   node src/node/batch_scrape.js
 *   node src/node/batch_scrape.js --output houston_metro.csv --max 100
 */

const { execSync } = require('child_process');
const path = require('path');

// ─── TARGET QUERIES ──────────────────────────────────────
const QUERIES = [
  { city: 'Houston', type: 'smoke shop' },
  { city: 'Katy', type: 'smoke shop' },
  { city: 'Spring', type: 'smoke shop' },
  { city: 'Sugar Land', type: 'smoke shop' },
  { city: 'Cypress', type: 'smoke shop' },
];

// ─── Parse CLI args ──────────────────────────────────────
const args = process.argv.slice(2);
let output = 'leads.csv';
let maxPerCity = 200;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') output = args[++i];
  if (args[i] === '--max') maxPerCity = parseInt(args[++i], 10);
}

// ─── Run ─────────────────────────────────────────────────
const scraperPath = path.join(__dirname, 'places_scraper.js');
const startTime = Date.now();

console.log('═'.repeat(60));
console.log('  Batch Google Places API Scraper');
console.log(`  Queries   : ${QUERIES.length}`);
console.log(`  Max/city  : ${maxPerCity}`);
console.log(`  Output    : ${output}`);
console.log('═'.repeat(60));

for (let i = 0; i < QUERIES.length; i++) {
  const q = QUERIES[i];
  const num = i + 1;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  [${num}/${QUERIES.length}] ${q.type} in ${q.city}`);
  console.log('─'.repeat(50));

  const cmd = [
    'node',
    `"${scraperPath}"`,
    `--city "${q.city}"`,
    `--type "${q.type}"`,
    `--max ${maxPerCity}`,
    `--output "${output}"`,
  ]
    .join(' ');

  try {
    execSync(cmd, { stdio: 'inherit', shell: true });
  } catch (err) {
    console.error(`⚠️  Query "${q.type} ${q.city}" failed: ${err.message}`);
    console.log('   Continuing to next query...');
  }
}

const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
console.log(`\n✅ Batch complete in ${elapsed} minutes. Results saved to ${output}`);
