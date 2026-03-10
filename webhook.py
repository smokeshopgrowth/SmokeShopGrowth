import os
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

# Load environment variables
load_dotenv()

stripe.api_key = os.getenv('STRIPE_API_KEY')
endpoint_secret = os.getenv('STRIPE_WEBHOOK_SECRET')
GOOGLE_SHEET_URL = os.getenv('GOOGLE_SHEET_URL')
if not GOOGLE_SHEET_URL:
    print("WARNING: GOOGLE_SHEET_URL environment variable is missing. CRM updates will fail.")

# Vapi Email setup
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

app = Flask(__name__)

def send_demo_email(to_email, business_name, city):
    if not SMTP_USER or not SMTP_PASS:
        print("[-] SMTP credentials missing. Cannot send email.")
        return False
        
    demo_url = f"https://smoke-shop-premium-demo.netlify.app/?shop={business_name}&city={city}"
    
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

@app.route('/health', methods=['GET'])
def health():
    return jsonify(status="ok"), 200

@app.route('/webhook', methods=['POST'])
def webhook():
    # Retrieve the raw body and signature
    payload = request.data
    sig_header = request.headers.get('STRIPE_SIGNATURE')

    if not endpoint_secret:
        print("Webhook error: No STRIPE_WEBHOOK_SECRET configured.")
        return 'No webhook secret configured.', 400

    try:
        # Verify signature against our endpoint secret
        event = stripe.Webhook.construct_event(
            payload, sig_header, endpoint_secret
        )
    except ValueError as e:
        print("Webhook error: Invalid payload")
        return 'Invalid payload', 400
    except stripe.SignatureVerificationError as e:
        print("Webhook error: Invalid signature")
        return 'Invalid signature', 400

    # Handle the checkout.session.completed event
    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        
        # Extract customer info
        customer_email = session.get('customer_details', {}).get('email', 'Unknown')
        amount_paid = session.get('amount_total', 0) / 100.0  # Stripe amounts are in cents
        
        # Here we could pull metadata passed in from the link (like the shop name/id)
        client_reference_id = session.get('client_reference_id')
        
        print(f"\n[STRIPE] Successful Payment Received!")
        print(f"  - Customer Email: {customer_email}")
        print(f"  - Amount Paid: ${amount_paid:.2f}")
        print(f"  - Ref ID: {client_reference_id}")
        
        # Stage 9: Ping CRM to mark lead as "WON - PAID"
        update_crm_payment(customer_email, client_reference_id)
        
        # Stage 10: Trigger Automated Deployment!
        trigger_site_deployment(customer_email, client_reference_id)

    return jsonify(success=True)

@app.route('/vapi/webhook', methods=['POST'])
def vapi_webhook():
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
        
        # In our Vapi Prompt we ask to collect "contact_value" for the email.
        contact_value = structured.get('contact_value')
        if not email and contact_value and '@' in contact_value:
            email = contact_value
            
        print(f"\n[Webhook] Call ended with {business_name}.", flush=True)
        print(f"[Webhook] Analysis Outcome: {structured.get('outcome')}", flush=True)
        
        if email:
            print(f"[Webhook] AI collected email: {email} - Sending demo payload...", flush=True)
            send_demo_email(email, business_name, city)
        else:
            print("[Webhook] No email collected by AI during the call.", flush=True)
            
    return jsonify({"status": "received"}), 200

def update_crm_payment(email, ref_id):
    """
    Stage 9: Find the lead in Google Sheets and update their status to 'WON - PAID'.
    """
    print(f"[CRM] Updating Google Sheets for {email}...")
    try:
        scopes = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        creds = Credentials.from_service_account_file('credentials.json', scopes=scopes)
        client = gspread.authorize(creds)
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1
        
        # Try to find the email
        try:
            cell = sheet.find(email)
            if cell:
                # Update 'Status' column
                sheet.update_cell(cell.row, cell.col + 1, "WON - PAID")
                print(f"  [OK] Marked {email} as PAID in row {cell.row}!")
            else:
                print(f"  [Info] Email {email} not found. Appending as new paid lead.")
                sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])
        except Exception as e:
            # If find() throws an error instead of returning None
            if "not found" in str(e).lower():
                print(f"  [Info] Email {email} not found. Appending as new paid lead.")
                sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])
            else:
                raise e
            
    except Exception as e:
        print(f"  [ERROR] CRM Sync Failed: {e}")

def trigger_site_deployment(email, ref_id):
    """
    Placeholder for Stage 10
    """
    print(f"[DEPLOY] Triggering automated site build for {email}...")
    
    checkout_lead = {
        "business_name": "Premium Member Smoke Shop",
        "city": "Austin",
        "phone": "(512) 555-0000",
        "address": "100 Congress Ave, Austin, TX",
        "maps_url": "https://maps.google.com"
    }
    
    try:
        deployed_url = deploy_shop_website(checkout_lead)
        
        if deployed_url:
            print(f"\n  [*] Handing off successful URL to CRM: {deployed_url}")
            try:
                trigger_delivery_flow(checkout_lead, deployed_url)
            except Exception as e:
                log_failed_job('delivery', {"lead_data": checkout_lead, "live_url": deployed_url}, str(e))
        else:
            print(f"\n  [ERROR] Build returned None. Sending to retry queue.")
            log_failed_job('deploy', checkout_lead, "Deployment script returned None")
            
    except Exception as e:
        print(f"\n  [ERROR] Fatal error during deployment flow: {e}")
        log_failed_job('deploy', checkout_lead, str(e))

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 4242))
    print(f"Starting Unified Webhook Server on port {port}...")
    print("WARNING: Make sure STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET are in your .env file!")
    # For production, use Gunicorn! This is only for local dev.
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true')
