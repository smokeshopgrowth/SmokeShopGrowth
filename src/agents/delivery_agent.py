import os
import json
import smtplib
import requests
from email.message import EmailMessage
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

# Twilio for SMS delivery
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_FROM_NUMBER = os.getenv('TWILIO_FROM_NUMBER') or os.getenv('TWILIO_PHONE_NUMBER')

UPSELL_QUEUE_FILE = 'data/upsell_queue.json'


def send_welcome_email(client_email, shop_name, live_url):
    """Sends a professional 'Welcome Package' email with the live URL."""
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
          If you opted for a custom domain (like www.yourshop.com), our team is currently
          configuring the DNS records for you and it will propagate in the next 24-48 hours.
          Otherwise, your site is fully operational on the provided URL above!
        </p>

        <p style="color:#aaa;font-size:.9rem;line-height:1.7;margin-top:20px;">
          Reach out directly to this email if you need any help. Welcome to the family!
        </p>

        <hr style="border:none;border-top:1px solid #222;margin:32px 0;" />

        <p style="color:#666;font-size:.82rem;">
          {SENDER_NAME} • SmokeShopGrowth<br />
          Custom website for {shop_name}
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


def send_welcome_sms(phone, shop_name, live_url):
    """Send a welcome SMS via Twilio with the live URL."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_FROM_NUMBER:
        print(f"[-] Twilio not configured — skipping SMS to {phone}")
        return False

    # Normalize to E.164
    digits = ''.join(c for c in phone if c.isdigit())
    if digits.startswith('1') and len(digits) == 11:
        normalized = f"+{digits}"
    elif len(digits) == 10:
        normalized = f"+1{digits}"
    else:
        normalized = f"+{digits}"

    body = (
        f"🎉 Hey {shop_name}! Your custom website is LIVE: {live_url}\n\n"
        f"— {SENDER_NAME}, SmokeShopGrowth"
    )

    try:
        resp = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json",
            data={"To": normalized, "From": TWILIO_FROM_NUMBER, "Body": body},
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        )
        if resp.status_code in (200, 201):
            print(f"[+] Welcome SMS sent to {normalized}")
            return True
        else:
            print(f"[-] Twilio SMS failed: {resp.status_code} {resp.text}")
            return False
    except Exception as e:
        print(f"[-] Failed to send SMS: {e}")
        return False


def enroll_in_upsell_drip(client_name, client_email):
    """Enrolls the user in a JSON-backed 7-day email drip."""
    os.makedirs('data', exist_ok=True)

    queue_data = []
    if os.path.exists(UPSELL_QUEUE_FILE):
        try:
            with open(UPSELL_QUEUE_FILE, 'r') as f:
                queue_data = json.load(f)
        except Exception:
            queue_data = []

    new_entry = {
        "client_name": client_name,
        "email": client_email,
        "enrolled_at": datetime.now(timezone.utc).isoformat(),
        "day_3_sent": False,
        "day_7_sent": False
    }

    if not any(entry.get('email') == client_email for entry in queue_data):
        queue_data.append(new_entry)
        with open(UPSELL_QUEUE_FILE, 'w') as f:
            json.dump(queue_data, f, indent=4)
        print(f"  [UPSELL] {client_name} ({client_email}) enrolled in post-launch drip.")
    else:
        print(f"  [UPSELL] {client_email} is already in the upsell queue.")


def trigger_delivery_flow(lead_data, live_url):
    """
    Main delivery function — sends welcome email + SMS + enrolls in upsell drip.
    """
    shop_name = lead_data.get('business_name', 'Shop Owner')
    email = lead_data.get('email', 'N/A')
    phone = lead_data.get('phone', '')

    print(f"\n[DELIVERY AGENT] Initiating Delivery for {shop_name}...")

    # 1. Send Welcome Email
    if email and email != 'N/A':
        send_welcome_email(email, shop_name, live_url)

    # 2. Send Welcome SMS (if phone available)
    if phone:
        send_welcome_sms(phone, shop_name, live_url)

    # 3. Queue Upsell Sequence
    if email and email != 'N/A':
        enroll_in_upsell_drip(shop_name, email)

    print(f"\n  [*] DELIVERY PROTOCOL COMPLETE for {shop_name}.")


if __name__ == "__main__":
    test_client = {
        "business_name": "Cloud 9 Smoke Shop",
        "phone": "+17135559999",
        "email": "roryulloa@gmail.com"
    }
    test_url = "https://premiumsmokeshop-cloud-9.vercel.app"

    trigger_delivery_flow(test_client, test_url)
