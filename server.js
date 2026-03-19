/**
 * Dashboard Server
 * ================
 * Express web server that powers the lead generation dashboard.
 * Provides a form UI, runs the pipeline steps as child processes,
 * streams real-time progress via SSE, and exports to Google Sheets.
 *
 * Start:  node server.js
 * Open:   http://localhost:3000
 */

'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Fix #4: Stripe webhook needs raw body for signature verification.
// Apply express.json() to all routes EXCEPT /webhook/stripe.
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook/stripe') return next();
    express.json()(req, res, next);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

const deployPath = path.join(__dirname, 'deployments');
if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath);
app.use('/deployments', express.static(deployPath));

// Serve assets for the premium template (styles.css, animations.js, etc.)
app.use(express.static(path.join(__dirname, 'template')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount route modules
app.use(require('./routes/api'));
app.use(require('./routes/demos'));
app.use(require('./routes/social'));
app.use(require('./routes/webhooks'));

// Start server
if (require.main === module) {
    
// ── Demo Sites ────────────────────────────────────────────────────────────────
app.get('/demo/:slug', (req, res) => {
  const slug = req.params.slug.replace(/[^a-z0-9-]/g, '');
  const filePath = path.join(__dirname, 'data', 'demos', `${slug}.html`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('<h1>Demo not found</h1><p>This demo may not have been generated yet.</p>');
  }
});

app.get('/demo', (req, res) => {
  const demosDir = path.join(__dirname, 'data', 'demos');
  if (!fs.existsSync(demosDir)) return res.json({ demos: [] });
  const files = fs.readdirSync(demosDir).filter(f => f.endsWith('.html'));
  const demos = files.map(f => ({
    slug: f.replace('.html', ''),
    url: `${process.env.DEMO_BASE_URL || ''}/demo/${f.replace('.html', '')}`
  }));
  res.json({ count: demos.length, demos });
});

app.listen(PORT, () => {
        console.log(`\n🚀 Dashboard running at http://localhost:${PORT}\n`);
    });
}

module.exports = app;
