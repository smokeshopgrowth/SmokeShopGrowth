/**
 * SmokeShopGrowth Server
 * ======================
 * Express web server — serves the public marketing site at /,
 * the internal lead-gen dashboard at /dashboard, and all API +
 * webhook routes for the pipeline, voice agent, and Stripe.
 *
 * Start:  node server.js
 * Open:   http://localhost:3000
 */

'use strict';
require('dotenv').config();
const config = require('./utils/config'); // Early fail-fast validation

const express = require('express');
const path = require('path');
const fs = require('fs');

const rateLimit = require('express-rate-limit');
const { errorHandler } = require('./utils/errors');
const { makeJobId } = require('./services/sse');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

// Dashboard route — serves the internal tool at /dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files (public/index.html = marketing landing page)
app.use(express.static(path.join(__dirname, 'public')));

// Health check (no auth required)
app.get('/api/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount modular routers
const apiRouter = require('./routes/api');
const webhookRouter = require('./routes/webhooks');

app.use(apiRouter);
app.use(webhookRouter);

// ──────────────────────────────────────────────
// Template Form Submission Endpoint
// ──────────────────────────────────────────────
const templateSubmissions = [];

app.post('/api/template-submission', webhookLimiter, async (req, res) => {
    try {
        const { shopName, city, phone, email } = req.body;

        if (!shopName || !city || !phone || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const submission = {
            id: makeJobId(),
            shopName: shopName.trim(),
            city: city.trim(),
            phone: phone.trim(),
            email: email.trim(),
            timestamp: new Date().toISOString()
        };

        templateSubmissions.push(submission);
        console.log(`Form received: ${submission.shopName} (${submission.city})`);

        res.status(200).json({
            success: true,
            message: 'Thank you! We\'ll contact you shortly.',
            submissionId: submission.id
        });
    } catch (err) {
        console.error('Form submission error:', err.message);
        res.status(500).json({ error: 'Failed to process submission' });
    }
});

app.get('/api/template-submissions', (req, res) => {
    res.json({
        count: templateSubmissions.length,
        submissions: templateSubmissions
    });
});

// ── Global error handler ────────────────────────────────────────────────────
// Must be defined AFTER all routes
app.use(errorHandler);

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`\n🚀 SmokeShopGrowth running at http://localhost:${PORT}`);
        console.log(`   Landing page: http://localhost:${PORT}/`);
        console.log(`   Dashboard:    http://localhost:${PORT}/dashboard\n`);
    });
}

module.exports = app;
