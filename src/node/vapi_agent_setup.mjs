/**
 * vapi_agent_setup.js
 * Run once to create (or update) your Vapi outbound assistant.
 *
 * Usage:
 *   node vapi_agent_setup.js           → creates assistant, saves ID
 *   node vapi_agent_setup.js --update  → updates existing assistant
 */

import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------- #
//                                 CONFIGURATION                                #
// ---------------------------------------------------------------------------- #

import logger from "./utils/logger.mjs";

// ---------------------------------------------------------------------------- #
//                                 CONFIGURATION                                #
// ---------------------------------------------------------------------------- #

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const AGENT_NAME = process.env.AGENT_NAME || "Alex";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID; // set after first run

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
// ASSISTANT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Rory, making friendly outbound calls to smoke shop owners about building them a website.

GOAL: See if the owner is interested in a simple $99 website for their shop.

Keep calls under 90 seconds. Be friendly, casual, and conversational. Sound like a real local guy, NOT a telemarketer.

VARIABLES YOU CAN REFERENCE:
- {{business_name}} — the shop's full name
- {{city}} — the city the shop is in

SHOP NAME RULE (CRITICAL):
- {{business_name}} often contains long names like "Flava Depot Smoke & Vape Shop LLC".
- When referring to the shop, ONLY use a short 2-3 word version. Drop "LLC", "Inc", "Smoke Shop", "Smoke & Vape", "Tobacco", "And More", etc.
- Examples: "Flava Depot Smoke & Vape Shop LLC" → "Flava Depot". "Cloud 9 Smoke Shop" → "Cloud 9".
- Use only the distinctive part a regular person would say casually.

CALL SCRIPT (follow this flow naturally):

1. "Hey, is this the owner?"

2. "My name is Rory. I'm local and I build websites for smoke shops in the area."

3. "I noticed your shop has great reviews on Google but doesn't have a website yet."

4. "A lot of customers search smoke shops on Google and go to the first site they see."

5. "I can build you a simple website that shows your products, hours, and directions."

6. "Since I'm just getting started I'm doing them for $99 in exchange for a testimonial."

7. "Would you want me to send you a demo?"

IF THEY SAY YES:
"Great! What's the best email to send that to?"
→ Repeat the email back to confirm.
→ "Perfect, you'll have that in a few minutes. Thanks for your time!"

IF NOT INTERESTED:
"No worries at all, appreciate your time. Have a great day!"

HANDLING QUESTIONS:
- How much: "$99 for a simple site with your products, hours, and directions — all I ask is a testimonial."
- How did you get my number: "Found your shop on Google Maps while researching smoke shops in the area."
- Already has a website: "Oh nice — what I usually see is older sites that aren't really optimized for phones. I put together a quick modern concept so you can see the difference."
- What's your website: "You can check us out at smokeshopgrowth.com — or call back at 281-323-0450."
- Remove from list: "Absolutely, I'll make sure of that. Sorry to bother you. Have a great day!"

IMPORTANT RULES:
- You ARE Rory. First person. Do not say "on behalf of Rory."
- Be polite and conversational at all times.
- If not interested, thank them and end. Do NOT push.
- The price is $99 — mention it naturally as part of the pitch in step 6.
- Extract and save: contact_method (email/none), contact_value (email address), outcome (interested/not_interested/no_contact_info/no_answer/voicemail).`;

const assistantConfig = {
    name: "Smoke Shop Website Outreach Agent",
    firstMessage: "Hey, is this the owner?",
    firstMessageMode: "assistant-speaks-first",

    // ── Transcription ──────────────────────────────────────────────────────────
    transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
        smartFormat: true,
    },

    // ── LLM ───────────────────────────────────────────────────────────────────
    model: {
        provider: "openai",
        model: "gpt-4o-mini", // fast + cheap for outbound calls
        messages: [
            {
                role: "system",
                content: SYSTEM_PROMPT,
            },
        ],
        temperature: 0.5,
    },

    // ── Voice ─────────────────────────────────────────────────────────────────
    voice: {
        provider: "deepgram",
        voiceId: process.env.DEEPGRAM_VOICE_ID || "orion", // natural male voice
    },

    // ── Call behavior ──────────────────────────────────────────────────────────
    silenceTimeoutSeconds: 10,
    maxDurationSeconds: 90, // 90 sec max — keep calls short
    backgroundSound: "off",
    endCallMessage: "Have a great day! Goodbye.",

    // ── Interruption & Noise Settings ──────────────────────────────────────────
    backgroundDenoisingEnabled: true,
    // Interruptions enabled — let the human talk naturally
    stopSpeakingPlan: {
        numWords: 1,          // Let user interrupt with just 1 word
        voiceSeconds: 0.2,    // Low threshold for natural interruption
        backoffSeconds: 0.5,  // Quick resume after interruption
    },

    // ── End call phrases ───────────────────────────────────────────────────────
    endCallPhrases: [
        "have a great day",
        "goodbye",
        "take care",
        "thanks for your time",
    ],

    // ── Webhook (only set when URL is configured) ──────────────────────────────
    ...(process.env.WEBHOOK_URL ? { serverUrl: process.env.WEBHOOK_URL } : {}),

    // ── Voicemail detection ────────────────────────────────────────────────────
    voicemailDetection: {
        provider: "twilio",
        enabled: true,
    },
    voicemailMessage: `Hey, this is Rory. I'm local and I build websites for smoke shops. I noticed your shop has great reviews on Google but doesn't have a website yet. I'm doing simple sites for $99 right now. Give me a call back if you'd like to see a demo — have a great day!`,

    // ── Post-call summary ──────────────────────────────────────────────────────
    analysisPlan: {
        summaryPrompt:
            "Summarize this call in 1-2 sentences. Note whether the business was interested, collected contact info (provide it), or was not interested.",
        structuredDataSchema: {
            type: "object",
            properties: {
                outcome: {
                    type: "string",
                    enum: [
                        "interested",
                        "not_interested",
                        "voicemail",
                        "no_answer",
                        "already_has_site_interested",
                        "already_has_site_not_interested",
                    ],
                },
                contact_method: {
                    type: "string",
                    enum: ["email", "none"],
                },
                contact_value: {
                    type: "string",
                    description: "The email address or phone number collected, if any",
                },
                owner_reached: {
                    type: "boolean",
                },
            },
        },
        structuredDataPrompt:
            "Extract the call outcome and any contact info collected from the conversation.",
    },
};

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

        if (isUpdate && VAPI_ASSISTANT_ID) {
            assistant = await updateAssistant(VAPI_ASSISTANT_ID);
        } else {
            assistant = await createAssistant();

            // Append the assistant ID to .env
            const envPath = path.join(__dirname, "..", "..", ".env");
            const envContent = fs.readFileSync(envPath, "utf-8");
            if (!envContent.includes("VAPI_ASSISTANT_ID")) {
                fs.appendFileSync(
                    envPath,
                    `\nVAPI_ASSISTANT_ID=${assistant.id}\n`
                );
                logger.info("VAPI_ASSISTANT_ID saved to .env");
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
