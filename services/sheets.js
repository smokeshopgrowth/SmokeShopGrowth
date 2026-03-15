'use strict';

const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const { google } = require('googleapis');

async function exportToSheets(spreadsheetId, csvPath, sheetTitle) {
    const credPath = path.join(__dirname, '..', 'credentials.json');
    if (!fs.existsSync(credPath)) {
        throw new Error('credentials.json not found. See README for Google Sheets setup.');
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: credPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read CSV into 2D array
    const rows = await new Promise((resolve, reject) => {
        const data = [];
        let headerPushed = false;
        fs.createReadStream(csvPath)
            .pipe(csv())
            .on('data', row => {
                if (!headerPushed) {
                    data.push(Object.keys(row));
                    headerPushed = true;
                }
                data.push(Object.values(row));
            })
            .on('end', () => resolve(data))
            .on('error', reject);
    });

    // Create or clear a sheet tab named after the city
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheet = meta.data.sheets.find(
        s => s.properties.title === sheetTitle
    );

    if (existingSheet) {
        await sheets.spreadsheets.values.clear({
            spreadsheetId,
            range: `${sheetTitle}!A1:Z10000`,
        });
    } else {
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
                requests: [{ addSheet: { properties: { title: sheetTitle } } }],
            },
        });
    }

    await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${sheetTitle}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: rows },
    });
}

module.exports = { exportToSheets };
