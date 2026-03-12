/**
 * follow_up.js
 * Auto-sends a personalized demo link to interested leads via email or SMS.
 *
 * Called automatically by vapi_webhook.js when outcome = "interested"
 * or any outcome where contact info was collected.
 */
const nodemailer = require("nodemailer");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

// ── Read CSV to find lead details ─────────────────────────────────────────────
async function findLeadDetails(businessName, city) {
    if (!city || !businessName) return {};
    const citySlug = city.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const dataDir = path.join(__dirname, 'data', citySlug);
    const auditedCsv = path.join(dataDir, 'audited_leads.csv');
    const leadsCsv = path.join(dataDir, 'leads.csv');

    const fileToRead = fs.existsSync(auditedCsv) ? auditedCsv : (fs.existsSync(leadsCsv) ? leadsCsv : null);
    if (!fileToRead) return {};

    return new Promise((resolve) => {
        let found = null;
        fs.createReadStream(fileToRead)
            .pipe(csv())
            .on('data', (row) => {
                // Approximate match by exact string comparison
                if (!found && row.business_name && row.business_name.toLowerCase() === businessName.toLowerCase()) {
                    found = {
                        address: row.address || '',
                        phone: row.phone || '',
                        rating: row.rating || '',
                        reviews: row.review_count || '',
                        img: row.image_url || ''
                    };
                }
            })
            .on('end', () => resolve(found || {}))
            .on('error', () => resolve({}));
    });
}

// ── Build the personalized demo URL ──────────────────────────────────────────
function buildDemoUrl(businessName, city, extraDetails = {}) {
    const base = process.env.DEMO_BASE_URL || "https://smoke-shop-premium-demo.netlify.app";

    // Filter out empty extra details
    const cleanDetails = Object.fromEntries(
        Object.entries(extraDetails).filter(([_, v]) => v != null && v !== '')
    );

    const params = new URLSearchParams({
        shop: businessName,
        city: city,
        ...cleanDetails
    });

    // Static deploys (Netlify/Vercel) serve from root; dynamic servers use /demo route
    const isStaticDeploy = base.includes("netlify.app") || base.includes("vercel.app");
    const route = isStaticDeploy ? "" : "/demo";

    return `${base}${route}?${params.toString()}`;
}

// ── Email template ────────────────────────────────────────────────────────────
function buildEmailHtml(businessName, city, demoUrl, senderName) {
    return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">

    <h1 style="color:#00f0ff;font-size:1.6rem;margin-bottom:8px;">
      Hey ${businessName} 👋
    </h1>

    <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
      We just spoke — I'm <strong>${senderName}</strong>, the local web developer.
      As promised, here's the free demo site I built for your smoke shop in <strong>${city}</strong>:
    </p>

    <div style="text-align:center;margin:32px 0;">
      <a href="${demoUrl}"
         style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                font-size:1.1rem;text-decoration:none;">
        👁 View Your Free Demo
      </a>
    </div>

    <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
      This shows what a clean, mobile-friendly website could look like for your shop.
      No commitment — just a free look. Reply here or call me if you want to move forward.
    </p>

    <hr style="border:none;border-top:1px solid #222;margin:32px 0;" />

    <p style="color:#666;font-size:.82rem;">
      ${senderName} • Local Web Developer<br />
      This demo was created specifically for ${businessName}
    </p>
  </div>
</body>
</html>`;
}

// ── SMS body ──────────────────────────────────────────────────────────────────
function buildSmsBody(businessName, city, demoUrl, senderName) {
    return `Hey! This is ${senderName} — we just spoke about your website. Here's the free demo I made for ${businessName}: ${demoUrl}`;
}

// ── Send email via SMTP ───────────────────────────────────────────────────────
async function sendEmail(toEmail, businessName, city, demoUrl) {
    const {
        SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_EMAIL, FROM_NAME, AGENT_NAME,
    } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.log("⚠️  SMTP not configured — skipping email follow-up");
        return false;
    }

    const senderName = AGENT_NAME || FROM_NAME || "Alex";

    const transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: parseInt(SMTP_PORT || "587"),
        secure: parseInt(SMTP_PORT || "587") === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    await transporter.sendMail({
        from: `"${senderName}" <${FROM_EMAIL || SMTP_USER}>`,
        to: toEmail,
        subject: `Your free demo site — ${businessName}`,
        html: buildEmailHtml(businessName, city, demoUrl, senderName),
        text: `Hey ${businessName},\n\nHere's your free demo site: ${demoUrl}\n\n— ${senderName}`,
    });

    console.log(`📧 Follow-up email sent to ${toEmail}`);
    return true;
}

// ── Send SMS via Twilio ───────────────────────────────────────────────────────
async function sendSms(toPhone, businessName, city, demoUrl) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, AGENT_NAME } = process.env;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
        console.log("⚠️  Twilio not configured — skipping SMS follow-up");
        return false;
    }

    const senderName = AGENT_NAME || "Alex";
    const body = buildSmsBody(businessName, city, demoUrl, senderName);

    // Normalize number
    const digits = toPhone.replace(/\D/g, "");
    const normalized = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

    await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        new URLSearchParams({ To: normalized, From: TWILIO_FROM_NUMBER, Body: body }),
        { auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN } }
    );

    console.log(`📱 Follow-up SMS sent to ${normalized}`);
    return true;
}

// ── Main export ───────────────────────────────────────────────────────────────
/**
 * sendFollowUp(payload)
 * Pass the call payload from vapi_webhook.js.
 * Automatically picks email or SMS based on how the contact was collected.
 */
async function sendFollowUp(payload) {
    const { business_name, city, contact_method, contact_value, outcome } = payload;

    const interestedOutcomes = ["interested", "already_has_site_interested"];
    if (!interestedOutcomes.includes(outcome)) return;
    if (!contact_value) {
        console.log(`ℹ️  No contact info collected for ${business_name} — skipping follow-up`);
        return;
    }

    const extraDetails = await findLeadDetails(business_name, city);
    const demoUrl = buildDemoUrl(business_name, city, extraDetails);

    console.log(`🚀 Sending follow-up to ${business_name} via ${contact_method}: ${contact_value}`);
    console.log(`   Demo URL: ${demoUrl}`);

    if (contact_method === "email") {
        await sendEmail(contact_value, business_name, city, demoUrl);
    } else if (contact_method === "text") {
        await sendSms(contact_value, business_name, city, demoUrl);
    } else {
        // If method wasn't captured but we have something, try to guess
        const looksLikeEmail = contact_value.includes("@");
        if (looksLikeEmail) {
            await sendEmail(contact_value, business_name, city, demoUrl);
        } else {
            await sendSms(contact_value, business_name, city, demoUrl);
        }
    }
}

module.exports = { sendFollowUp, buildDemoUrl };
