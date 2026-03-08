import os
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

app = Flask(__name__)

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
    except stripe.error.SignatureVerificationError as e:
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
        
        # In a real scenario, you'd match by email or ref_id.
        # Since we don't have emails for all leads, we are doing a generic search,
        # or we just append them to the bottom as a new PAID customer if not found.
        
        # Try to find the email
        try:
            cell = sheet.find(email)
            if cell:
                # Update 'Status' column (Assuming column F or similar, but we can just add "WON - PAID" to the end of the row)
                # To be safe without knowing exact column index:
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
    Placeholder for Stage 10:
    We will clone the Netlify template, insert their JSON config, and run a production build.
    """
    print(f"[DEPLOY] Triggering automated site build for {email}...")
    
    # Mock Lead Data - In production, fetch this from CRM using 'email'
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
            # Next step: Update CRM with the deployed URL and SMS the client!
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
    print(f"Starting Stripe Webhook Server on port {port}...")
    print("WARNING: Make sure STRIPE_API_KEY and STRIPE_WEBHOOK_SECRET are in your .env file!")
    app.run(host='0.0.0.0', port=port, debug=os.environ.get('FLASK_DEBUG', 'False').lower() == 'true')
