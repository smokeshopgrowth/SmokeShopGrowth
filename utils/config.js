'use strict';

/**
 * Validates and exposes strictly required environment variables on startup.
 * Prevents the application from starting in an invalid state.
 */

const requiredVars = [
    'API_KEY',
    'STRIPE_API_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_AGENT_ID',
    'ELEVENLABS_PHONE_NUMBER_ID',
    'VAPI_WEBHOOK_SECRET',
];

function validateConfig() {
    const missing = [];
    
    for (const key of requiredVars) {
        if (!process.env[key]) {
            missing.push(key);
        }
    }

    // Optional but highly recommended vars with warnings
    const warnings = [];
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        warnings.push('SMTP_USER and/or SMTP_PASS (Emails will not be sent)');
    }
    if (!process.env.ZAPIER_WEBHOOK_URL) {
        warnings.push('ZAPIER_WEBHOOK_URL (Zapier forwarding disabled)');
    }

    if (missing.length > 0) {
        console.error('\n❌ [CRITICAL ERROR] Missing Required Environment Variables:');
        missing.forEach(m => console.error(`   - ${m}`));
        console.error('Please add these keys to your .env file and restart the server.\n');
        
        // Fail fast
        if (require.main === module || process.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
    }

    if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
        console.warn('\n⚠️  [WARNING] Missing Optional Variables:');
        warnings.forEach(w => console.warn(`   - ${w}`));
        console.warn('');
    }

    return {
        port: process.env.PORT || 3000,
        apiKey: process.env.API_KEY,
        isDev: process.env.NODE_ENV !== 'production',
        stripe: {
            apiKey: process.env.STRIPE_API_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
        },
        elevenLabs: {
            apiKey: process.env.ELEVENLABS_API_KEY,
            agentId: process.env.ELEVENLABS_AGENT_ID,
            phoneNumberId: process.env.ELEVENLABS_PHONE_NUMBER_ID,
        },
        vapi: {
            webhookSecret: process.env.VAPI_WEBHOOK_SECRET,
        },
        smtp: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || '587',
        },
        zapierUrl: process.env.ZAPIER_WEBHOOK_URL,
        demoBaseUrl: process.env.DEMO_BASE_URL || 'https://smoke-shop-premium-demo.netlify.app',
    };
}

module.exports = validateConfig();
