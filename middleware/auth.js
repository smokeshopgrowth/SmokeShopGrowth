'use strict';

const crypto = require('crypto');

/**
 * API Key authentication middleware.
 * Requires API_KEY env var to be set. If not set, rejects all requests (fail closed).
 * Uses timing-safe comparison to prevent timing attacks.
 */
function apiKeyAuth(req, res, next) {
    const requiredKey = process.env.API_KEY;

    if (!requiredKey) {
        console.error('[AUTH] API_KEY environment variable is not set — rejecting request.');
        return res.status(503).json({ error: 'Server misconfigured. Authentication unavailable.' });
    }

    const provided = req.headers['x-api-key'] || '';

    if (!provided) {
        return res.status(401).json({ error: 'Unauthorized. Provide x-api-key header.' });
    }

    // Timing-safe comparison to prevent timing attacks
    const a = Buffer.from(requiredKey);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: 'Unauthorized. Invalid API key.' });
    }

    return next();
}

module.exports = { apiKeyAuth };
