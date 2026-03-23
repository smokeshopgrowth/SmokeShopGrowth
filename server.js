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
const helmet = require('helmet');
const cors = require('cors');
const { createLogger } = require('./utils/logger');
const { errorHandler } = require('./utils/errors');

const logger = createLogger('Server');
const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net"],
            fontSrc: ["'self'", "fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", "cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "images.unsplash.com", "*.unsplash.com"],
            connectSrc: ["'self'", "*.stripe.com"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path !== '/api/ping' && !req.path.startsWith('/api/status/')) {
            logger.info(`${req.method} ${req.path}`, {
                status: res.statusCode,
                duration: `${duration}ms`,
            });
        }
    });
    next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
}));

// Demo sites
app.use('/demos', express.static(path.join(__dirname, 'public', 'demos'), {
    maxAge: '7d',
}));

// API routes
const apiRouter = require('./routes/api');
app.use(apiRouter);

// Health check
app.get('/api/ping', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});

// Catch-all for SPA routing (if needed)
app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received. Shutting down...');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Promise Rejection', { reason: String(reason) });
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
    process.exit(1);
});

// Start server
if (require.main === module) {
    app.listen(PORT, () => {
        logger.info(`Dashboard running at http://localhost:${PORT}`);
    });
}

module.exports = app;
