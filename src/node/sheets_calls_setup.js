/**
 * sheets_calls_setup.js
 * Creates a "Call Logs" tab in your existing Google Sheet with the right headers.
 * Also updates vapi_webhook.js to log directly to Sheets on every call.
 *
 * Run once:
 *   node sheets_calls_setup.js
 */

require("dotenv").config();
const { google } = require("googleapis");
const path = require("path");

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SHEET_TAB_NAME = "Call Logs";

const HEADERS = [
    "Timestamp",
    "Business Name",
    "Phone",
    "City",
    "Outcome",
    "Owner Reached",
    "Contact Method",
    "Contact Value",
    "Call Duration (s)",
    "Summary",
    "Call ID",
];

async function getSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const client = await auth.getClient();
    return google.sheets({ version: "v4", auth: client });
}

async function main() {
    console.log("🔗 Connecting to Google Sheets...");
    const sheets = await getSheets();

    // ── Get existing sheets ───────────────────────────────────────────────────
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existingTabs = meta.data.sheets.map((s) => s.properties.title);
    console.log(`📋 Existing tabs: ${existingTabs.join(", ")}`);

    // ── Create "Call Logs" tab if it doesn't exist ────────────────────────────
    if (!existingTabs.includes(SHEET_TAB_NAME)) {
        console.log(`➕ Creating tab "${SHEET_TAB_NAME}"...`);
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: {
                                title: SHEET_TAB_NAME,
                                gridProperties: { rowCount: 1000, columnCount: HEADERS.length },
                            },
                        },
                    },
                ],
            },
        });
        console.log(`✅ Tab "${SHEET_TAB_NAME}" created`);
    } else {
        console.log(`ℹ️  Tab "${SHEET_TAB_NAME}" already exists`);
    }

    // ── Write headers ─────────────────────────────────────────────────────────
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_TAB_NAME}!A1`,
        valueInputOption: "RAW",
        requestBody: {
            values: [HEADERS],
        },
    });
    console.log(`✅ Headers written: ${HEADERS.join(" | ")}`);

    // ── Bold + freeze the header row ──────────────────────────────────────────
    const sheetsMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const callLogsSheet = sheetsMeta.data.sheets.find(
        (s) => s.properties.title === SHEET_TAB_NAME
    );
    const sheetId = callLogsSheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                // Bold headers
                {
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: { userEnteredFormat: { textFormat: { bold: true } } },
                        fields: "userEnteredFormat.textFormat.bold",
                    },
                },
                // Freeze header row
                {
                    updateSheetProperties: {
                        properties: {
                            sheetId,
                            gridProperties: { frozenRowCount: 1 },
                        },
                        fields: "gridProperties.frozenRowCount",
                    },
                },
            ],
        },
    });

    console.log("✅ Header row bolded and frozen");
    console.log(`\n🎉 Done! Open your sheet:`);
    console.log(
        `   https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}#gid=${sheetId}`
    );
    console.log(`\n📌 Your sheet ID for vapi_webhook.js: ${sheetId}`);
}

main().catch((err) => {
    console.error("❌ Error:", err.message);
    process.exit(1);
});
