'use strict';

const router = require('express').Router();
const express = require('express');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const n8nService = require('../src/node/n8n_service');
const { pushLog } = require('../services/sse');
const { webhookLimiter } = require('../middleware/rate-limit');
const { insertPayment } = require('../src/node/db');

const PORT = process.env.PORT || 3000;

/** Shared SMTP transporter — created once, reused across routes. */
function getTransporter() {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
}

// POST /webhook/call — Zapier webhook -> trigger ElevenLabs call
router.post('/webhook/call', webhookLimiter, async (req, res) => {
    const requiredKey = process.env.API_KEY;
    if (!requiredKey || req.headers['x-api-key'] !== requiredKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
        business_name = '',
        phone = '',
        city = '',
        agent_name = process.env.AGENT_NAME || 'Alex',
    } = req.body;

    if (!phone) {
        return res.status(400).json({ error: 'phone is required' });
    }

    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;

    if (!apiKey) {
        return res.status(500).json({ error: 'ELEVENLABS_API_KEY not set' });
    }
    if (!agentId) {
        return res.status(500).json({ error: 'ELEVENLABS_AGENT_ID not set. Please add it to your .env file.' });
    }
    if (!phoneNumberId) {
        return res.status(500).json({ error: 'ELEVENLABS_PHONE_NUMBER_ID not set. Please add it to your .env file.' });
    }

    pushLog('call', `Attempting call to ${phone} using agent ${agentId}…`, 'log');

    try {
        const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                agent_id: agentId,
                agent_phone_number_id: phoneNumberId,
                to_number: phone,
                dynamic_variables: { business_name, city, agent_name },
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.detail?.message || JSON.stringify(data));

        console.log(`📞 Call started → ${business_name} (${phone}) — conversation: ${data.conversation_id}`);
        res.json({ success: true, conversation_id: data.conversation_id });
    } catch (err) {
        console.error(`❌ Call failed for ${phone}: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// POST /webhook/vapi — Vapi end-of-call webhook
router.post('/webhook/vapi', webhookLimiter, async (req, res) => {
    const vapiSecret = process.env.VAPI_WEBHOOK_SECRET;
    if (!vapiSecret) {
        console.error('[VAPI] VAPI_WEBHOOK_SECRET not set — rejecting webhook');
        return res.status(503).json({ error: 'Webhook secret not configured' });
    }
    if (req.headers['x-vapi-secret'] !== vapiSecret) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    res.status(200).json({ received: true });

    try {
        const body = req.body || {};
        const type = body.message?.type || body.type || '';

        if (type !== 'end-of-call-report' && type !== 'end_of_call_report') return;

        const call = body.message?.call || body.call || body;
        const analysis = body.message?.analysis || body.analysis || {};
        const artifact = body.message?.artifact || body.artifact || {};

        const business_name = call?.customer?.name || call?.metadata?.business_name || '';
        const phone = call?.customer?.number || '';
        const city = call?.metadata?.city || '';
        const call_id = call?.id || '';
        const duration = call?.endedAt && call?.startedAt
            ? Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000)
            : 0;
        const outcome = analysis?.successEvaluation || analysis?.summary || 'completed';
        const summary = analysis?.summary || '';

        let collected_email = '';
        const messages = artifact?.messages || [];
        for (const msg of messages) {
            const text = (msg.message || msg.content || '').toLowerCase();
            const emailMatch = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
            if (emailMatch) {
                collected_email = emailMatch[0];
                break;
            }
        }

        console.log(`📞 Vapi call ended — ${business_name} (${phone}) | email: ${collected_email || 'none'} | outcome: ${outcome}`);

        if (collected_email && business_name) {
            try {
                await fetch(`http://localhost:${PORT}/api/send-demo`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: collected_email,
                        business_name,
                        city,
                    }),
                });
                console.log(`✅ Demo email auto-triggered to ${collected_email}`);
            } catch (emailErr) {
                console.error('Failed to auto-send demo email:', emailErr.message);
            }
        }

        const zapierUrl = process.env.ZAPIER_WEBHOOK_URL;
        if (zapierUrl) {
            const payload = {
                business_name,
                phone,
                city,
                call_id,
                duration_seconds: duration,
                outcome,
                summary,
                email: collected_email,
                contact_value: collected_email ? 'email_captured' : 'no_contact',
                timestamp: new Date().toISOString(),
            };
            fetch(zapierUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            }).catch(err => console.error('Zapier forward error:', err.message));
        }

        n8nService.notifyCallOutcome({
            business_name,
            phone,
            city,
            call_id,
            duration_seconds: duration,
            outcome,
            summary,
            email: collected_email,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('Vapi webhook processing error:', err.message);
    }
});

// POST /api/create-checkout — Stripe checkout session
router.post('/api/create-checkout', webhookLimiter, async (req, res) => {
    if (!process.env.STRIPE_API_KEY) {
        return res.status(500).json({ error: 'STRIPE_API_KEY not set' });
    }
    const stripe = require('stripe')(process.env.STRIPE_API_KEY);

    const { email, business_name, city, tier = 'growth' } = req.body || {};
    if (!email || !business_name) {
        return res.status(400).json({ error: 'email and business_name are required' });
    }

    const TIER_PRICES = {
        starter: { setup: 9900, name: 'Starter Website' },
        growth: { setup: 29900, name: 'Growth Website' },
        pro: { setup: 49900, name: 'Pro Website' },
    };
    const selected = TIER_PRICES[tier] || TIER_PRICES.growth;
    const DEMO_BASE_URL = process.env.DEMO_BASE_URL || 'https://smoke-shop-premium-demo.netlify.app';

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            client_reference_id: email,
            customer_email: email,
            metadata: { business_name, city, tier },
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${selected.name} — ${business_name}`,
                        description: `Custom smoke shop website for ${business_name} in ${city}`,
                    },
                    unit_amount: selected.setup,
                },
                quantity: 1,
            }],
            success_url: `${DEMO_BASE_URL}/?shop=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}&paid=true`,
            cancel_url: `${DEMO_BASE_URL}/?shop=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}`,
        });

        console.log(`💳 Checkout session created for ${business_name}: ${session.url}`);
        res.json({ checkout_url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /webhook/stripe — Stripe payment webhook
// NOTE: uses express.raw() middleware for signature verification
router.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const stripeKey = process.env.STRIPE_API_KEY;
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeKey) {
        console.error('STRIPE_API_KEY not set');
        return res.status(500).send('Stripe not configured');
    }

    if (!endpointSecret) {
        console.error('STRIPE_WEBHOOK_SECRET is not set — rejecting webhook');
        return res.status(500).send('Stripe webhook secret not configured');
    }

    const stripe = require('stripe')(stripeKey);
    let event;

    const sig = req.headers['stripe-signature'];
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error('Stripe webhook signature failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const email = session.customer_details?.email || session.customer_email || '';
        const amount = (session.amount_total || 0) / 100;
        const refId = session.client_reference_id || '';
        const meta = session.metadata || {};
        const businessName = meta.business_name || refId.split('|')[0] || 'Smoke Shop';
        const city = meta.city || refId.split('|')[1] || '';
        const tier = meta.tier || 'starter';

        console.log(`\n[STRIPE] Payment received!`);
        console.log(`  Customer: ${email}`);
        console.log(`  Amount: $${amount}`);
        console.log(`  Business: ${businessName} (${city})`);
        console.log(`  Tier: ${tier}`);

        // Log to DB and JSONL
        try {
            insertPayment.run({
                email, business_name: businessName, city, tier,
                amount, stripe_session: session.id || '',
            });
        } catch (dbErr) {
            console.error('DB payment log error:', dbErr.message);
        }
        const paymentLog = {
            email, amount, businessName, city, tier, refId,
            paid_at: new Date().toISOString(),
        };
        fs.mkdirSync('logs', { recursive: true });
        fs.appendFileSync(
            path.join('logs', 'payments.jsonl'),
            JSON.stringify(paymentLog) + '\n'
        );

        try {
            const deployRoot = path.join(__dirname, '..', 'deployments');
            if (!fs.existsSync(deployRoot)) fs.mkdirSync(deployRoot);

            const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
            const projectPath = path.join(deployRoot, `shop-${slug}`);
            if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });

            const templateHtml = fs.readFileSync(path.join(__dirname, '..', 'template', 'index.html'), 'utf-8');
            const templateCss = path.join(__dirname, '..', 'template', 'styles.css');
            const templateAnimations = path.join(__dirname, '..', 'template', 'animations.js');

            const shopConfig = `window.BUSINESS = ${JSON.stringify({
                name: businessName,
                city: city,
                phone: '',
                address: city,
                hours: 'Open Daily',
                instagram: '#',
                googleMaps: 'https://maps.google.com/?q=' + encodeURIComponent(businessName + ' ' + city),
                categories: ['Vapes', 'CBD', 'Kratom', 'Hookah', 'Delta-8', 'Glass Pipes', 'Cigars'],
                testimonials: [
                    { name: 'Customer', role: 'Regular', stars: 5, quote: 'Great shop, great products!' }
                ],
                showDemoBanner: false,
            }, null, 2)};`;

            fs.writeFileSync(path.join(projectPath, 'index.html'), templateHtml);
            fs.writeFileSync(path.join(projectPath, 'config.js'), shopConfig);
            if (fs.existsSync(templateCss)) fs.copyFileSync(templateCss, path.join(projectPath, 'styles.css'));
            if (fs.existsSync(templateAnimations)) fs.copyFileSync(templateAnimations, path.join(projectPath, 'animations.js'));

            const liveUrl = `/deployments/shop-${slug}/index.html`;
            console.log(`[DEPLOY] Site generated: ${liveUrl}`);

            const transporter = getTransporter();
            if (email && transporter) {
                const serverBase = process.env.PUBLIC_URL || process.env.DEMO_BASE_URL || `http://localhost:${PORT}`;
                const fullUrl = serverBase + liveUrl;

                await transporter.sendMail({
                    from: `"SmokeShopGrowth" <${process.env.SMTP_USER}>`,
                    to: email,
                    subject: `Your website is live! — ${businessName}`,
                    html: `
                        <div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:40px 24px;background:#0a0a0a;color:#fff;">
                            <h1 style="color:#39ff14;font-size:1.5rem;">Your website is live!</h1>
                            <p style="color:#ccc;line-height:1.7;">Hey ${businessName},</p>
                            <p style="color:#ccc;line-height:1.7;">Thanks for your payment! Your new website has been generated and is ready to view:</p>
                            <div style="text-align:center;margin:32px 0;">
                                <a href="${fullUrl}" style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);color:#000;font-weight:700;padding:14px 36px;border-radius:999px;font-size:1.1rem;text-decoration:none;">View Your Live Website</a>
                            </div>
                            <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
                                We'll be setting up your custom domain and making any tweaks you need. Just reply to this email with any changes you'd like.
                            </p>
                            <hr style="border:none;border-top:1px solid #222;margin:32px 0;" />
                            <p style="color:#666;font-size:.82rem;">SmokeShopGrowth • 281-323-0450<br/>Questions? Just reply to this email.</p>
                        </div>`,
                    text: `Hey ${businessName}! Your website is live: ${fullUrl}\n\nReply with any changes. — SmokeShopGrowth`,
                });
                console.log(`[DELIVERY] Email sent to ${email} with live URL`);
            }

            if (transporter) {
                await transporter.sendMail({
                    from: `"Payment Alert" <${process.env.SMTP_USER}>`,
                    to: process.env.SMTP_USER,
                    subject: `$${amount} PAID — ${businessName} (${tier})`,
                    text: `Payment received!\n\nBusiness: ${businessName}\nEmail: ${email}\nAmount: $${amount}\nTier: ${tier}\nCity: ${city}\nSite: /deployments/shop-${slug}/index.html`,
                });
            }

            n8nService.notifyPipelineEvent('payment_received', { email, businessName, city, tier, amount });

        } catch (deployErr) {
            console.error('[DEPLOY] Failed:', deployErr.message);
            fs.appendFileSync(
                path.join('logs', 'failed_deploys.jsonl'),
                JSON.stringify({ email, businessName, city, tier, error: deployErr.message, ts: new Date().toISOString() }) + '\n'
            );
        }
    }

    res.json({ received: true });
});

module.exports = router;
