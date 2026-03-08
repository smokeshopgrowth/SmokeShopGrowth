/**
 * vapi_call.js
 * Trigger a single outbound call via Vapi.
 * Also supports batch calling from a CSV leads file.
 *
 * Single call:
 *   node vapi_call.js --phone +17135551234 --name "Cloud 9 Smoke Shop" --city Houston
 *
 * Batch from CSV (reads data/leads_*.csv automatically):
 *   node vapi_call.js --batch
 *   node vapi_call.js --batch --file data/leads_houston.csv
 *   node vapi_call.js --batch --dry-run   ← preview only, no calls made
 *
 * CSV must have columns: phone, title (or name), city
 */

require("dotenv").config();
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { createReadStream } = require("fs");
const csvParser = require("csv-parser");

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;

if (!VAPI_API_KEY || !VAPI_ASSISTANT_ID || !VAPI_PHONE_NUMBER_ID) {
    console.error("❌ Missing required env vars: VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID");
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
// MAKE A SINGLE CALL
// ─────────────────────────────────────────────────────────────────────────────

async function makeCall({ phone, name, city, leadId }) {
    // Normalize phone to E.164
    const normalizedPhone = phone.replace(/\D/g, "");
    const e164 = normalizedPhone.startsWith("1")
        ? `+${normalizedPhone}`
        : `+1${normalizedPhone}`;

    const payload = {
        assistantId: VAPI_ASSISTANT_ID,
        customer: {
            number: e164,
            name: name,
        },
        phoneNumberId: VAPI_PHONE_NUMBER_ID,

        // Pass variables into the assistant prompt
        assistantOverrides: {
            variableValues: {
                business_name: name,
                city: city || "Houston",
            },
            // Override first message with actual business name
            firstMessage: `Hi, is this ${name}?`,
        },

        // Metadata passed back in webhook
        metadata: {
            lead_id: leadId || "",
            business_name: name,
            phone: e164,
            city: city || "Houston",
        },
    };

    const res = await vapi.post("/call/phone", payload);
    return res.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSE ARGS
// ─────────────────────────────────────────────────────────────────────────────

function getArg(flag) {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const isBatch = process.argv.includes("--batch");
const isDryRun = process.argv.includes("--dry-run");

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE CALL MODE
// ─────────────────────────────────────────────────────────────────────────────

async function singleCall() {
    const phone = getArg("--phone");
    const name = getArg("--name");
    const city = getArg("--city") || "Houston";

    if (!phone || !name) {
        console.error("Usage: node vapi_call.js --phone +1xxxxxxxxxx --name \"Shop Name\" --city Houston");
        process.exit(1);
    }

    console.log(`📞 Calling ${name} at ${phone}...`);

    if (isDryRun) {
        console.log("🔍 DRY RUN — no call made");
        console.log({ phone, name, city });
        return;
    }

    try {
        const call = await makeCall({ phone, name, city });
        console.log(`✅ Call initiated: ${call.id}`);
        console.log(`   Status: ${call.status}`);
    } catch (err) {
        console.error("❌ Call failed:", err.response?.data || err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH CALL MODE
// ─────────────────────────────────────────────────────────────────────────────

async function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        createReadStream(filePath)
            .pipe(csvParser())
            .on("data", (row) => rows.push(row))
            .on("end", () => resolve(rows))
            .on("error", reject);
    });
}

function findLeadsFile() {
    const dataDir = path.join(__dirname, "data");
    if (!fs.existsSync(dataDir)) return null;
    const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".csv"));
    if (!files.length) return null;
    // Prefer most recently modified
    files.sort((a, b) => {
        const statA = fs.statSync(path.join(dataDir, a)).mtimeMs;
        const statB = fs.statSync(path.join(dataDir, b)).mtimeMs;
        return statB - statA;
    });
    return path.join(dataDir, files[0]);
}

async function batchCall() {
    const customFile = getArg("--file");
    const file = customFile || findLeadsFile();

    if (!file || !fs.existsSync(file)) {
        console.error("❌ No CSV file found. Use --file path/to/leads.csv or place a CSV in data/");
        process.exit(1);
    }

    console.log(`📂 Loading leads from: ${file}`);
    const leads = await readCSV(file);

    // Filter leads that have a phone number
    const callable = leads.filter((r) => {
        const phone = r.phone || r.Phone || r.telephone;
        return phone && phone.replace(/\D/g, "").length >= 10;
    });

    console.log(`📋 ${callable.length} callable leads (out of ${leads.length} total)`);

    if (isDryRun) {
        console.log("\n🔍 DRY RUN — first 5 leads:");
        callable.slice(0, 5).forEach((r, i) => {
            const name = r.title || r.name || r.Name || "Unknown";
            const phone = r.phone || r.Phone;
            const city = r.city || r.City || "Houston";
            console.log(`  ${i + 1}. ${name} — ${phone} — ${city}`);
        });
        return;
    }

    // Delay between calls to avoid hammering (2s gap)
    const DELAY_MS = 2000;
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < callable.length; i++) {
        const row = callable[i];
        const name = row.title || row.name || row.Name || "Unknown Shop";
        const phone = row.phone || row.Phone || row.telephone;
        const city = row.city || row.City || "Houston";
        const leadId = row.id || row.place_id || String(i);

        process.stdout.write(`[${i + 1}/${callable.length}] ${name} (${phone})... `);

        try {
            const call = await makeCall({ phone, name, city, leadId });
            console.log(`✅ ${call.id}`);
            succeeded++;
        } catch (err) {
            const errMsg = err.response?.data?.message || err.message;
            console.log(`❌ ${errMsg}`);
            failed++;
        }

        if (i < callable.length - 1) {
            await new Promise((r) => setTimeout(r, DELAY_MS));
        }
    }

    console.log(`\n📊 Done: ${succeeded} succeeded, ${failed} failed`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (isBatch) {
    batchCall().catch(console.error);
} else {
    singleCall().catch(console.error);
}
