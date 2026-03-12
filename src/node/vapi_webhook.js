/**
 * vapi_webhook.js
 * Receives Vapi call events and routes outcomes to Zapier.
 *
 * Expose this publicly via ngrok (dev) or deploy to server (prod).
 * Set WEBHOOK_URL=https://your-url.com/vapi/webhook in .env
 *
 * Usage:
 *   node vapi_webhook.js
 *   ngrok http 3001
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { sendFollowUp } = require("./follow_up");

const rateLimit = require("express-rate-limit");

const app = express();
app.use(express.json());

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
});

const PORT = process.env.WEBHOOK_PORT || 3001;
const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_TAB_NAME = "Call Logs";

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE SHEETS CLIENT
// ─────────────────────────────────────────────────────────────────────────────

let sheetsClient = null;

async function getSheetsClient() {
    if (sheetsClient) return sheetsClient;
    const credPath = path.join(__dirname, "credentials.json");
    if (!fs.existsSync(credPath)) return null;
    const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    sheetsClient = google.sheets({ version: "v4", auth: client });
    return sheetsClient;
}

async function appendToSheet(payload) {
    const sheets = await getSheetsClient();
    if (!sheets) {
        console.log("⚠️  credentials.json not found — skipping Sheets logging");
        return;
    }

    const row = [
        payload.ended_at || new Date().toISOString(),
        payload.business_name || "",
        payload.phone || "",
        payload.city || "",
        payload.outcome || "",
        payload.owner_reached ? "Yes" : "No",
        payload.contact_method || "",
        payload.contact_value || "",
        payload.call_duration_seconds || "",
        payload.summary || "",
        payload.call_id || "",
    ];

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_TAB_NAME}!A:K`,
            valueInputOption: "USER_ENTERED",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: [row] },
        });
        console.log(`📊 Logged to Sheets: ${payload.business_name} → ${payload.outcome}`);
    } catch (err) {
        console.error("❌ Sheets append failed:", err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING UTILITY
// ─────────────────────────────────────────────────────────────────────────────

const CALLS_LOG = path.join(__dirname, "logs", "calls.jsonl");

// Ensure logs directory exists
fs.mkdirSync(path.join(__dirname, "logs"), { recursive: true });

function logCall(data) {
    const line = JSON.stringify({ ...data, logged_at: new Date().toISOString() });
    fs.appendFileSync(CALLS_LOG, line + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// ZAPIER NOTIFICATION
// ─────────────────────────────────────────────────────────────────────────────

async function notifyZapier(payload) {
    if (!ZAPIER_WEBHOOK_URL) {
        console.log("⚠️  ZAPIER_WEBHOOK_URL not set — skipping Zapier notification");
        return;
    }

    try {
        await axios.post(ZAPIER_WEBHOOK_URL, payload);
        console.log(`📤 Sent to Zapier: ${payload.outcome} — ${payload.business_name}`);
    } catch (err) {
        console.error("❌ Zapier notification failed:", err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// VAPI WEBHOOK HANDLER
// ─────────────────────────────────────────────────────────────────────────────

app.post("/vapi/webhook", webhookLimiter, async (req, res) => {
    console.log("📥 Incoming webhook type:", req.body?.message?.type || "unknown");
    const secret = process.env.WEBHOOK_SECRET;
    if (secret && req.headers['x-webhook-secret'] !== secret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const event = req.body;
    const type = event?.message?.type || event?.type;

    console.log(`📞 Vapi event: ${type}`);

    // ── Call started ───────────────────────────────────────────────────────────
    if (type === "call-started") {
        console.log(`   Call ID: ${event.message?.call?.id}`);
        res.json({ ok: true });
        return;
    }

    // ── Status update ──────────────────────────────────────────────────────────
    if (type === "status-update") {
        const status = event.message?.status;
        console.log(`   Status: ${status}`);
        res.json({ ok: true });
        return;
    }

    // ── Tool / function call ───────────────────────────────────────────────────
    if (type === "tool-calls" || type === "function-call") {
        // Handle any custom tool calls the assistant makes
        res.json({ results: [{ toolCallId: event.message?.toolCallList?.[0]?.id, result: "ok" }] });
        return;
    }

    // ── End of call report (the important one) ─────────────────────────────────
    if (type === "end-of-call-report") {
        const call = event.message?.call || {};
        const analysis = event.message?.analysis || {};
        const artifact = event.message?.artifact || {};

        const structured = analysis.structuredData || {};
        const summary = analysis.summary || "";
        const transcript = artifact.transcript || "";

        // Extract metadata passed when initiating the outbound call, or use AI extraction + caller ID for inbound
        const metadata = call.metadata || {};
        const businessName = metadata.business_name || structured.business_name || "Unknown Shop (Inbound)";

        // For inbound calls, contact info comes mostly from conversation, but we can get Caller ID
        const phone = metadata.phone || call.customer?.number || "";
        const city = metadata.city || "";
        const leadId = metadata.lead_id || "";

        const payload = {
            // Call metadata
            call_id: call.id,
            call_duration_seconds: call.endedAt
                ? Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)
                : null,
            call_ended_reason: call.endedReason,
            started_at: call.startedAt,
            ended_at: call.endedAt,

            // Lead info (passed in when call was initiated)
            lead_id: leadId,
            business_name: businessName,
            phone,
            city,

            // AI analysis results
            outcome: structured.outcome || "unknown",
            owner_reached: structured.owner_reached ?? false,
            contact_method: structured.contact_method || "none",
            contact_value: structured.contact_value || "",
            summary,

            // Full transcript (for logging/review)
            transcript,
        };

        // Log locally
        logCall(payload);
        console.log(`✅ Call ended: ${businessName} → ${payload.outcome}`);
        if (payload.contact_value) {
            console.log(
                `   📬 Contact collected: ${payload.contact_method} — ${payload.contact_value}`
            );
        }

        // Send to Zapier + log to Google Sheets + trigger follow-up (in parallel)
        await Promise.all([
            notifyZapier(payload),
            appendToSheet(payload),
            sendFollowUp(payload).catch(err =>
                console.error("❌ Follow-up failed:", err.message)
            ),
        ]);

        res.json({ ok: true });
        return;
    }

    // ── Unknown event ──────────────────────────────────────────────────────────
    res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEMO PAGE — serves the personalized smoke shop template
// Access: /demo?shop=Shop+Name&city=Houston
// ─────────────────────────────────────────────────────────────────────────────

app.get("/demo", (req, res) => {
    const templatePath = path.join(__dirname, "template", "index.html");
    if (!fs.existsSync(templatePath)) {
        return res.status(404).send("Template not found. Make sure /template/index.html exists.");
    }
    let html = fs.readFileSync(templatePath, "utf-8");

    // Inject the shop + city from query params into the config
    const shop = req.query.shop || "";
    const city = req.query.city || "";

    if (shop || city) {
        const injection = `<script>
  window.DEMO_OVERRIDE = { name: ${JSON.stringify(shop)}, city: ${JSON.stringify(city)} };
  document.addEventListener('DOMContentLoaded', function() {
    if (window.BUSINESS && window.DEMO_OVERRIDE) {
      if (window.DEMO_OVERRIDE.name) window.BUSINESS.name = window.DEMO_OVERRIDE.name;
      if (window.DEMO_OVERRIDE.city) window.BUSINESS.city = window.DEMO_OVERRIDE.city;
    }
  });
</script>`;
        // Inject before config.js loads
        html = html.replace('<script src="config.js"></script>', injection + '\n<script src="config.js"></script>');
    }

    res.setHeader("Content-Type", "text/html");
    res.send(html);
});

// Serve template static assets (CSS, JS, images)
app.use("/template", express.static(path.join(__dirname, "template")));

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "vapi-webhook" });
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
    console.log(`🎯 Vapi webhook listening on port ${PORT}`);
    console.log(`   POST http://localhost:${PORT}/vapi/webhook`);
    if (!ZAPIER_WEBHOOK_URL) {
        console.log(
            "⚠️  ZAPIER_WEBHOOK_URL not configured — set it in .env to enable Zapier"
        );
    }
});
