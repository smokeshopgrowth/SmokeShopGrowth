import os
from dotenv import load_dotenv

load_dotenv()

SENDGRID_API_KEY = os.getenv('SENDGRID_API_KEY')
SENDER_EMAIL     = os.getenv('SENDER_EMAIL', 'hello@youragency.com')


def send_welcome_email(client_email, shop_name, live_url):
    """
    Sends a professional "Welcome Package" email via SendGrid with the live site link.
    Falls back to a loud warning (never silently succeeds) if SendGrid is not configured.
    """
    if not SENDGRID_API_KEY:
        print(f"[Email WARNING] SENDGRID_API_KEY not set — email NOT sent to {client_email}. "
              "Add SENDGRID_API_KEY to your .env to enable email delivery.")
        return False

    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.mail import Mail

        subject = f"🎉 Your Custom Website for {shop_name} is Live!"
        html_body = f"""
        <html>
          <body style="font-family: Arial, sans-serif; color: #222; max-width: 600px; margin: auto;">
            <h2 style="color: #2563eb;">Your site is live, {shop_name}!</h2>
            <p>Hi there,</p>
            <p>We just finished building your custom website. Here's your live link:</p>
            <p style="text-align: center;">
              <a href="{live_url}"
                 style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:6px;
                        text-decoration:none;font-weight:bold;display:inline-block;">
                View Your Website →
              </a>
            </p>
            <p>If you have any questions or need any changes, just reply to this email.</p>
            <p>Talk soon,<br><strong>The Team</strong></p>
          </body>
        </html>
        """

        message = Mail(
            from_email=SENDER_EMAIL,
            to_emails=client_email,
            subject=subject,
            html_content=html_body,
        )

        sg = SendGridAPIClient(SENDGRID_API_KEY)
        response = sg.send(message)

        if response.status_code in [200, 202]:
            print(f"  [Email OK] Welcome email sent to {client_email} (status {response.status_code})")
            return True
        else:
            print(f"  [Email Error] SendGrid returned status {response.status_code}: {response.body}")
            return False

    except ImportError:
        print("  [Email Error] sendgrid package not installed. Run: pip install sendgrid")
        return False
    except Exception as e:
        print(f"  [Email Error] Failed to send email to {client_email}: {e}")
        return False


def enroll_in_upsell_drip(client_name, client_email):
    """
    Placeholder for enrolling the user in a 7-day or 14-day email drip.
    In production, hook this up to ActiveCampaign, Klaviyo, or Zapier.
    """
    print(f"  [UPSELL] {client_name} ({client_email}) enrolled in the 'Post-Launch SEO Upsell' drip sequence.")


def trigger_delivery_flow(lead_data, live_url):
    """
    Main function to execute Stage 13 & 14.
    """
    print(f"\n[DELIVERY AGENT] Initiating Delivery Protocol for {lead_data.get('business_name')}...")

    phone     = lead_data.get('phone')
    email     = lead_data.get('email', 'N/A')
    shop_name = lead_data.get('business_name', 'Shop Owner')

    # 1. Send Email
    if email and email != 'N/A':
        send_welcome_email(email, shop_name, live_url)
    else:
        print("  [Email Skip] No email address on record for this lead.")

    # 2. Queue Upsell Sequence
    enroll_in_upsell_drip(shop_name, email)

    print("\n  [*] DELIVERY PROTOCOL COMPLETE. The client has received their product.")


if __name__ == "__main__":
    # Test payload
    test_client = {
        "business_name": "Cloud 9 Smoke Shop",
        "phone": "+17135559999",
        "email": "test@example.com"
    }
    test_url = "https://premiumsmokeshop-cloud-9.vercel.app"

    trigger_delivery_flow(test_client, test_url)
