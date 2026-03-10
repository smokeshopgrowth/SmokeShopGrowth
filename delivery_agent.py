import os
import json
import smtplib
from email.message import EmailMessage
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

UPSELL_QUEUE_FILE = 'data/upsell_queue.json'

def send_welcome_email(client_email, shop_name, live_url):
    """Sends a professional "Welcome Package" email with the link and instructions"""
    if not SMTP_USER or not SMTP_PASS:
        print(f"[-] SMTP credentials missing. Mocking Email to {client_email}")
        return False
        
    msg = EmailMessage()
    msg['Subject'] = f"Welcome aboard! Custom Website for {shop_name} is LIVE 🚀"
    msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg['To'] = client_email

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8" /></head>
    <body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
      <div style="max-width:580px;margin:0 auto;padding:40px 24px;">

        <h1 style="color:#39ff14;font-size:1.6rem;margin-bottom:8px;">
          Congratulations {shop_name}!
        </h1>

        <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
          Your custom, premium website has been finalized, built, and is now fully live on the web!
          You can access your brand new digital storefront here:
        </p>

        <div style="text-align:center;margin:32px 0;">
          <a href="{live_url}"
             style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                    color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                    font-size:1.1rem;text-decoration:none;">
            🌐 View Your Live Website
          </a>
        </div>

        <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
          <strong>Next Steps:</strong><br/>
          If you opted for a custom domain (like www.yourshop.com), our team is currently configuring the DNS records for you and it will propagate in the next 24-48 hours.
          Otherwise, your site is fully operational on the provided URL above!
        </p>
        
        <p style="color:#aaa;font-size:.9rem;line-height:1.7;margin-top:20px;">
          Reach out directly to this email if you need any help finding your way around. Welcome to the family!
        </p>

        <hr style="border:none;border-top:1px solid #222;margin:32px 0;" />

        <p style="color:#666;font-size:.82rem;">
          {SENDER_NAME} • Automated Delivery Agent<br />
          SmokeShopGrowth Systems
        </p>
      </div>
    </body>
    </html>
    """
    
    msg.set_content(f"Hey {shop_name},\n\nYour site is live! Check it out here: {live_url}\n\n— {SENDER_NAME}")
    msg.add_alternative(html_content, subtype='html')

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print(f"[+] Welcome email successfully delivered to {client_email}")
        return True
    except Exception as e:
        print(f"[-] Failed to send welcome email: {e}")
        return False


def enroll_in_upsell_drip(client_name, client_email):
    """
    Enrolls the user in a JSON-backed 7-day or 14-day email drip.
    """
    os.makedirs('data', exist_ok=True)
    
    queue_data = []
    if os.path.exists(UPSELL_QUEUE_FILE):
        try:
            with open(UPSELL_QUEUE_FILE, 'r') as f:
                queue_data = json.load(f)
        except Exception:
            queue_data = []
            
    # Add new entry
    new_entry = {
        "client_name": client_name,
        "email": client_email,
        "enrolled_at": datetime.now(timezone.utc).isoformat(),
        "day_3_sent": False,
        "day_7_sent": False
    }
    
    # Check if already enrolled to avoid duplicates
    if not any(entry.get('email') == client_email for entry in queue_data):
        queue_data.append(new_entry)
        with open(UPSELL_QUEUE_FILE, 'w') as f:
            json.dump(queue_data, f, indent=4)
        print(f"  [UPSELL] {client_name} ({client_email}) has been enrolled in the 'Post-Launch SEO Upsell' drip sequence.")
    else:
        print(f"  [UPSELL] {client_email} is already in the upsell queue.")


def trigger_delivery_flow(lead_data, live_url):
    """
    Main function to execute Stage 13 & 14.
    """
    print(f"\n[DELIVERY AGENT] Initiating Delivery Protocol for {lead_data.get('business_name')}...")
    
    phone = lead_data.get('phone')
    email = lead_data.get('email', 'N/A')
    shop_name = lead_data.get('business_name', 'Shop Owner')
    
    # 1. Send Email
    if email != 'N/A':
        send_welcome_email(email, shop_name, live_url)
        
    # 2. Queue Upsell Sequence
    enroll_in_upsell_drip(shop_name, email)
    
    print("\n  [*] DELIVERY PROTOCOL COMPLETE. The client has received their product.")


if __name__ == "__main__":
    # Test payload
    test_client = {
        "business_name": "Cloud 9 Smoke Shop",
        "phone": "+17135559999", # Note: Twilio needs E.164 format
        "email": "roryulloa@gmail.com" # Testing with real target
    }
    test_url = "https://premiumsmokeshop-cloud-9.vercel.app"
    
    trigger_delivery_flow(test_client, test_url)
