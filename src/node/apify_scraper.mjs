
/**
 * Apify Google Maps Scraper
 * =========================
 * Uses Apify's `apify/google-maps-scraper` actor to find leads.
 *
 * Usage:
 *   node src/node/apify_scraper.mjs --query "smoke shop in Houston" --output leads.csv
 *
 * Requires: APIFY_API_TOKEN in .env
 */

import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { writeCsv } from './utils/csv.mjs';
import logger from './utils/logger.mjs';

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const ACTOR_ID = 'compass/crawler-google-places';

if (!APIFY_TOKEN) {
    logger.error('APIFY_API_TOKEN not found in .env');
    process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { query: '', output: 'leads.csv', max: 100 };
    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--query': opts.query = args[++i]; break;
            case '--output': opts.output = args[++i]; break;
            case '--max': opts.max = parseInt(args[++i], 10); break;
        }
    }
    if (!opts.query) {
        logger.error('Error: --query is required.\nUsage: node apify_scraper.js --query "smoke shop in Houston"');
        process.exit(1);
    }
    return opts;
}

// ─── Apify Execution ────────────────────────────────────
async function runApifyScraper(query, maxResults) {
    const client = new ApifyClient({ token: APIFY_TOKEN });

    const input = {
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: maxResults,
        language: 'en',
        // Add any other specific actor input fields here
    };

    logger.info(`Starting Apify actor '${ACTOR_ID}' for query: "${query}"`);
    const run = await client.actor(ACTOR_ID).call(input);
    if (!run) {
        logger.error('Failed to start the Apify actor. The call returned null.');
        return null;
    }

    logger.info('Actor started. Waiting for results...');
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    logger.info(`Actor finished. Found ${items.length} results.`);

    return items;
}

// ─── Data Transformation ────────────────────────────────
function transformResults(items) {
    return items.map(item => ({
        business_name: item.title,
        address: item.address,
        phone: item.phone,
        email: item.email || '',
        website: item.website || '',
        rating: item.totalScore || 0,
        review_count: item.reviewsCount || 0,
        google_maps_url: item.url,
        image_url: item.thumbnail || '',
        place_id: item.placeId,
        has_website: !!item.website,
        // Fields from the old scraper that we don't have from Apify
        speed_ms: null,
        has_title: null,
        has_meta_desc: null,
        has_h1: null,
        score: null, // Could implement a similar scoring logic later
        issues: '',
    }));
}

// ─── Main Execution ─────────────────────────────────────
async function main() {
    const { query, output, max } = parseArgs();
    logger.info('Starting Apify lead scraper...');

    try {
        const apifyResults = await runApifyScraper(query, max);
        if (!apifyResults || apifyResults.length === 0) {
            logger.warn('No results returned from Apify. Exiting.');
            return;
        }

        const leads = transformResults(apifyResults);

        // The CSV fields expected by the rest of the pipeline
        const csvFields = [
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

        await writeCsv(output, leads, csvFields);
        logger.info(`Successfully saved ${leads.length} leads to ${output}`);

    } catch (err) {
        logger.error('An error occurred during the scraping process:', err);
        process.exit(1);
    }
}

main();
