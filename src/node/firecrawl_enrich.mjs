/**
 * firecrawl_enrich.mjs
 * Enriches lead data by scraping each business website via Firecrawl.
 * Extracts: products/brands, description, hours, tagline, social links.
 * Output: enriched CSV with all original fields + firecrawl_* columns.
 */
import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || 'fc-57a3c76c67374776a68434bfed161571';
const FIRECRAWL_URL = 'https://api.firecrawl.dev/v1/scrape';
const CONCURRENCY = 3;
const TIMEOUT_MS = 15000;

async function scrapeWithFirecrawl(url) {
  if (!url || url === 'N/A' || !url.startsWith('http')) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(FIRECRAWL_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 1000,
        timeout: 12000,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data.success || !data.data?.markdown) return null;

    return parseMarkdown(data.data.markdown, data.data.metadata || {});
  } catch {
    return null;
  }
}

function parseMarkdown(markdown, meta) {
  const text = markdown.toLowerCase();

  // ── Extract products / brands ──────────────────────────────────────────
  const knownBrands = [
    'elf bar', 'lost mary', 'geek bar', 'hyde', 'flum', 'raz', 'breeze', 'fume',
    'puff bar', 'vuse', 'juul', 'blu', 'nord', 'smok', 'voopoo', 'uwell', 'drag',
    'delta 8', 'delta-8', 'delta 9', 'thca', 'hhc', 'kratom', 'cbd', 'thc',
    'hookah', 'shisha', 'molasses', 'al fakher', 'starbuzz', 'tangiers',
    'glass', 'pipe', 'bong', 'dab', 'concentrate', 'wax', 'shatter',
    'cigar', 'swisher', 'backwoods', 'game', 'optimo',
    'rolling papers', 'raw', 'zig-zag', 'blunt wrap',
    'lighter', 'clipper', 'bic', 'torch',
    'energy drink', 'monster', 'red bull', 'prime',
  ];

  const foundBrands = [...new Set(
    knownBrands.filter(b => text.includes(b.toLowerCase()))
  )].slice(0, 12);

  // ── Extract hours ──────────────────────────────────────────────────────
  const hoursMatch = markdown.match(
    /(?:hours?|open)[:\s]*([^\n]{5,80}(?:am|pm|24)[^\n]{0,40})/i
  );
  const hours = hoursMatch ? hoursMatch[1].trim().replace(/\s+/g, ' ') : '';

  // ── Extract tagline / headline ─────────────────────────────────────────
  const lines = markdown.split('\n').filter(l => l.trim().length > 0);
  const taglineCandidate = lines.find(l => {
    const t = l.trim();
    return t.length > 15 && t.length < 100 && !t.startsWith('http') && !t.match(/^\d/);
  }) || '';
  const tagline = taglineCandidate.replace(/^#+\s*/, '').trim();

  // ── Extract description (first real paragraph) ─────────────────────────
  const paragraphs = markdown.split(/\n\n+/).filter(p => p.trim().length > 60);
  const description = paragraphs[0]?.trim().slice(0, 300) || '';

  // ── Extract social links ───────────────────────────────────────────────
  const igMatch = markdown.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/);
  const fbMatch = markdown.match(/facebook\.com\/([a-zA-Z0-9_.]{2,50})/);

  return {
    firecrawl_tagline: tagline,
    firecrawl_description: description,
    firecrawl_hours: hours,
    firecrawl_products: foundBrands.join(', '),
    firecrawl_instagram: igMatch ? `https://instagram.com/${igMatch[1]}` : '',
    firecrawl_facebook: fbMatch ? `https://facebook.com/${fbMatch[1]}` : '',
    firecrawl_page_title: meta.title || '',
  };
}

async function processInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) {
      await new Promise(r => setTimeout(r, 500)); // rate limit
    }
  }
  return results;
}

async function enrichCsv(inputPath, outputPath) {
  console.log(`[Firecrawl] Enriching leads from: ${inputPath}`);

  // Read all rows
  const rows = await new Promise((resolve, reject) => {
    const records = [];
    createReadStream(inputPath)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', r => records.push(r))
      .on('end', () => resolve(records))
      .on('error', reject);
  });

  if (rows.length === 0) {
    fs.copyFileSync(inputPath, outputPath);
    console.log('[Firecrawl] No rows to enrich — copied input as-is');
    return;
  }

  console.log(`[Firecrawl] Scraping ${rows.length} websites with concurrency ${CONCURRENCY}…`);

  let done = 0;
  const enriched = await processInBatches(rows, CONCURRENCY, async (row) => {
    const website = row.website || row.Website || row.url || '';
    const enrichData = await scrapeWithFirecrawl(website);
    done++;
    if (enrichData) {
      console.log(`  ✓ [${done}/${rows.length}] ${row.name || row.business_name || website} — brands: ${enrichData.firecrawl_products || 'none'}`);
    } else {
      console.log(`  ✗ [${done}/${rows.length}] ${row.name || row.business_name || website} — skipped`);
    }
    return { ...row, ...(enrichData || {
      firecrawl_tagline: '', firecrawl_description: '', firecrawl_hours: '',
      firecrawl_products: '', firecrawl_instagram: '', firecrawl_facebook: '',
      firecrawl_page_title: '',
    }) };
  });

  // Write output CSV
  await new Promise((resolve, reject) => {
    const writer = createWriteStream(outputPath);
    const stringifier = stringify({ header: true, columns: Object.keys(enriched[0]) });
    stringifier.pipe(writer);
    enriched.forEach(r => stringifier.write(r));
    stringifier.end();
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  const hitCount = enriched.filter(r => r.firecrawl_products || r.firecrawl_description).length;
  console.log(`[Firecrawl] Done! ${hitCount}/${rows.length} leads enriched → ${outputPath}`);
}

// ── CLI entry point ──────────────────────────────────────────────────────
const [,, inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error('Usage: node firecrawl_enrich.mjs <input.csv> <output.csv>');
  process.exit(1);
}
enrichCsv(path.resolve(inputArg), path.resolve(outputArg)).catch(err => {
  console.error('[Firecrawl] Fatal error:', err.message);
  process.exit(1);
});
