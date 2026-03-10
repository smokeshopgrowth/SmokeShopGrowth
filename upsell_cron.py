import os
import json
import smtplib
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv()

# Vapi Email setup
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

UPSELL_QUEUE_FILE = 'data/upsell_queue.json'


def send_upsell_email(to_email, business_name, day):
    if not SMTP_USER or not SMTP_PASS:
        print("[-] SMTP credentials missing. Cannot send upsell.")
        return False

    msg = EmailMessage()
    msg['From'] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg['To'] = to_email

    if day == 3:
        msg['Subject'] = f"Quick check-in on the new site, {business_name}!"
        html_content = f"""
        <html><body>
        <p>Hey {business_name},</p>
        <p>It's been a few days since your brand new high-converting Smoke Shop site went live!</p>
        <p>Are you starting to see more Google Maps foot traffic? Often, having a fast loading modern site will make Google push you much higher on the local map pack than your competitors.</p>
        <p>If you're looking for more ways to jump ahead of the neighboring shops, we also offer a <strong>Local SEO Boost Package</strong> where we ensure 100% of your maps data matches Yelp, YellowPages, Apple Maps, and Bing.</p>
        <p>Let me know if you want to hop on a 5-minute call to discuss!</p>
        <p>Best,<br>{SENDER_NAME} • SmokeShopGrowth</p>
        </body></html>
        """
    elif day == 7:
        msg['Subject'] = f"Leveling up {business_name}'s social media?"
        html_content = f"""
        <html><body>
        <p>Hey {business_name},</p>
        <p>I wanted to follow up and offer something my best clients usually pivot into after securing their new site: <strong>Social Media Automation</strong>.</p>
        <p>We build out automated Instagram bots that will generate high-quality product highlights utilizing AI to continuously post on your IG reels, drawing in massive local attention without any manual work on your end.</p>
        <p>Since you're already a website client, I can offer you 50% off the setup fee.</p>
        <p>Reply to this email if you want to see an example!</p>
        <p>Cheers,<br>{SENDER_NAME}</p>
        </body></html>
        """
    else:
        return False
        
    msg.set_content("Please enable HTML to view this email.")
    msg.add_alternative(html_content, subtype='html')

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        return True
    except Exception as e:
        print(f"[-] Failed to send upsell logic: {e}")
        return False

def process_upsell_queue():
    """
    Parses 'upsell_queue.json'. Looks at elapsed days.
    If 3 days elapsed, sends Day 3 email and records it.
    If 7 days elapsed, sends Day 7 email and records it.
    """
    if not os.path.exists(UPSELL_QUEUE_FILE):
        print("[Upsell Engine] No queue found. Exiting.")
        return

    with open(UPSELL_QUEUE_FILE, 'r') as f:
        queue_data = json.load(f)

    now = datetime.now(timezone.utc)
    modified = False

    for entry in queue_data:
        enrolled_at = datetime.fromisoformat(entry['enrolled_at'])
        days_passed = (now - enrolled_at).days

        # Fire Day 3 Drip
        if days_passed >= 3 and not entry.get('day_3_sent'):
            print(f"[Upsell Engine] Firing Day 3 Email to {entry['email']}")
            success = send_upsell_email(entry['email'], entry['client_name'], 3)
            if success:
                entry['day_3_sent'] = True
                modified = True

        # Fire Day 7 Drip
        if days_passed >= 7 and not entry.get('day_7_sent'):
            print(f"[Upsell Engine] Firing Day 7 Email to {entry['email']}")
            success = send_upsell_email(entry['email'], entry['client_name'], 7)
            if success:
                entry['day_7_sent'] = True
                modified = True

    if modified:
        with open(UPSELL_QUEUE_FILE, 'w') as f:
            json.dump(queue_data, f, indent=4)
        print("[Upsell Engine] Sequence states successfully updated.")
    else:
        print("[Upsell Engine] No pending sequences triggered.")

if __name__ == '__main__':
    print("[Upsell Engine] Scanning active drip campaigns...")
    process_upsell_queue()
