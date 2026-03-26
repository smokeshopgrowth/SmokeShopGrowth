'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'leads.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ──────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    place_id       TEXT PRIMARY KEY,
    business_name  TEXT NOT NULL,
    address        TEXT DEFAULT '',
    phone          TEXT DEFAULT '',
    email          TEXT DEFAULT '',
    website        TEXT DEFAULT '',
    rating         REAL DEFAULT 0,
    review_count   INTEGER DEFAULT 0,
    google_maps_url TEXT DEFAULT '',
    image_url      TEXT DEFAULT '',
    city_slug      TEXT DEFAULT '',
    score          INTEGER DEFAULT 0,
    issues         TEXT DEFAULT '',
    status         TEXT DEFAULT 'scraped'
                   CHECK(status IN ('scraped','audited','contacted','called','paid','rejected')),
    audit_summary  TEXT DEFAULT '',
    ssl            TEXT DEFAULT '',
    load_time      TEXT DEFAULT '',
    mobile_friendly TEXT DEFAULT '',
    website_status TEXT DEFAULT '',
    instagram      TEXT DEFAULT '',
    facebook       TEXT DEFAULT '',
    has_website    TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    city       TEXT NOT NULL,
    biz_type   TEXT DEFAULT 'smoke shop',
    status     TEXT DEFAULT 'running',
    step       INTEGER DEFAULT 0,
    config     TEXT DEFAULT '{}',
    files      TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL,
    business_name TEXT DEFAULT '',
    city          TEXT DEFAULT '',
    tier          TEXT DEFAULT 'starter',
    amount        REAL DEFAULT 0,
    stripe_session TEXT DEFAULT '',
    paid_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS call_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    place_id      TEXT,
    business_name TEXT DEFAULT '',
    phone         TEXT DEFAULT '',
    city          TEXT DEFAULT '',
    call_id       TEXT DEFAULT '',
    duration_secs INTEGER DEFAULT 0,
    outcome       TEXT DEFAULT '',
    summary       TEXT DEFAULT '',
    email_collected TEXT DEFAULT '',
    called_at     TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (place_id) REFERENCES leads(place_id)
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_city ON leads(city_slug);
  CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(score DESC);

  CREATE TABLE IF NOT EXISTS email_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft','scheduled','sending','sent','cancelled')),
    scheduled_at TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS campaign_recipients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    lead_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','opened','clicked','bounced','failed')),
    sent_at TEXT,
    opened_at TEXT,
    clicked_at TEXT,
    error_message TEXT DEFAULT '',
    FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE,
    FOREIGN KEY (lead_id) REFERENCES leads(place_id)
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_status ON email_campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_recipients_campaign ON campaign_recipients(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_recipients_lead ON campaign_recipients(lead_id);
  CREATE INDEX IF NOT EXISTS idx_call_log_outcome ON call_log(outcome);
  CREATE INDEX IF NOT EXISTS idx_payments_city ON payments(city);
`);

// ── Prepared statements ─────────────────────────

const upsertLead = db.prepare(`
  INSERT INTO leads (place_id, business_name, address, phone, email, website,
                     rating, review_count, google_maps_url, image_url, city_slug,
                     score, issues, status, audit_summary, ssl, load_time,
                     mobile_friendly, website_status, instagram, facebook, has_website)
  VALUES (@place_id, @business_name, @address, @phone, @email, @website,
          @rating, @review_count, @google_maps_url, @image_url, @city_slug,
          @score, @issues, @status, @audit_summary, @ssl, @load_time,
          @mobile_friendly, @website_status, @instagram, @facebook, @has_website)
  ON CONFLICT(place_id) DO UPDATE SET
    business_name = excluded.business_name,
    address = excluded.address,
    phone = CASE WHEN excluded.phone != '' THEN excluded.phone ELSE leads.phone END,
    email = CASE WHEN excluded.email != '' THEN excluded.email ELSE leads.email END,
    website = CASE WHEN excluded.website != '' THEN excluded.website ELSE leads.website END,
    rating = excluded.rating,
    review_count = excluded.review_count,
    score = excluded.score,
    issues = excluded.issues,
    status = excluded.status,
    audit_summary = CASE WHEN excluded.audit_summary != '' THEN excluded.audit_summary ELSE leads.audit_summary END,
    ssl = CASE WHEN excluded.ssl != '' THEN excluded.ssl ELSE leads.ssl END,
    load_time = CASE WHEN excluded.load_time != '' THEN excluded.load_time ELSE leads.load_time END,
    mobile_friendly = CASE WHEN excluded.mobile_friendly != '' THEN excluded.mobile_friendly ELSE leads.mobile_friendly END,
    website_status = CASE WHEN excluded.website_status != '' THEN excluded.website_status ELSE leads.website_status END,
    instagram = CASE WHEN excluded.instagram != '' THEN excluded.instagram ELSE leads.instagram END,
    facebook = CASE WHEN excluded.facebook != '' THEN excluded.facebook ELSE leads.facebook END,
    has_website = CASE WHEN excluded.has_website != '' THEN excluded.has_website ELSE leads.has_website END,
    updated_at = datetime('now')
`);

const upsertLeadMany = db.transaction((leads) => {
    for (const lead of leads) upsertLead.run(lead);
});

const getLeadByPlaceId = db.prepare('SELECT * FROM leads WHERE place_id = ?');
const getLeadsByCity = db.prepare('SELECT * FROM leads WHERE city_slug = ? ORDER BY score DESC');
const getLeadsByStatus = db.prepare('SELECT * FROM leads WHERE status = ? ORDER BY score DESC');
const getLeadsByCityAndStatus = db.prepare('SELECT * FROM leads WHERE city_slug = ? AND status = ? ORDER BY score DESC');
const getAllLeads = db.prepare('SELECT * FROM leads ORDER BY score DESC');

// Paginated queries
const getLeadsByCityPaginated = db.prepare(`
  SELECT * FROM leads 
  WHERE city_slug = ? 
  ORDER BY score DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsByCityCount = db.prepare('SELECT COUNT(*) as total FROM leads WHERE city_slug = ?');
const getLeadsByStatusPaginated = db.prepare(`
  SELECT * FROM leads 
  WHERE status = ? 
  ORDER BY score DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsByStatusCount = db.prepare('SELECT COUNT(*) as total FROM leads WHERE status = ?');

const getLeadsByCityAndStatusPaginated = db.prepare(`
  SELECT * FROM leads 
  WHERE city_slug = ? AND status = ? 
  ORDER BY score DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsByCityAndStatusCount = db.prepare('SELECT COUNT(*) as total FROM leads WHERE city_slug = ? AND status = ?');

const updateLeadStatus = db.prepare('UPDATE leads SET status = ?, updated_at = datetime(\'now\') WHERE place_id = ?');
const updateLeadEmail = db.prepare('UPDATE leads SET email = ?, updated_at = datetime(\'now\') WHERE place_id = ?');

// Jobs
const insertJob = db.prepare(`
  INSERT INTO jobs (id, city, biz_type, status, step, config, files)
  VALUES (@id, @city, @biz_type, @status, @step, @config, @files)
`);
const updateJob = db.prepare(`
  UPDATE jobs SET status = @status, step = @step, files = @files, updated_at = datetime('now')
  WHERE id = @id
`);
const getJob = db.prepare('SELECT * FROM jobs WHERE id = ?');
const getJobs = db.prepare('SELECT * FROM jobs ORDER BY created_at DESC');

// Payments
const insertPayment = db.prepare(`
  INSERT INTO payments (email, business_name, city, tier, amount, stripe_session)
  VALUES (@email, @business_name, @city, @tier, @amount, @stripe_session)
`);

// Call log
const insertCallLog = db.prepare(`
  INSERT INTO call_log (place_id, business_name, phone, city, call_id, duration_secs, outcome, summary, email_collected)
  VALUES (@place_id, @business_name, @phone, @city, @call_id, @duration_secs, @outcome, @summary, @email_collected)
`);

// ── Extended Lead queries for CRM ───────────────

const getLeadsPaginated = db.prepare(`
  SELECT * FROM leads 
  ORDER BY created_at DESC 
  LIMIT ? OFFSET ?
`);

const getLeadsCount = db.prepare('SELECT COUNT(*) as total FROM leads');

const updateLead = db.prepare(`
  UPDATE leads SET 
    business_name = @business_name,
    email = @email,
    phone = @phone,
    status = @status,
    score = @score,
    updated_at = datetime('now')
  WHERE place_id = @place_id
`);

const deleteLead = db.prepare('DELETE FROM leads WHERE place_id = ?');

const searchLeads = db.prepare(`
  SELECT * FROM leads 
  WHERE business_name LIKE ? OR email LIKE ? OR city_slug LIKE ?
  ORDER BY score DESC 
  LIMIT 50
`);

// ── Email Campaign queries ──────────────────────

const getAllCampaigns = db.prepare('SELECT * FROM email_campaigns ORDER BY created_at DESC');

const getCampaign = db.prepare('SELECT * FROM email_campaigns WHERE id = ?');

const insertCampaign = db.prepare(`
  INSERT INTO email_campaigns (name, subject, body, status, scheduled_at)
  VALUES (@name, @subject, @body, @status, @scheduled_at)
`);

const updateCampaign = db.prepare(`
  UPDATE email_campaigns SET 
    name = @name,
    subject = @subject,
    body = @body,
    status = @status,
    scheduled_at = @scheduled_at,
    updated_at = datetime('now')
  WHERE id = @id
`);

const updateCampaignStatus = db.prepare(`
  UPDATE email_campaigns SET status = ?, sent_at = ?, updated_at = datetime('now') WHERE id = ?
`);

const deleteCampaign = db.prepare('DELETE FROM email_campaigns WHERE id = ?');

const getCampaignRecipients = db.prepare(`
  SELECT cr.*, l.business_name, l.email, l.city_slug 
  FROM campaign_recipients cr
  JOIN leads l ON cr.lead_id = l.place_id
  WHERE cr.campaign_id = ?
  ORDER BY cr.id
`);

const insertCampaignRecipient = db.prepare(`
  INSERT INTO campaign_recipients (campaign_id, lead_id, status)
  VALUES (@campaign_id, @lead_id, @status)
`);

const insertCampaignRecipientMany = db.transaction((recipients) => {
  for (const r of recipients) insertCampaignRecipient.run(r);
});

const updateRecipientStatus = db.prepare(`
  UPDATE campaign_recipients SET status = ?, sent_at = ?, opened_at = ?, clicked_at = ? WHERE id = ?
`);

const getCampaignStats = db.prepare(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN status = 'sent' OR status = 'opened' OR status = 'clicked' THEN 1 ELSE 0 END) as sent,
    SUM(CASE WHEN status = 'opened' OR status = 'clicked' THEN 1 ELSE 0 END) as opened,
    SUM(CASE WHEN status = 'clicked' THEN 1 ELSE 0 END) as clicked,
    SUM(CASE WHEN status = 'bounced' OR status = 'failed' THEN 1 ELSE 0 END) as failed
  FROM campaign_recipients WHERE campaign_id = ?
`);

// ── Call Log queries ────────────────────────────

const getAllCalls = db.prepare('SELECT * FROM call_log ORDER BY called_at DESC');

const getCallsPaginated = db.prepare(`
  SELECT * FROM call_log 
  ORDER BY called_at DESC 
  LIMIT ? OFFSET ?
`);

const getCallsCount = db.prepare('SELECT COUNT(*) as total FROM call_log');

const getCall = db.prepare('SELECT * FROM call_log WHERE id = ?');

const updateCall = db.prepare(`
  UPDATE call_log SET outcome = ?, summary = ? WHERE id = ?
`);

const getCallsByOutcome = db.prepare(`
  SELECT * FROM call_log WHERE outcome = ? ORDER BY called_at DESC
`);

// ── Payment queries ─────────────────────────────

const getAllPayments = db.prepare('SELECT * FROM payments ORDER BY paid_at DESC');

const getPaymentsPaginated = db.prepare(`
  SELECT * FROM payments 
  ORDER BY paid_at DESC 
  LIMIT ? OFFSET ?
`);

const getPaymentsCount = db.prepare('SELECT COUNT(*) as total FROM payments');

const getPaymentStats = db.prepare(`
  SELECT 
    SUM(amount) as total_revenue,
    COUNT(*) as total_payments,
    AVG(amount) as avg_order_value
  FROM payments
`);

const getPaymentStatsByMonth = db.prepare(`
  SELECT 
    strftime('%Y-%m', paid_at) as month,
    SUM(amount) as revenue,
    COUNT(*) as count
  FROM payments 
  GROUP BY strftime('%Y-%m', paid_at)
  ORDER BY month DESC
  LIMIT 12
`);

const getPaymentStatsByCity = db.prepare(`
  SELECT city, SUM(amount) as revenue, COUNT(*) as count
  FROM payments 
  GROUP BY city
  ORDER BY revenue DESC
`);

const getPaymentStatsByTier = db.prepare(`
  SELECT tier, SUM(amount) as revenue, COUNT(*) as count
  FROM payments 
  GROUP BY tier
  ORDER BY revenue DESC
`);

const getRecentPayments = db.prepare(`
  SELECT * FROM payments ORDER BY paid_at DESC LIMIT ?
`);

// ── Dashboard Stats ─────────────────────────────

const getDashboardStats = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM leads) as total_leads,
    (SELECT COUNT(*) FROM leads WHERE created_at >= datetime('now', '-7 days')) as leads_this_week,
    (SELECT COUNT(*) FROM email_campaigns WHERE status != 'draft') as active_campaigns,
    (SELECT COUNT(*) FROM call_log WHERE date(called_at) = date('now')) as calls_today,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE strftime('%Y-%m', paid_at) = strftime('%Y-%m', 'now')) as revenue_this_month
`);

module.exports = {
    db,
    // Leads
    upsertLead,
    upsertLeadMany,
    getLeadByPlaceId,
    getLeadsByCity,
    getLeadsByStatus,
    getLeadsByCityAndStatus,
    getAllLeads,
    getLeadsByCityPaginated,
    getLeadsByCityCount,
    getLeadsByStatusPaginated,
    getLeadsByStatusCount,
    getLeadsByCityAndStatusPaginated,
    getLeadsByCityAndStatusCount,
    getLeadsPaginated,
    getLeadsCount,
    updateLeadStatus,
    updateLeadEmail,
    updateLead,
    deleteLead,
    searchLeads,
    // Jobs
    insertJob,
    updateJob,
    getJob,
    getJobs,
    // Payments
    insertPayment,
    getAllPayments,
    getPaymentsPaginated,
    getPaymentsCount,
    getPaymentStats,
    getPaymentStatsByMonth,
    getPaymentStatsByCity,
    getPaymentStatsByTier,
    getRecentPayments,
    // Call Log
    insertCallLog,
    getAllCalls,
    getCallsPaginated,
    getCallsCount,
    getCall,
    updateCall,
    getCallsByOutcome,
    // Email Campaigns
    getAllCampaigns,
    getCampaign,
    insertCampaign,
    updateCampaign,
    updateCampaignStatus,
    deleteCampaign,
    getCampaignRecipients,
    insertCampaignRecipient,
    insertCampaignRecipientMany,
    updateRecipientStatus,
    getCampaignStats,
    // Dashboard
    getDashboardStats,
};
