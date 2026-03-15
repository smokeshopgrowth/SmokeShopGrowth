'use strict';

const rateLimit = require('express-rate-limit');

const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
});

module.exports = { webhookLimiter };
