import os
import json
import smtplib
from email.message import EmailMessage
from flask import Flask, request, jsonify
import stripe
from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials
from deploy_agent import deploy_shop_website
from delivery_agent import trigger_delivery_flow
from error_handler import log_failed_job
import subprocess
import threading
import uuid
from datetime import datetime


# Load environment variables
load_dotenv()

stripe.api_key = os.getenv('STRIPE_API_KEY')
endpoint_secret = os.getenv('STRIPE_WEBHOOK_SECRET')
GOOGLE_SHEET_URL = os.getenv('GOOGLE_SHEET_URL')
DEMO_BASE_URL = os.getenv('DEMO_BASE_URL', 'https://smoke-shop-premium-demo.netlify.app')

if not GOOGLE_SHEET_URL:
    print("WARNING: GOOGLE_SHEET_URL environment variable is missing. CRM updates will fail.")

# Email setup
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

app = Flask(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# CRM HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _get_sheets_client():
    """Return an authorized gspread client using service account credentials."""
    scopes = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds = Credentials.from_service_account_file('credentials.json', scopes=scopes)
    return gspread.authorize(creds)


def lookup_lead_from_crm(email, ref_id=None):
    """
    Look up a lead's full data from Google Sheets by email (or ref_id).
    Returns a dict with business_name, city, phone, address, maps_url, email, custom_domain
    or None if not found.
    """
    if not GOOGLE_SHEET_URL:
        print("[CRM] GOOGLE_SHEET_URL not set — cannot look up lead.")
        return None

    try:
        client = _get_sheets_client()
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1
        all_records = sheet.get_all_records()

        # Try to find by email first, then by ref_id
        for row in all_records:
            row_email = str(row.get('email', row.get('Email', ''))).strip().lower()
            row_ref = str(row.get('ref_id', row.get('client_reference_id', row.get('lead_id', '')))).strip()

            if (email and row_email == email.strip().lower()) or (ref_id and row_ref == ref_id):
                lead = {
                    "business_name": row.get('business_name', row.get('Business Name', row.get('title', 'Smoke Shop'))),
                    "city": row.get('city', row.get('City', '')),
                    "phone": row.get('phone', row.get('Phone', '')),
                    "address": row.get('address', row.get('Address', '')),
                    "email": email or row_email,
                    "maps_url": row.get('maps_url', row.get('google_maps_url', 'https://maps.google.com')),
                    "custom_domain": row.get('custom_domain', row.get('domain', None)) or None,
                    "hours": row.get('hours', row.get('Hours', 'Open Daily 9am - 10pm')),
                    "instagram": row.get('instagram', row.get('Instagram', '')),
                }
                print(f"[CRM] Found lead: {lead['business_name']} ({lead['city']})")
                return lead

        print(f"[CRM] Lead not found for email={email}, ref_id={ref_id}")
        return None

    except Exception as e:
        print(f"[CRM] Lookup failed: {e}")
        return None


def update_crm_payment(email, ref_id):
    """
    Find the lead in Google Sheets and update their status to 'WON - PAID'.
    """
    print(f"[CRM] Updating Google Sheets for {email}...")
    if not GOOGLE_SHEET_URL:
        print("[CRM] GOOGLE_SHEET_URL not set — skipping.")
        return

    try:
        client = _get_sheets_client()
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1

        try:
            cell = sheet.find(email)
            if cell:
                sheet.update_cell(cell.row, cell.col + 1, "WON - PAID")
                print(f"  [OK] Marked {email} as PAID in row {cell.row}!")
            else:
                print(f"  [Info] Email {email} not found. Appending as new paid lead.")
                sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])
        except Exception as e:
            if "not found" in str(e).lower():
                print(f"  [Info] Email {email} not found. Appending as new paid lead.")
                sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])
            else:
                raise e

    except Exception as e:
        print(f"  [ERROR] CRM Sync Failed: {e}")


def update_crm_deployed(email, deployed_url):
    """Update the CRM row with the live URL after deployment."""
    if not GOOGLE_SHEET_URL:
        return
    try:
        client = _get_sheets_client()
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1
        cell = sheet.find(email)
        if cell:
            # Try to find a "Live URL" or "Status" column after the email
            # We'll update the cell 2 columns to the right with the URL
            sheet.update_cell(cell.row, cell.col + 2, deployed_url)
            sheet.update_cell(cell.row, cell.col + 1, "DEPLOYED")
            print(f"  [CRM] Updated {email} with live URL: {deployed_url}")
    except Exception as e:
        print(f"  [CRM] Failed to update deployed URL: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# STRIPE CHECKOUT SESSION CREATOR
# ─────────────────────────────────────────────────────────────────────────────

def create_checkout_session(lead_email, business_name, city, tier="growth"):
    """
    Create a Stripe Checkout Session for a lead.
    Returns the checkout URL, or None on failure.
    
    tier: 'starter' | 'growth' | 'pro'
    """
    TIER_PRICES = {
        "starter": {"setup": 19900, "name": "Starter Website"},
        "growth":  {"setup": 29900, "name": "Growth Website"},
        "pro":     {"setup": 49900, "name": "Pro Website"},
    }
    
    selected = TIER_PRICES.get(tier, TIER_PRICES["growth"])
    
    try:
        session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            mode="payment",
            client_reference_id=lead_email,  # Used to look up the lead on payment
            customer_email=lead_email,
            metadata={
                "business_name": business_name,
                "city": city,
                "tier": tier,
            },
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {
                        "name": f"{selected['name']} — {business_name}",
                        "description": f"Custom smoke shop website for {business_name} in {city}",
                    },
                    "unit_amount": selected["setup"],
                },
                "quantity": 1,
            }],
            success_url=f"{DEMO_BASE_URL}/?shop={business_name}&city={city}&paid=true",
            cancel_url=f"{DEMO_BASE_URL}/?shop={business_name}&city={city}",
        )
        print(f"[STRIPE] Checkout session created: {session.url}")
        return session.url
    except Exception as e:
        print(f"[STRIPE] Failed to create checkout session: {e}")
        return None


# ─────────────────────────────────────────────────────────────────────────────
# DEMO EMAIL SENDER (unified with DEMO_BASE_URL)
# ─────────────────────────────────────────────────────────────────────────────

def send_demo_email(to_email, business_name, city):
    """Send follow-up email with demo link using DEMO_BASE_URL env var."""
    if not SMTP_USER or not SMTP_PASS:
        print("[-] SMTP credentials missing. Cannot send email.")
        return False

    from urllib.parse import quote
    demo_url = f"{DEMO_BASE_URL}/?shop={quote(business_name)}&city={quote(city)}"

    msg = EmailMessage()
    msg['Subject'] = f"Your free demo site — {business_name}"
    msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg['To'] = to_email

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8" /></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
      <div style="max-width:580px;margin:0 auto;padding:40px 24px;">

        <h1 style="color:#00f0ff;font-size:1.6rem;margin-bottom:8px;">
          Hey {business_name} 👋
        </h1>

        <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
          We just spoke — I'm <strong>{SENDER_NAME}</strong>, the local web developer.
          As promised, here's the free demo site I built for your smoke shop in <strong>{city}</strong>:
        </p>

        <div style="text-align:center;margin:32px 0;">
          <a href="{demo_url}"
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
          {SENDER_NAME} • Local Web Developer<br />
          This demo was created specifically for {business_name}
        </p>
      </div>
    </body>
    </html>
    """

    msg.set_content(f"Hey {business_name},\n\nHere's your free demo site: {demo_url}\n\n— {SENDER_NAME}")
    msg.add_alternative(html_content, subtype='html')

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print(f"[+] Follow-up email sent successfully to {to_email}")
        return True
    except Exception as e:
        print(f"[-] Failed to send email: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# DEPLOYMENT TRIGGER (uses real customer data)
# ─────────────────────────────────────────────────────────────────────────────

def trigger_site_deployment(email, ref_id, stripe_metadata=None):
    """
    Look up the real lead from CRM, then deploy their personalized site.
    Falls back to Stripe metadata if CRM lookup fails.
    """
    print(f"[DEPLOY] Triggering automated site build for {email}...")

    # 1. Look up real lead data from CRM
    lead_data = lookup_lead_from_crm(email, ref_id)

    # 2. Fallback: use Stripe checkout metadata if CRM lookup failed
    if not lead_data and stripe_metadata:
        print(f"[DEPLOY] CRM lookup failed — using Stripe metadata as fallback.")
        lead_data = {
            "business_name": stripe_metadata.get("business_name", "Smoke Shop"),
            "city": stripe_metadata.get("city", "Houston"),
            "phone": "",
            "address": "",
            "email": email,
            "maps_url": "https://maps.google.com",
            "custom_domain": None,
        }

    # 3. If we still have nothing, fail gracefully
    if not lead_data:
        error_msg = f"Cannot deploy: no lead data found for email={email}, ref_id={ref_id}"
        print(f"[ERROR] {error_msg}")
        log_failed_job('deploy', {"email": email, "ref_id": ref_id}, error_msg)
        return

    # Ensure email is set on lead_data for delivery
    lead_data['email'] = lead_data.get('email') or email

    try:
        deployed_url = deploy_shop_website(lead_data)

        if deployed_url:
            print(f"\n  [*] Site deployed: {deployed_url}")

            # Update CRM with live URL
            update_crm_deployed(email, deployed_url)

            # Trigger delivery flow (welcome email + upsell enrollment)
            try:
                trigger_delivery_flow(lead_data, deployed_url)
            except Exception as e:
                log_failed_job('delivery', {"lead_data": lead_data, "live_url": deployed_url}, str(e))
        else:
            print(f"\n  [ERROR] Build returned None. Sending to retry queue.")
            log_failed_job('deploy', lead_data, "Deployment script returned None")

    except Exception as e:
        print(f"\n  [ERROR] Fatal error during deployment flow: {e}")
        log_failed_job('deploy', lead_data, str(e))


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health():
    return jsonify(status="ok"), 200


@app.route('/webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe checkout.session.completed events."""
    payload = request.data
    sig_header = request.headers.get('STRIPE_SIGNATURE')

    if not endpoint_secret:
        print("Webhook error: No STRIPE_WEBHOOK_SECRET configured.")
        return 'No webhook secret configured.', 400

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        print("Webhook error: Invalid payload")
        return 'Invalid payload', 400
    except stripe.SignatureVerificationError:
        print("Webhook error: Invalid signature")
        return 'Invalid signature', 400

    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']

        customer_email = session.get('customer_details', {}).get('email', '') or session.get('customer_email', '')
        amount_paid = session.get('amount_total', 0) / 100.0
        client_reference_id = session.get('client_reference_id')
        stripe_metadata = session.get('metadata', {})

        print(f"\n[STRIPE] ✅ Payment Received!")
        print(f"  - Customer: {customer_email}")
        print(f"  - Amount: ${amount_paid:.2f}")
        print(f"  - Ref ID: {client_reference_id}")
        print(f"  - Metadata: {stripe_metadata}")

        # Stage 1: Update CRM → "WON - PAID"
        update_crm_payment(customer_email, client_reference_id)

        # Stage 2: Deploy site using REAL customer data
        trigger_site_deployment(customer_email, client_reference_id, stripe_metadata)

    return jsonify(success=True)


@app.route('/create-checkout', methods=['POST'])
def create_checkout():
    """
    Create a Stripe Checkout Session for a specific lead.
    
    POST body:
    {
        "email": "owner@shop.com",
        "business_name": "Cloud 9 Smoke Shop",
        "city": "Houston",
        "tier": "growth"  // optional: starter | growth | pro
    }
    
    Returns: { "checkout_url": "https://checkout.stripe.com/..." }
    """
    data = request.json or {}
    email = data.get('email', '').strip()
    business_name = data.get('business_name', '').strip()
    city = data.get('city', '').strip()
    tier = data.get('tier', 'growth').strip().lower()

    if not email or not business_name:
        return jsonify(error="email and business_name are required"), 400

    if tier not in ('starter', 'growth', 'pro'):
        tier = 'growth'

    url = create_checkout_session(email, business_name, city, tier)
    if url:
        return jsonify(checkout_url=url)
    else:
        return jsonify(error="Failed to create checkout session"), 500


@app.route('/vapi/webhook', methods=['POST'])
def vapi_webhook():
    """Handle Vapi end-of-call reports — send demo email if email was collected."""
    data = request.json
    event_type = data.get('message', {}).get('type') or data.get('type')

    if event_type == 'end-of-call-report':
        analysis = data.get('message', {}).get('analysis') or {}
        structured = analysis.get('structuredData') or {}
        call = data.get('message', {}).get('call') or {}
        metadata = call.get('metadata') or {}

        business_name = metadata.get('business_name') or structured.get('business_name', 'Shop Owner')
        city = metadata.get('city', 'your city')
        email = structured.get('email')

        contact_value = structured.get('contact_value')
        if not email and contact_value and '@' in contact_value:
            email = contact_value

        print(f"\n[Webhook] Call ended with {business_name}.", flush=True)
        print(f"[Webhook] Outcome: {structured.get('outcome')}", flush=True)

        if email:
            print(f"[Webhook] Email collected: {email} — sending demo...", flush=True)
            send_demo_email(email, business_name, city)
        else:
            print("[Webhook] No email collected during the call.", flush=True)

    return jsonify({"status": "received"}), 200



# ─────────────────────────────────────────────────────────────────────────────
# IN-MEMORY STORES (add these near the top of webhook.py, after app = Flask(__name__))
# ─────────────────────────────────────────────────────────────────────────────

import subprocess
import threading
import uuid
from datetime import datetime

# In-memory job store for pipeline runs
pipeline_jobs = {}  # job_id → { status, city, bizType, started_at, finished_at, error }

# In-memory store for template/form submissions
template_submissions = []


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE: Start Pipeline Job (for n8n Workflow 1)
# ─────────────────────────────────────────────────────────────────────────────

def run_pipeline_async(job_id, city, biz_type, max_results):
    """Run the scraper pipeline in a background thread."""
    try:
        pipeline_jobs[job_id]['status'] = 'running'

        # Run scraper.py as a subprocess
        result = subprocess.run(
            ['python', 'src/python/scraper.py',
             '--city', city,
             '--type', biz_type,
             '--max-results', str(max_results),
             '--headless'],
            capture_output=True, text=True, timeout=600
        )

        if result.returncode == 0:
            pipeline_jobs[job_id]['status'] = 'done'
            pipeline_jobs[job_id]['output'] = result.stdout[-2000:]  # Last 2KB
        else:
            pipeline_jobs[job_id]['status'] = 'failed'
            pipeline_jobs[job_id]['error'] = result.stderr[-1000:]

    except subprocess.TimeoutExpired:
        pipeline_jobs[job_id]['status'] = 'failed'
        pipeline_jobs[job_id]['error'] = 'Pipeline timed out after 10 minutes'
    except Exception as e:
        pipeline_jobs[job_id]['status'] = 'failed'
        pipeline_jobs[job_id]['error'] = str(e)
    finally:
        pipeline_jobs[job_id]['finished_at'] = datetime.utcnow().isoformat()


@app.route('/api/run', methods=['POST'])
def api_run_pipeline():
    """Trigger the lead generation pipeline. Called by n8n Workflow 1."""
    data = request.json or {}
    city = data.get('city', '').strip()
    biz_type = data.get('bizType', 'smoke shop').strip()
    max_results = min(int(data.get('maxResults', 100)), 500)

    if not city:
        return jsonify(error='city is required'), 400

    job_id = str(uuid.uuid4())[:8]
    pipeline_jobs[job_id] = {
        'status': 'queued',
        'city': city,
        'bizType': biz_type,
        'started_at': datetime.utcnow().isoformat(),
        'finished_at': None,
        'error': None,
        'output': None,
    }

    # Run in background thread
    thread = threading.Thread(
        target=run_pipeline_async,
        args=(job_id, city, biz_type, max_results),
        daemon=True
    )
    thread.start()

    print(f"[PIPELINE] Started job {job_id}: {city} / {biz_type}")
    return jsonify(status='started', jobId=job_id, message='Pipeline triggered'), 200


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE: List Pipeline Jobs (for n8n Workflow 1 status checking)
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/jobs', methods=['GET'])
def api_list_jobs():
    """List all pipeline jobs and their status."""
    jobs_list = []
    for job_id, job in pipeline_jobs.items():
        jobs_list.append({
            'id': job_id,
            'status': job['status'],
            'city': job['city'],
            'bizType': job['bizType'],
            'started_at': job['started_at'],
            'finished_at': job['finished_at'],
            'error': job.get('error'),
        })
    return jsonify(jobs_list), 200


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE: Store Template Submission (for n8n Workflow 4)
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/template-submission', methods=['POST'])
def api_template_submission():
    """Store an inbound lead/form submission. Called by n8n Workflow 4."""
    data = request.json or {}
    shop_name = data.get('shopName', '').strip()
    city = data.get('city', '').strip()
    phone = data.get('phone', '').strip()
    email = data.get('email', '').strip()

    if not shop_name or not city or not phone or not email:
        return jsonify(error='Missing required fields: shopName, city, phone, email'), 400

    submission = {
        'id': str(uuid.uuid4())[:8],
        'shopName': shop_name,
        'city': city,
        'phone': phone,
        'email': email,
        'source': data.get('source', 'n8n'),
        'timestamp': datetime.utcnow().isoformat(),
    }
    template_submissions.append(submission)
    print(f"[FORM] New submission: {shop_name} ({city}) — {email}")
    return jsonify(success=True, message='Submission received', submissionId=submission['id']), 200


# ─────────────────────────────────────────────────────────────────────────────
# ROUTE: List Template Submissions (for n8n Workflow 5 - Upsell Drip)
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/template-submissions', methods=['GET'])
def api_list_template_submissions():
    """List all stored form submissions. Called by n8n Workflow 5."""
    return jsonify(count=len(template_submissions), submissions=template_submissions), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 4242))
    is_debug = os.environ.get('FLASK_DEBUG', '').lower() == 'true'
    print(f"Starting Unified Webhook Server on port {port}...")
    print(f"  Stripe webhook: POST /webhook")
    print(f"  Checkout creator: POST /create-checkout")
    print(f"  Vapi webhook: POST /vapi/webhook")
    print(f"  Health: GET /health")
    if not stripe.api_key:
        print("  ⚠️  STRIPE_API_KEY not set!")
    if not endpoint_secret or endpoint_secret == 'whsec_...':
        print("  ⚠️  STRIPE_WEBHOOK_SECRET not configured!")
    app.run(host='0.0.0.0', port=port, debug=is_debug)
