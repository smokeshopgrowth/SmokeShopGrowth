/**
 * vapi_inbound_setup.js
 * Creates an Inbound Assistant and attaches it to your Vapi Phone Number.
 * Run this once.
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const AGENT_NAME = process.env.AGENT_NAME || "Alex";
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!VAPI_API_KEY || !VAPI_PHONE_NUMBER_ID) {
    console.error("❌ Missing VAPI_API_KEY or VAPI_PHONE_NUMBER_ID in .env");
    process.exit(1);
}

const vapi = axios.create({
    baseURL: "https://api.vapi.ai",
    headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
    },
});

const INBOUND_PROMPT = `You are ${AGENT_NAME}, a local web developer. You are answering an inbound call. The caller is likely a smoke shop owner returning your call or message about a free website demo you built for them.

Your goal: Find out which shop they are calling from, answer any questions, and get their permission to send them the demo link.

Personality: warm, professional, not pushy, conversational. 
Keep responses to 1–2 sentences.

CALL FLOW:
1. Answer the phone: "Hey, this is ${AGENT_NAME}. Who am I speaking with?"
2. If they ask why you called: "I reached out earlier because I was looking at smoke shops in your area and noticed you might benefit from a modern, mobile-friendly website. I actually built a free demo concept for your shop specifically, just to show what it could look like. Did you want me to send you the link?"
3. If they ask about cost: "No worries — I'm just starting out so it's super affordable, around $200–$400 depending on what you need. But there's zero commitment to just look at the demo."
4. If they say yes: "Awesome! What's the best email address to send that to?"
   - (Confirm spelling of email address letter by letter if needed).
5. Close: "Perfect. I'll send that right over. Take a look and let me know what you think. Have a great day!"

IMPORTANT:
- Extract and save contact_method (email/none), contact_value (email address), outcome (interested/not_interested/wrong_number/voicemail), and business_name (if they tell you).
- Remember, they are calling YOU. Do not act like you just dialed them.`;

const inboundAssistant = {
    name: "Smoke Shop Inbound Agent",
    transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en",
    },
    model: {
        provider: "openai",
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: INBOUND_PROMPT }],
        temperature: 0.5,
    },
    voice: {
        provider: "11labs",
        voiceId: process.env.ELEVENLABS_VOICE_ID || "ErXwobaYiN019PkySvjV", // Antoni (Male Voice)
        model: "eleven_turbo_v2_5",
        stability: 0.5,
        similarityBoost: 0.75,
    },
    firstMessage: "Hey, this is Alex. Who am I speaking with?",
    endCallMessage: "Have a great day. Bye!",
    ...(WEBHOOK_URL ? { serverUrl: WEBHOOK_URL } : {}),
    analysisPlan: {
        summaryPrompt: "Summarize this inbound call in 1–2 sentences. Include the business name if mentioned.",
        structuredDataSchema: {
            type: "object",
            properties: {
                outcome: { type: "string", enum: ["interested", "not_interested", "wrong_number", "voicemail"] },
                contact_method: { type: "string", enum: ["email", "none"] },
                contact_value: { type: "string" },
                business_name: { type: "string" },
            },
        },
    },
};

async function setupInbound() {
    try {
        console.log("🤖 Creating Inbound Assistant...");
        const res = await vapi.post("/assistant", inboundAssistant);
        const assistantId = res.data.id;
        console.log(`✅ Inbound Assistant created: ${assistantId}`);

        console.log(`\n🔗 Linking Assistant to Phone Number: ${VAPI_PHONE_NUMBER_ID}...`);
        await vapi.patch(`/phone-number/${VAPI_PHONE_NUMBER_ID}`, {
            assistantId: assistantId,
        });
        console.log(`✅ Phone number successfully updated for inbound calls!`);
        console.log(`   When someone calls that number, the Inbound Agent will answer.`);

        // Save the ID just in case
        const envPath = path.join(__dirname, ".env");
        const envContent = fs.readFileSync(envPath, "utf-8");
        if (!envContent.includes("VAPI_INBOUND_ASSISTANT_ID")) {
            fs.appendFileSync(envPath, `\nVAPI_INBOUND_ASSISTANT_ID=${assistantId}\n`);
        }

    } catch (err) {
        console.error("❌ Error setting up inbound:", err.response?.data || err.message);
    }
}

setupInbound();
