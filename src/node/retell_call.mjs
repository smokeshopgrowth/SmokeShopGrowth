import "dotenv/config";
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import csvParser from "csv-parser";
import { fileURLToPath } from "url";
import Retell from "retell-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RETELL_API_KEY = process.env.RETELL_API_KEY;
const RETELL_AGENT_ID = process.env.RETELL_AGENT_ID;
const RETELL_FROM_NUMBER = process.env.RETELL_FROM_NUMBER;

if (!RETELL_API_KEY || !RETELL_FROM_NUMBER) {
    console.error("Missing required env vars: RETELL_API_KEY, RETELL_FROM_NUMBER");
    process.exit(1);
}

const retellClient = new Retell({
    apiKey: RETELL_API_KEY,
});

// ─────────────────────────────────────────────────────────────────────────────
// CALL LOG — tracks every call attempt to prevent duplicates
// ─────────────────────────────────────────────────────────────────────────────

const CALL_LOG_PATH = path.join(__dirname, "..", "..", "logs", "retell_call_attempts.jsonl");

function ensureLogDir() {
    const dir = path.dirname(CALL_LOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadCalledPhones() {
    ensureLogDir();
    const called = new Map();
    if (!fs.existsSync(CALL_LOG_PATH)) return called;

    const lines = fs.readFileSync(CALL_LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            if (entry.status === "ok") {
                called.set(entry.phone, entry);
            }
        } catch {
            // Ignore malformed log lines from interrupted writes.
        }
    }
    return called;
}

function logCallAttempt(entry) {
    ensureLogDir();
    fs.appendFileSync(CALL_LOG_PATH, JSON.stringify(entry) + "\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// MAKE A SINGLE CALL
// ─────────────────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, "");
    return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
}

async function makeCall({ phone, name, city, problem }) {
    if (name && name.length > 40) {
        name = name.substring(0, 37) + '...';
    }

    const e164 = normalizePhone(phone);
    const websiteProblem = problem || "no website";

    const payload = {
        from_number: RETELL_FROM_NUMBER,
        to_number: e164,
        retell_llm_dynamic_variables: {
            business_name: name,
            city: city || "Houston",
            problem: websiteProblem
        }
    };
    
    // override_agent_id is optional but highly recommended if not set on the phone number default
    if (RETELL_AGENT_ID) {
        payload.override_agent_id = RETELL_AGENT_ID;
    }

    const callResponse = await retellClient.call.createPhoneCall(payload);
    return callResponse;
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
const isStatus = process.argv.includes("--status");

// ─────────────────────────────────────────────────────────────────────────────
// STATUS — show what's been called
// ─────────────────────────────────────────────────────────────────────────────

function showStatus() {
    const called = loadCalledPhones();
    if (called.size === 0) {
        console.log("No calls logged yet.");
        return;
    }

    console.log(`\n--- Call Log (${called.size} successful calls) ---\n`);
    console.log("Phone           | Business                          | Call ID                              | Time");
    console.log("----------------|-----------------------------------|--------------------------------------|---------------------");
    for (const [phone, entry] of called) {
        const name = (entry.name || "").padEnd(35).slice(0, 35);
        const id = (entry.call_id || "").padEnd(38).slice(0, 38);
        const ts = entry.ts ? new Date(entry.ts).toLocaleString() : "";
        console.log(`${phone.padEnd(16)}| ${name} | ${id} | ${ts}`);
    }
    console.log("");
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE CALL MODE
// ─────────────────────────────────────────────────────────────────────────────

async function singleCall() {
    const phone = getArg("--phone");
    const name = getArg("--name");
    const city = getArg("--city") || "Houston";

    if (!phone || !name) {
        console.error("Usage: node retell_call.js --phone +1xxxxxxxxxx --name \"Shop Name\" --city Houston");
        process.exit(1);
    }

    const e164 = normalizePhone(phone);
    const called = loadCalledPhones();

    if (called.has(e164)) {
        console.log(`SKIP: ${name} (${e164}) — already called on ${called.get(e164).ts}`);
        return;
    }

    console.log(`Calling ${name} at ${e164}...`);

    if (isDryRun) {
        console.log("DRY RUN — no call made");
        return;
    }

    try {
        const call = await makeCall({ phone, name, city });
        console.log(`Call initiated: ${call.call_id}`);
        logCallAttempt({ phone: e164, name, call_id: call.call_id, status: "ok", ts: new Date().toISOString() });
    } catch (err) {
        console.error("Call failed:", err.message);
        logCallAttempt({ phone: e164, name, call_id: null, status: "error", error: err.message, ts: new Date().toISOString() });
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

async function batchCall() {
    const customFile = getArg("--file");
    const file = customFile;

    if (!file || !fs.existsSync(file)) {
        console.error("No CSV file found. Use --file path/to/leads.csv");
        process.exit(1);
    }

    console.log(`Loading leads from: ${file}`);
    const leads = await readCSV(file);

    const callable = leads.filter((r) => {
        const phone = r.phone || r.Phone || r.telephone;
        return phone && phone.replace(/\D/g, "").length >= 10;
    });

    const calledPhones = loadCalledPhones();
    const fresh = callable.filter((r) => {
        const phone = r.phone || r.Phone || r.telephone;
        const e164 = normalizePhone(phone);
        return !calledPhones.has(e164);
    });

    const skipped = callable.length - fresh.length;

    console.log(`${callable.length} callable leads total`);
    if (skipped > 0) {
        console.log(`${skipped} already called — skipping`);
    }
    console.log(`${fresh.length} new leads to call`);

    if (fresh.length === 0) {
        console.log("\nAll leads have already been called. Nothing to do.");
        return;
    }

    if (isDryRun) {
        console.log("\nDRY RUN — first 10 new leads:");
        fresh.slice(0, 10).forEach((r, i) => {
            const name = r.business_name || r.title || r.name || r.Name || "Unknown";
            const phone = r.phone || r.Phone;
            const city = r.city || r.City || "Houston";
            const reason = r.reason || "No website";
            console.log(`  ${i + 1}. ${name} — ${phone} — ${city} — ${reason}`);
        });
        if (fresh.length > 10) console.log(`  ... and ${fresh.length - 10} more`);
        return;
    }

    const DELAY_MS = parseInt(getArg("--delay") || "10000", 10);
    let succeeded = 0;
    let failed = 0;

    console.log(`\nStarting calls (${DELAY_MS / 1000}s delay between each)...\n`);

    for (let i = 0; i < fresh.length; i++) {
        const row = fresh[i];
        const name = row.business_name || row.title || row.name || row.Name || "Unknown Shop";
        const phone = row.phone || row.Phone || row.telephone;
        const e164 = normalizePhone(phone);
        const city = row.city || row.City || "Houston";
        const reason = row.reason || "";
        const website = row.website || row.Website || "";

        let problem = reason || "no website";
        if (!reason && website && website.trim()) {
            const httpStatus = row.http_status || row.status_code || row.website_status || "";
            if (httpStatus && parseInt(httpStatus) >= 400) {
                problem = "Broken website";
            } else if (row.mobile_friendly === "no" || row.mobile_friendly === "false") {
                problem = "website that isn't mobile-friendly";
            } else {
                problem = "website that could use an upgrade";
            }
        }

        process.stdout.write(`[${i + 1}/${fresh.length}] ${name} (${phone})... `);

        try {
            const call = await makeCall({ phone, name, city, problem });
            console.log(`OK ${call.call_id}`);
            logCallAttempt({ phone: e164, name, call_id: call.call_id, status: "ok", ts: new Date().toISOString() });
            succeeded++;
        } catch (err) {
            console.log(`FAIL ${err.message}`);
            logCallAttempt({ phone: e164, name, call_id: null, status: "error", error: err.message, ts: new Date().toISOString() });
            failed++;
        }

        if (i < fresh.length - 1) {
            await new Promise((r) => setTimeout(r, DELAY_MS));
        }
    }

    console.log(`\nDone: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (already called)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

if (isStatus) {
    showStatus();
} else if (isBatch) {
    batchCall().catch(console.error);
} else {
    singleCall().catch(console.error);
}
