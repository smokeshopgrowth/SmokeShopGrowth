import os
from twilio.rest import Client
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail
from dotenv import load_dotenv

load_dotenv()

# Setup Credentials
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')

SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
SENDER_EMAIL = os.getenv('SENDER_EMAIL')

def send_welcome_sms(client_phone, shop_name, live_url):
    """Sends the official "Your Website is Live" SMS"""
    if not TWILIO_AUTH_TOKEN:
        print(f"[SMS Skip] No Twilio Auth Token. Mocking SMS to {client_phone}")
        return True
        
    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
        message_body = (
            f"Hey {shop_name}!\n\n"
            f"[*] Congratulations, your premium website is officially LIVE!\n"
            f"Check it out here: {live_url}\n\n"
            f"We'll be in touch soon to show you how to maximize your new traffic. Enjoy!"
        )
        
        message = client.messages.create(
            body=message_body,
            from_=TWILIO_PHONE_NUMBER,
            to=client_phone
        )
        print(f"  [SMS SUCCESS] Welcome text sent to {client_phone} (SID: {message.sid})")
        return True
    except Exception as e:
        print(f"  [SMS ERROR] Failed to send welcome SMS: {e}")
        return False

def send_welcome_email(client_email, shop_name, live_url):
    """Sends a professional "Welcome Package" email with the link and instructions"""
    if not SENDGRID_API_KEY:
        print(f"[Email Skip] No Sendgrid key. Mocking Email to {client_email}")
        return True
        
    try:
        sg = SendGridAPIClient(SENDGRID_API_KEY)
        subject = f"[*] Your New Website is LIVE - {shop_name}"
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto;">
            <h2 style="color: #2b2b2b;">Congratulations, it's launch day!</h2>
            <p>Your premium smoke shop website has successfully passed quality assurance and has been deployed.</p>
            <p><strong>Your Live Link:</strong> <br>
               <a href="{live_url}" style="color: #007bff; font-weight: bold; font-size: 18px;">{live_url}</a>
            </p>
            <h3>Next Steps</h3>
            <ol>
                <li>Review the site on your phone.</li>
                <li>Add this link to your Google Business Profile and Instagram bio.</li>
                <li>If you purchased a custom domain, please ensure your DNS records are pointed to our servers (we will follow up if you need help).</li>
            </ol>
            <p>We will check in with you in a few days to see how things are going and discuss SEO strategies to get you to #1 on Google.</p>
            <p>Best regards,<br>The SmokeShopGrowth Team</p>
        </div>
        """
        
        message = Mail(
            from_email=SENDER_EMAIL,
            to_emails=client_email,
            subject=subject,
            html_content=html_content
        )
        response = sg.send(message)
        print(f"  [EMAIL SUCCESS] Welcome email sent to {client_email} (Status: {response.status_code})")
        return True
    except Exception as e:
        print(f"  [EMAIL ERROR] Failed to send welcome email: {e}")
        return False

def enroll_in_upsell_drip(client_name, client_email):
    """
    Placeholder for enrolling the user in a 7-day or 14-day email drip.
    In production, you could use an API call to ActiveCampaign, Klaviyo, or Zapier here.
    """
    print(f"  [UPSELL] {client_name} ({client_email}) has been enrolled in the 'Post-Launch SEO Upsell' drip sequence.")


def trigger_delivery_flow(lead_data, live_url):
    """
    Main function to execute Stage 13 & 14.
    """
    print(f"\n[DELIVERY AGENT] Initiating Delivery Protocol for {lead_data.get('business_name')}...")
    
    phone = lead_data.get('phone')
    email = lead_data.get('email', 'N/A')
    shop_name = lead_data.get('business_name', 'Shop Owner')
    
    # 1. Send SMS
    if phone:
        send_welcome_sms(phone, shop_name, live_url)
    
    # 2. Send Email
    if email != 'N/A':
        send_welcome_email(email, shop_name, live_url)
        
    # 3. Queue Upsell Sequence
    enroll_in_upsell_drip(shop_name, email)
    
    print("\n  [*] DELIVERY PROTOCOL COMPLETE. The client has received their product.")


if __name__ == "__main__":
    # Test payload
    test_client = {
        "business_name": "Cloud 9 Smoke Shop",
        "phone": "+17135559999", # Note: Twilio needs E.164 format
        "email": "test@example.com"
    }
    test_url = "https://premiumsmokeshop-cloud-9.vercel.app"
    
    trigger_delivery_flow(test_client, test_url)
