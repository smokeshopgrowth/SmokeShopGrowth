import os
import smtplib
import sys
from email.message import EmailMessage

# ---------------------------------------------------------------------------
# Path fix — make src/agents/ importable from src/python/
# ---------------------------------------------------------------------------
_agents_dir = os.path.join(os.path.dirname(__file__), "..", "agents")
if os.path.isdir(_agents_dir):
    sys.path.insert(0, os.path.abspath(_agents_dir))
# ---------------------------------------------------------------------------

import stripe  # noqa: E402
from config import (  # noqa: E402
    DEMO_BASE_URL,
    SENDER_NAME,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_USER,
    STRIPE_API_KEY,
    STRIPE_WEBHOOK_SECRET,
)
from crm import lookup_lead_from_crm, update_crm_deployed, update_crm_payment  # noqa: E402
from delivery_agent import trigger_delivery_flow  # noqa: E402
from deploy_agent import deploy_shop_website  # noqa: E402
from error_handler import log_failed_job  # noqa: E402
from flask import Flask, jsonify, request  # noqa: E402
from logger import get_logger  # noqa: E402

log = get_logger(__name__)


stripe.api_key = STRIPE_API_KEY
endpoint_secret = STRIPE_WEBHOOK_SECRET

app = Flask(__name__)


# ────────────────────────────────────────────────────────────────────────────────
# STRIPE CHECKOUT SESSION CREATOR
# ────────────────────────────────────────────────────────────────────────────────

def create_checkout_session(lead_email, business_name, city, tier="growth"):
    """
    Create a Stripe Checkout Session for a lead.
    Returns the checkout URL, or None on failure.

    tier: 'starter' | 'growth' | 'pro'
    """
    TIER_PRICES = {
        "starter": {"setup": 9900, "name": "Starter Website"},
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
                        "name": f"{selected['name']} \u2014 {business_name}",
                        "description": f"Custom smoke shop website for {business_name} in {city}",
                    },
                    "unit_amount": selected["setup"],
                },
                "quantity": 1,
            }],
            success_url=f"{DEMO_BASE_URL}/?shop={business_name}&city={city}&paid=true",
            cancel_url=f"{DEMO_BASE_URL}/?shop={business_name}&city={city}",
        )
        log.info(f"Created Stripe checkout session: {session.url}")
        return session.url
    except Exception as e:
        log.error(f"Failed to create Stripe checkout session: {e}")
        return None


# ────────────────────────────────────────────────────────────────────────────────
# DEMO EMAIL SENDER (unified with DEMO_BASE_URL)
# ────────────────────────────────────────────────────────────────────────────────

def send_demo_email(to_email, business_name, city):
    """Send follow-up email with demo link using DEMO_BASE_URL env var."""
    if not SMTP_USER or not SMTP_PASS:
        log.warning("SMTP credentials missing. Cannot send email.")
        return False

    from urllib.parse import quote
    demo_url = f"{DEMO_BASE_URL}/?shop={quote(business_name)}&city={quote(city)}"

    msg = EmailMessage()
    msg['Subject'] = f"Your free demo site \u2014 {business_name}"
    msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg['To'] = to_email

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8" /></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
      <div style="max-width:580px;margin:0 auto;padding:40px 24px;">

        <h1 style="color:#00f0ff;font-size:1.6rem;margin-bottom:8px;">
          Hey {business_name} \U0001f44b
        </h1>

        <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
          We just spoke \u2014 I'm <strong>{SENDER_NAME}</strong>, the local web developer.
          As promised, here's the free demo site I built for your smoke shop in <strong>{city}</strong>:
        </p>

        <div style="text-align:center;margin:32px 0;">
          <a href="{demo_url}"
             style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                    color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                    font-size:1.1rem;text-decoration:none;">
            \U0001f441 View Your Free Demo
          </a>
        </div>

        <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
          This shows what a clean, mobile-friendly website could look like for your shop.
          No commitment \u2014 just a free look. Reply here or call me if you want to move forward.
        </p>

        <hr style="border:none;border-top:1px solid #222;margin:32px 0;" />

        <p style="color:#666;font-size:.82rem;">
          {SENDER_NAME} \u2022 Local Web Developer<br />
          This demo was created specifically for {business_name}
        </p>
      </div>
    </body>
    </html>
    """

    msg.set_content(f"Hey {business_name},\n\nHere's your free demo site: {demo_url}\n\n\u2014 {SENDER_NAME}")
    msg.add_alternative(html_content, subtype='html')

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        log.info(f"Follow-up email sent successfully to {to_email}")
        return True
    except Exception as e:
        log.error(f"Failed to send email: {e}")
        return False


# ────────────────────────────────────────────────────────────────────────────────
# DEPLOYMENT TRIGGER (uses real customer data)
# ────────────────────────────────────────────────────────────────────────────────

def trigger_site_deployment(email, ref_id, stripe_metadata=None):
    """
    Look up the real lead from CRM, then deploy their personalized site.
    Falls back to Stripe metadata if CRM lookup fails.
    """
    log.info(f"[DEPLOY] Triggering automated site build for {email}...")

    # 1. Look up real lead data from CRM
    lead_data = lookup_lead_from_crm(email, ref_id)

    # 2. Fallback: use Stripe checkout metadata if CRM lookup failed
    if not lead_data and stripe_metadata:
        log.info("[DEPLOY] CRM lookup failed \u2014 using Stripe metadata as fallback.")
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
        log.error(error_msg)
        log_failed_job('deploy', {"email": email, "ref_id": ref_id}, error_msg)
        return

    # Ensure email is set on lead_data for delivery
    lead_data['email'] = lead_data.get('email') or email

    try:
        deployed_url = deploy_shop_website(lead_data)

        if deployed_url:
            log.info(f"Site deployed successfully: {deployed_url}")

            # Update CRM with live URL
            update_crm_deployed(email, deployed_url)

            # Trigger delivery flow (welcome email + upsell enrollment)
            try:
                trigger_delivery_flow(lead_data, deployed_url)
            except Exception as e:
                log_failed_job('delivery', {"lead_data": lead_data, "live_url": deployed_url}, str(e))
        else:
            log.error("Deployment script returned None. Sending to retry queue.")
            log_failed_job('deploy', lead_data, "Deployment script returned None")

    except Exception as e:
        log.critical(f"Fatal error during deployment flow: {e}")
        log_failed_job('deploy', lead_data, str(e))


# ---------------------------------------------------------------------------- #
#                                    ROUTES                                    #
# ---------------------------------------------------------------------------- #

@app.route('/health', methods=['GET'])
def health():
    return jsonify(status="ok"), 200


@app.route('/webhook', methods=['POST'])
def stripe_webhook():
    """Handle Stripe checkout.session.completed events."""
    payload = request.data
    sig_header = request.headers.get('STRIPE_SIGNATURE')

    if not endpoint_secret:
        log.error("Stripe webhook error: No STRIPE_WEBHOOK_SECRET configured.")
        return 'No webhook secret configured.', 400

    try:
        event = stripe.Webhook.construct_event(payload, sig_header, endpoint_secret)
    except ValueError:
        log.error("Stripe webhook error: Invalid payload")
        return 'Invalid payload', 400
    except stripe.SignatureVerificationError:
        log.error("Stripe webhook error: Invalid signature")
        return 'Invalid signature', 400

    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']

        customer_email = session.get('customer_details', {}).get('email', '') or session.get('customer_email', '')
        amount_paid = session.get('amount_total', 0) / 100.0
        client_reference_id = session.get('client_reference_id')
        stripe_metadata = session.get('metadata', {})

        log.info("\u2705 Payment Received via Stripe!")
        log.info(f"  - Customer: {customer_email}")
        log.info(f"  - Amount: ${amount_paid:.2f}")
        log.info(f"  - Ref ID: {client_reference_id}")

        # Stage 1: Update CRM \u2192 "WON - PAID"
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
    """Handle Vapi end-of-call reports \u2014 send demo email if email was collected."""
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

        log.info(f"Vapi call ended with {business_name}.")
        log.info(f"  - Outcome: {structured.get('outcome')}")

        if email:
            log.info(f"  - Email collected: {email} \u2014 sending demo...")
            send_demo_email(email, business_name, city)
        else:
            log.info("  - No email collected during the call.")

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
    log.info(f"Starting Unified Webhook Server on port {port}...")
    if not STRIPE_API_KEY:
        log.warning("STRIPE_API_KEY not set!")
    if not endpoint_secret or endpoint_secret == 'whsec_...':
        log.warning("STRIPE_WEBHOOK_SECRET not configured!")
    app.run(host='0.0.0.0', port=port, debug=is_debug)
