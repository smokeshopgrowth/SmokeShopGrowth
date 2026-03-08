/**
 * vapi_agent_setup.js
 * Run once to create (or update) your Vapi outbound assistant.
 *
 * Usage:
 *   node vapi_agent_setup.js           → creates assistant, saves ID
 *   node vapi_agent_setup.js --update  → updates existing assistant
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const AGENT_NAME = process.env.AGENT_NAME || "Alex";
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID; // set after first run

if (!VAPI_API_KEY) {
    console.error("❌ VAPI_API_KEY not found in .env");
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

const SYSTEM_PROMPT = `You are a friendly outbound assistant making brief calls to local smoke shops on behalf of ${AGENT_NAME}, a local web developer.

Your ONLY goal: get permission to send the owner a free demo website or short video.
You are NOT selling on this call.

Personality: warm, calm, conversational, not pushy, respectful of their time.
Keep every response to 1–2 sentences. Sound like a real, relaxed human.

CALL FLOW:
1. Confirm the shop: "Hi, is this {{business_name}}?"
2. Ask for the owner/manager: "Is the owner or manager around by any chance?"
   - If NOT available: ask for the best email or number to send the demo. Collect it, thank them, and end.
3. Pitch (when owner is on): "Hey, my name is ${AGENT_NAME}. I'm a local developer — I was looking at smoke shops in {{city}} and came across your store. I actually built out a quick website concept for your shop as a free example. Would you want me to send you the short demo?"

OBJECTIONS:
- Already has a website: "A lot of shops I call do too — I just made a quick modern concept to show what it could look like optimized for mobile. Would you still want to see it?"
- How much does it cost: "Totally fair — I'm just starting out so I keep it pretty affordable, around $200–$400. But I'm just asking if you'd want to see the demo first — no commitment."
- What is it: "It's a short clip showing what a clean modern site could look like for your specific shop — no cost to look, no commitment."
- How did you get my number: "I found your shop on Google Maps and reached out directly. Totally fine if you'd rather not — no worries at all."
- Not interested: End politely.

COLLECTING CONTACT INFO:
"What's the best way to send it — text or email?"
- Text: "And what number should I send it to?" → Repeat the number back to confirm.
- Email: "Perfect — what's the email address?" → Spell it back letter by letter to confirm.

CLOSE (after collecting):
"Perfect. I'll send that over shortly so you can take a look. Thanks for the quick call — have a great day!"

POLITE GOODBYE (no interest):
"Totally fine — appreciate your time. Have a great day!"

IMPORTANT:
- Never mention cost unless asked.
- Never pressure anyone.
- If they ask to be removed from the list, say "Absolutely — sorry to bother you. Have a great day!" and end the call.
- Extract and save: contact_method (text/email), contact_value (number/email), outcome (interested/not_interested/no_contact_info/no_answer/voicemail).`;

const assistantConfig = {
    name: "Smoke Shop Outbound Agent",

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
        provider: "11labs",
        voiceId: process.env.ELEVENLABS_VOICE_ID || "ErXwobaYiN019PkySvjV", // Antoni (Male Voice)
        model: "eleven_turbo_v2_5", // lowest latency
        stability: 0.5,
        similarityBoost: 0.75,
    },

    // ── First message ──────────────────────────────────────────────────────────
    firstMessage: "Hi, is this {{business_name}}?",

    // ── Call behavior ──────────────────────────────────────────────────────────
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 300, // 5 min max
    backgroundSound: "off",
    endCallMessage: "Have a great day! Goodbye.",

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
    voicemailMessage: `Hi, this is ${AGENT_NAME}. I put together a free website demo for your smoke shop and wanted to see if you'd like to take a look. I'll try reaching out another time — have a great day!`,

    // ── Post-call summary ──────────────────────────────────────────────────────
    analysisPlan: {
        summaryPrompt:
            "Summarize this call in 1–2 sentences. Note whether the business was interested, collected contact info (provide it), or was not interested.",
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
                    enum: ["email", "text", "none"],
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
    console.log("🤖 Creating Vapi assistant...");
    const res = await vapi.post("/assistant", assistantConfig);
    const assistant = res.data;
    console.log(`✅ Assistant created: ${assistant.id}`);
    console.log(`   Name: ${assistant.name}`);
    return assistant;
}

async function updateAssistant(id) {
    console.log(`🔄 Updating assistant ${id}...`);
    const res = await vapi.patch(`/assistant/${id}`, assistantConfig);
    console.log(`✅ Assistant updated: ${res.data.id}`);
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
            const envPath = path.join(__dirname, ".env");
            const envContent = fs.readFileSync(envPath, "utf-8");
            if (!envContent.includes("VAPI_ASSISTANT_ID")) {
                fs.appendFileSync(
                    envPath,
                    `\nVAPI_ASSISTANT_ID=${assistant.id}\n`
                );
                console.log("📝 VAPI_ASSISTANT_ID saved to .env");
                console.log(
                    "⚠️  Fill in VAPI_API_KEY, VAPI_PHONE_NUMBER_ID, and WEBHOOK_URL in .env"
                );
            }
        }

        console.log("\n📋 Next steps:");
        console.log("1. Add your VAPI_PHONE_NUMBER_ID to .env");
        console.log("2. Deploy vapi_webhook.js and set WEBHOOK_URL in .env");
        console.log("3. Run: node vapi_call.js --phone +1xxxxxxxxxx --name \"Shop Name\" --city Houston");
    } catch (err) {
        console.error("❌ Error:", err.response?.data || err.message);
        process.exit(1);
    }
}

main();
