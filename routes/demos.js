'use strict';

const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const n8nService = require('../src/node/n8n_service');
const { makeJobId } = require('../services/sse');
const { webhookLimiter } = require('../middleware/rate-limit');

const PORT = process.env.PORT || 3000;

// In-memory template submissions
const templateSubmissions = [];

// GET /demo — personalized demo preview
router.get('/demo', (req, res) => {
    const templatePath = path.join(__dirname, '..', 'template.html');
    if (!fs.existsSync(templatePath)) {
        return res.status(404).send('Demo template not found.');
    }

    const business = {
        name: req.query.name || req.query.shop || 'Your Smoke Shop',
        city: req.query.city || 'Your City',
        phone: req.query.phone || '(000) 000-0000',
        instagram: req.query.instagram || 'yourshop',
        address: req.query.address || req.query.city || '',
        hours: 'Open daily • 9AM - 11PM'
    };

    let html = fs.readFileSync(templatePath, 'utf8');

    const nameParts = business.name.split(' ');
    const line1 = nameParts[0] || '';
    const line2 = nameParts.slice(1).join(' ') || '';

    html = html.replace(/{{BUSINESS_NAME}}/g, business.name);
    html = html.replace(/{{BUSINESS_LINE1}}/g, line1);
    html = html.replace(/{{BUSINESS_LINE2}}/g, line2);
    html = html.replace(/{{CITY}}/g, business.city);
    html = html.replace(/{{PHONE}}/g, business.phone);
    html = html.replace(/{{INSTAGRAM}}/g, business.instagram);

    const script = `<script>window.BUSINESS = ${JSON.stringify(business)};</script>`;
    html = html.replace('<head>', `<head>\n  ${script}`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

// POST /api/send-demo — send personalized demo email
router.post('/api/send-demo', webhookLimiter, async (req, res) => {
    const { email, business_name, city = '', phone = '', instagram = '' } = req.body || {};
    if (!email || !business_name) {
        return res.status(400).json({ error: 'email and business_name are required' });
    }

    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
    const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
    const fromName = process.env.FROM_NAME || process.env.AGENT_NAME || 'Alex';
    const serverBase = process.env.PUBLIC_URL || process.env.DEMO_BASE_URL || `http://localhost:${PORT}`;

    if (!smtpUser || !smtpPass) {
        return res.status(500).json({ error: 'SMTP credentials not set in .env' });
    }

    const demoUrl = `${serverBase}/demo?name=${encodeURIComponent(business_name)}&city=${encodeURIComponent(city)}&phone=${encodeURIComponent(phone)}&instagram=${encodeURIComponent(instagram)}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">
    <h1 style="color:#39ff14;font-size:1.5rem;margin-bottom:8px;">
      Here's your free demo, ${business_name}! 🚀
    </h1>
    <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
      Hey! It's Alex — we just spoke on the phone. I put together a custom demo
      website just for <strong>${business_name}</strong>. Click below to check it out:
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${demoUrl}"
         style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                font-size:1.1rem;text-decoration:none;">
        🌐 View Your Custom Demo
      </a>
    </div>
    <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
      This demo is personalized for <strong>${business_name}</strong> in <strong>${city || 'your area'}</strong>.
      If you like what you see and want to move forward, there's a button on the demo page to get started —
      totally no pressure, just have a look!
    </p>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;"/>
    <p style="color:#666;font-size:.82rem;">
      ${fromName} • SmokeShopGrowth<br/>
      Questions? Just reply to this email.
    </p>
  </div>
</body>
</html>`;

    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: false,
            auth: { user: smtpUser, pass: smtpPass },
        });

        await transporter.sendMail({
            from: `"${fromName}" <${smtpUser}>`,
            to: email,
            subject: `Your free custom website demo for ${business_name} 🎯`,
            html: htmlBody,
            text: `Hey! Here's your custom demo for ${business_name}: ${demoUrl}\n\n— ${fromName}, SmokeShopGrowth`,
        });

        console.log(`📧 Demo email sent to ${email} for ${business_name}`);
        res.json({ success: true, demoUrl });
    } catch (err) {
        console.error('Demo email error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/submit-lead — submit lead from demo pages
router.post('/api/submit-lead', webhookLimiter, async (req, res) => {
    const { contactName, email, phone, tier, businessName, city } = req.body || {};

    if (!email || !contactName) {
        return res.status(400).json({ error: 'Name and email are required' });
    }

    const submissionDate = new Date().toISOString();
    const csvLine = `"${submissionDate}","${contactName}","${email}","${phone}","${tier}","${businessName}","${city}"\n`;

    try {
        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

        const csvPath = path.join(dataDir, 'submissions.csv');
        const header = "Date,Contact Name,Email,Phone,Tier,Business,City\n";
        if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, header);

        fs.appendFileSync(csvPath, csvLine);
        console.log(`✅ Lead captured: ${email} for ${businessName}`);

        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || 'smtp.gmail.com',
                    port: parseInt(process.env.SMTP_PORT || '587', 10),
                    secure: false,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                });

                await transporter.sendMail({
                    from: `"Lead Alert" <${process.env.SMTP_USER}>`,
                    to: process.env.SMTP_USER,
                    subject: `🔥 NEW LEAD: ${businessName} (${tier})`,
                    text: `You have a new lead from the demo page!\n\nBusiness: ${businessName}\nContact: ${contactName}\nEmail: ${email}\nPhone: ${phone}\nTier: ${tier}\nCity: ${city}\n\nDate: ${submissionDate}`,
                });
            } catch (emailErr) {
                console.error('Failed to send notification email:', emailErr.message);
            }
        }

        res.json({ success: true, message: 'Lead captured successfully' });

        n8nService.notifyNewLead({
            contactName, email, phone, tier, businessName, city, submissionDate
        });
    } catch (err) {
        console.error('Lead capture error:', err.message);
        res.status(500).json({ error: 'Failed to save lead' });
    }
});

// POST /api/deploy-site — deploy / finalize site for delivery
router.post('/api/deploy-site', async (req, res) => {
    const { business, email, tier } = req.body;
    if (!business) return res.status(400).json({ error: 'Business name is required' });

    try {
        const deployRoot = path.join(__dirname, '..', 'deployments');
        if (!fs.existsSync(deployRoot)) fs.mkdirSync(deployRoot);

        const projectFolderName = `${business.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
        const projectPath = path.join(deployRoot, projectFolderName);
        fs.mkdirSync(projectPath);

        const { previewUrl } = await require('../src/node/generate-from-templates.js').generateForOne({
            TargetBusiness: business,
            TargetOutput: path.join(projectPath, 'index.html'),
            isProduction: true
        });

        res.json({
            success: true,
            message: `Site deployed for ${business}`,
            folder: projectFolderName,
            url: `/deployments/${projectFolderName}/index.html`
        });
    } catch (err) {
        console.error('Deployment error:', err);
        res.status(500).json({ error: 'Failed to deploy site' });
    }
});

// POST /api/template-submission — form submission from template pages
router.post('/api/template-submission', webhookLimiter, async (req, res) => {
    try {
        const { shopName, city, phone, email } = req.body;

        if (!shopName || !city || !phone || !email) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const submission = {
            id: makeJobId(),
            shopName: String(shopName).trim(),
            city: String(city).trim(),
            phone: String(phone).trim(),
            email: String(email).trim(),
            timestamp: new Date().toISOString()
        };

        templateSubmissions.push(submission);

        const submissionsFile = path.join(__dirname, '..', 'data', 'submissions.csv');
        const safeName = submission.shopName.replace(/"/g, '""');
        const safeCity = submission.city.replace(/"/g, '""');
        const csvLine = `"${submission.id}","${submission.timestamp}","${safeName}","${safeCity}","${submission.phone}","${submission.email}"\n`;

        const dataDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

        if (!fs.existsSync(submissionsFile)) {
            fs.writeFileSync(submissionsFile, 'id,timestamp,shopName,city,phone,email\n');
        }
        fs.appendFileSync(submissionsFile, csvLine);
        console.log(`✓ Form received & saved: ${submission.shopName} (${submission.city})`);

        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST || 'smtp.gmail.com',
                    port: parseInt(process.env.SMTP_PORT || '587', 10),
                    secure: false,
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                });

                const adminMail = transporter.sendMail({
                    from: `"${process.env.FROM_NAME || 'Lead Bot'}" <${process.env.SMTP_USER}>`,
                    to: process.env.SMTP_USER,
                    subject: `🔔 New Lead: ${submission.shopName}`,
                    text: `New submission from the demo page:\n\nName: ${submission.shopName}\nCity: ${submission.city}\nPhone: ${submission.phone}\nEmail: ${submission.email}\n\nTimestamp: ${submission.timestamp}`,
                });

                const leadMail = transporter.sendMail({
                    from: `"${process.env.FROM_NAME || 'SmokeShopGrowth'}" <${process.env.SMTP_USER}>`,
                    to: submission.email,
                    subject: `We've received your demo request! 🚀`,
                    html: `
                        <div style="font-family: sans-serif; color: #333; max-width: 600px;">
                            <h2>Hi ${submission.shopName},</h2>
                            <p>Thanks for requesting a demo! We've received your information and will be in touch shortly.</p>
                            <p><strong>Your Details:</strong><br>
                            City: ${submission.city}<br>
                            Phone: ${submission.phone}</p>
                            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                            <p style="color: #666; font-size: 0.9em;">Best,<br>The SmokeShopGrowth Team</p>
                        </div>
                    `
                });

                await Promise.all([adminMail, leadMail]);
                console.log(`📧 Notification emails sent (Admin & Lead).`);
            } catch (emailErr) {
                console.error('Failed to send notification emails:', emailErr.message);
            }
        }

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

// GET /api/template-submissions — list template submissions
router.get('/api/template-submissions', (req, res) => {
    res.json({
        count: templateSubmissions.length,
        submissions: templateSubmissions
    });
});

module.exports = router;
