
/**
 * Master Pipeline Orchestrator
 * ============================
 * Runs the entire lead generation and outreach process from end to end.
 *
 * Usage:
 *   node src/node/pipeline.mjs --query "smoke shop in Houston"
 */

import { execSync } from 'child_process';
import logger from './utils/logger.mjs';

function runScript(scriptPath, args = '') {
    try {
        logger.info(`Running script: ${scriptPath} ${args}...`);
        const output = execSync(`node ${scriptPath} ${args}`, { stdio: 'inherit' });
    } catch (error) {
        logger.error(`Error running script ${scriptPath}:`, error);
        throw error; // Stop the pipeline if a step fails
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { query: '' };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--query' && args[i + 1]) {
            opts.query = args[++i];
        }
    }
    if (!opts.query) {
        logger.error('Error: --query is required. e.g., --query "smoke shop in Houston"');
        process.exit(1);
    }
    return opts;
}

async function main() {
    const { query } = parseArgs();
    logger.info('🚀 STARTING AUTOMATED LEAD-GEN & OUTREACH PIPELINE 🚀');

    try {
        // Step 1: Scrape leads from Apify
        logger.info('\n-- STEP 1: SCRAPING LEADS ------------------');
        runScript('src/node/apify_scraper.mjs', `--query "${query}" --output leads.csv`);

        // Step 2: Generate demo websites from the new leads
        logger.info('\n-- STEP 2: GENERATING DEMO SITES ---------');
        runScript('src/node/generate-from-templates.mjs', '--input leads.csv');

        // Step 3: Start the batch calling process
        logger.info('\n-- STEP 3: INITIATING BATCH CALLS --------');
        runScript('src/node/vapi_call.js', '--batch --file leads.csv');

        logger.info('\n✅ PIPELINE COMPLETED SUCCESSFULLY! ✅');
        logger.info('The system is now automatically calling leads. Monitor the webhook for results.');

    } catch (error) {
        logger.error('\n❌ PIPELINE FAILED ❌');
        logger.error('An error occurred during one of the pipeline steps. Please review the logs.');
        process.exit(1);
    }
}

main();
