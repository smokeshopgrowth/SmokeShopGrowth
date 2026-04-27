export const SYSTEM_PROMPT = `You are Alex, a friendly and upbeat web designer calling local businesses.
Your goal is to get the owner or manager's contact info—whether it be an email address or a cell phone number to text—so we can send them a free demo website.

DYNAMIC SCRIPTING (Based on the 'problem' variable):

1. IF problem IS "No Website" OR problem IS "Website Upgrade Opportunity":
   - OPENING: "Hi, is this {{business_name}}? Awesome. My name is Alex. I'm calling because I actually already built a custom AI Voice Assistant for your shop that can answer your phones, handle customer questions about your flavas, and take messages when you guys are busy."
   - PITCH: "I'd really love for you to hear how it sounds—it's like having a 24/7 receptionist. Can I text or email you a quick link so you can try it out for yourself? No strings attached."

COMMON OBJECTIONS:
- "Already have a site": "I saw that! It's great you're online. The only thing is, about 80% of smoke shop customers search on their phones, and older sites can be hard to navigate. My demo shows a 'mobile-first' version. Worth a 10-second look?"
- "What's the cost?": "The demo is totally free. If you like it, we can talk details then. Fair enough?"
- "Not interested": "No problem at all! Thanks for your time. Have a great day!"

RULES:
- Be warm and conversational.
- Listen more than you talk.
- If they say no, be polite and end the call.
- Always try to get either an email or a phone number to text. If they hesitate on email, ask if texting is easier.
- Specifically ask for the owner or manager's contact information if you aren't speaking with them.
- Extract outcome, contact info, and whether the owner was reached.`;

export const assistantConfig = {
    name: "Smoke Shop Website Outreach Agent",
    firstMessage: "Hi there! My name is Alex. Is this {{business_name}}?",
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
        model: "gpt-4o-mini", // Faster, cheaper, and great for conversations
        messages: [
            {
                role: "system",
                content: SYSTEM_PROMPT,
            },
        ],
        temperature: 0.7, // Balances creativity and consistency
    },

    // ── Voice ─────────────────────────────────────────────────────────────────
    voice: {
        provider: "openai",
        model: "tts-1", // Faster and more cost-effective than HD
        voiceId: "alloy", // Friendly and clear male voice
    },

    // ── Call behavior ──────────────────────────────────────────────────────────
    silenceTimeoutSeconds: 10, // A bit more forgiving for pauses
    maxDurationSeconds: 120, // Extended to allow for longer conversations
    backgroundSound: "off",
    endCallMessage: "Thanks for your time, goodbye.",

    // ── Interruption & Noise Settings ──────────────────────────────────────────
    backgroundDenoisingEnabled: true,
    // More responsive interruption settings
    stopSpeakingPlan: {
        numWords: 2,
        voiceSeconds: 0.3,
        backoffSeconds: 0.4,
    },

    // ── End call phrases ───────────────────────────────────────────────────────
    endCallPhrases: [
        "goodbye",
        "bye bye",
        "take care",
    ],

    // ── Webhook (only set when URL is configured) ──────────────────────────────
    ...(process.env.WEBHOOK_URL ? { serverUrl: process.env.WEBHOOK_URL } : {}),

    // ── Voicemail detection ────────────────────────────────────────────────────
    voicemailDetection: {
        provider: "twilio",
        enabled: true,
    },
    voicemailMessage: `Hey, this is Rory from Smoke Shop Growth. I saw you have great reviews, so I made a free demo website for you. If you want to see it, call me back at 281-323-0450. No pressure. Thanks!`,

    // ── Post-call summary ──────────────────────────────────────────────────────
    analysisPlan: {
        summaryPrompt:
            "Summarize the call in one sentence. Was the lead interested, not interested, or did it go to voicemail?",
        structuredDataSchema: {
            type: "object",
            properties: {
                outcome: {
                    type: "string",
                    enum: [
                        "interested_demo_sent",
                        "not_interested",
                        "voicemail_left",
                        "no_answer",
                        "already_has_site_interested",
                        "already_has_site_not_interested",
                        "call_failed",
                    ],
                },
                contact_method: {
                    type: "string",
                    enum: ["email", "phone", "none"],
                },
                contact_value: {
                    type: "string",
                    description: "The email or phone number collected.",
                },
                owner_reached: {
                    type: "boolean",
                    description: "True if we spoke to the owner.",
                },
            },
        },
        structuredDataPrompt:
            "Extract the call outcome, any contact info, and whether the owner was reached.",
    },
};