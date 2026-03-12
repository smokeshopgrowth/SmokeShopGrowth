import os
import json
import smtplib
from email.message import EmailMessage
from flask import Flask, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')

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

if __name__ == '__main__':
    print("Starting Post-Call Webhook Listener on port 3001...")
    app.run(port=3001)
