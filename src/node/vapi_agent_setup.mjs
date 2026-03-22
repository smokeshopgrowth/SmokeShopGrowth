/**
 * vapi_agent_setup.mjs
 * Run once to create (or update) your Vapi outbound assistant.
 *
 * Usage:
 *   node vapi_agent_setup.mjs           → creates assistant, saves ID
 *   node vapi_agent_setup.mjs --update  → updates existing assistant
 */

import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "./utils/logger.mjs";
import { assistantConfig } from "./vapi_assistant_config.mjs";

// Override Vapi default to make the AI more responsive.
assistantConfig.endOfSpeechThreshold = 500;

// ---------------------------------------------------------------------------- #
//                                 CONFIGURATION                                #
// ---------------------------------------------------------------------------- #

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;

if (!VAPI_API_KEY) {
    logger.error("VAPI_API_KEY not found in .env");
    process.exit(1);
}

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE OR UPDATE
// ─────────────────────────────────────────────────────────────────────────────

async function createAssistant() {
    logger.info("Creating Vapi assistant...");
    const res = await vapi.post("/assistant", assistantConfig);
    const assistant = res.data;
    logger.info(`Assistant created: ${assistant.id}`);
    logger.info(`   Name: ${assistant.name}`);
    return assistant;
}

async function updateAssistant(id) {
    logger.info(`Updating assistant ${id}...`);
    const res = await vapi.patch(`/assistant/${id}`, assistantConfig);
    logger.info(`Assistant updated: ${res.data.id}`);
    return res.data;
}

async function main() {
    const isUpdate = process.argv.includes("--update");

    try {
        let assistant;

        // Force creation of a new assistant for a clean slate.
        assistant = await createAssistant();
        logger.info(`\n✅ PLEASE UPDATE YOUR .env FILE WITH THIS NEW VAPI_ASSISTANT_ID: ${assistant.id}`);

        // The original script also checked for WEBHOOK_URL. We'll keep that helpful check.
        const envPath = path.join(__dirname, "..", "..", ".env");
        try {
            const envContent = fs.readFileSync(envPath, "utf-8");
            if (!envContent.includes("WEBHOOK_URL")) {
                fs.appendFileSync(
                    envPath,
                    `\nWEBHOOK_URL=https://your-webhook-url.com\n`
                );
                logger.info("WEBHOOK_URL added to .env, please update it with your server URL.");
            }
        } catch (err) {
            // It's okay if the .env file doesn't exist yet.
            if (err.code !== 'ENOENT') {
                throw err;
            } else {
                 logger.warn(".env file not found. You will need to create it and add the new VAPI_ASSISTANT_ID.");
            }
        }

        logger.info("\nNext steps:");
        logger.info("1. Add your VAPI_PHONE_NUMBER_ID to .env");
        logger.info("2. Deploy vapi_webhook.js and set WEBHOOK_URL in .env");
        logger.info('3. Run: node vapi_call.js --batch --file data/houston-tx/hot_leads.csv --dry-run');
    } catch (err) {
        logger.error("Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

main();
