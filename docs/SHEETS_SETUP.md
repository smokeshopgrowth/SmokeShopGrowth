# Google Sheets Export Setup

This guide gets your pipeline connected to your Google Sheet in 5 minutes.

**Your spreadsheet ID:** `18ztIcGEA3u7iF4gKpwq_QVKng6b9HOWSFVGCoBBiDQ8`
**Your sheet URL:** <https://docs.google.com/spreadsheets/d/18ztIcGEA3u7iF4gKpwq_QVKng6b9HOWSFVGCoBBiDQ8>

---

## Step 1 — Create a Google Cloud Project

1. Go to <https://console.cloud.google.com>
2. Click **Select a project** → **New Project**
3. Name it anything (e.g. `lead-pipeline`) → **Create**

## Step 2 — Enable Google Sheets API

1. In your project, go to **APIs & Services → Library**
2. Search for **Google Sheets API**
3. Click it → **Enable**

## Step 3 — Create a Service Account

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → Service Account**
3. Name it anything (e.g. `sheets-writer`) → **Create and continue** → **Done**
4. Click the service account you just created
5. Go to **Keys** tab → **Add Key → Create new key → JSON**
6. A file called `credentials.json` downloads automatically

## Step 4 — Place the credentials file

Move `credentials.json` into your project root:

```
Build Google Maps Lead Scraper/
└── credentials.json   ← place it here
```

## Step 5 — Share your spreadsheet with the service account

1. Open `credentials.json` and copy the `client_email` value
   - It looks like: `sheets-writer@your-project.iam.gserviceaccount.com`
2. Open your Google Sheet
3. Click **Share** (top right)
4. Paste the service account email → set role to **Editor** → **Send**

## Step 6 — Run the pipeline

The dashboard already has your Sheet ID pre-filled. Just:

1. Start the server: `node server.js`
2. Open <http://localhost:3000>
3. Fill in city and business type
4. Make sure **Export to Google Sheets** is toggled on
5. Click **Run Pipeline**

Each run creates a new tab in the spreadsheet named after the city
(e.g. `houston`, `dallas`, etc.) with all audited lead data.

---

## Troubleshooting

| Error | Fix |
| --- | --- |
| `credentials.json not found` | Make sure the file is in the project root |
| `The caller does not have permission` | Share the sheet with the service account email |
| `Requested entity was not found` | Double-check the spreadsheet ID |
