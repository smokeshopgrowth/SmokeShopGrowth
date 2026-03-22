/**
 * Dashboard Server
 * ================
 * Express web server that powers the lead generation dashboard.
 */
'use strict';
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { createLogger } = require('./utils/logger');
const { errorHandler, NotFoundError } = require('./utils/errors');

const logger = createLogger('Server');
const app = express();
const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (!req.path.startsWith('/api/status')) { // Skip SSE status logs
            logger.info(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        }
    });
    next();
});

// Fix: Stripe webhook needs raw body
app.use((req, res, next) => {
    if (req.originalUrl === '/webhook/stripe') return next();
    express.json({ limit: '10mb' })(req, res, next);
});

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/demos', express.static(path.join(__dirname, 'public/demos')));

const deployPath = path.join(__dirname, 'deployments');
if (!fs.existsSync(deployPath)) fs.mkdirSync(deployPath);
app.use('/deployments', express.static(deployPath));

// Serve assets for the premium template
app.use(express.static(path.join(__dirname, 'template')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/api/ping', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
    });
});

// Railway health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'dashboard', ts: Date.now() });
});

// Mount route modules
app.use(require('./routes/api'));
app.use(require('./routes/demos'));
app.use(require('./routes/social'));
app.use(require('./routes/webhooks'));

// 404 handler
app.use((req, res, next) => {
    next(new NotFoundError('Route'));
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
const shutdown = (signal) => {
    logger.info(`${signal} received. Shutting down gracefully...`);
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Uncaught error handlers
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', { reason, promise: String(promise) });
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Dashboard running at http://localhost:${PORT}`);
    });
}

module.exports = app;
