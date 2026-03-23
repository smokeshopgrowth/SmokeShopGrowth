"""
delivery_agent.py — Post-payment delivery flow for SmokeShopGrowth.

Triggered after a customer's site is successfully deployed.
Responsibilities:
  1. Send a welcome / handoff email with the live URL.
  2. Enrol the lead in the upsell follow-up sequence.
"""

import smtplib
from email.message import EmailMessage

from config import (
    SENDER_NAME,
    SMTP_HOST,
    SMTP_PASS,
    SMTP_PORT,
    SMTP_USER,
)
from logger import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# Welcome email
# ---------------------------------------------------------------------------

def _send_welcome_email(lead_data: dict, live_url: str) -> bool:
    """
    Send a branded welcome / handoff email to the customer with their live URL.

    Returns True on success, False on failure.
    """
    if not SMTP_USER or not SMTP_PASS:
        log.warning("[DELIVERY] SMTP credentials missing \u2014 skipping welcome email.")
        return False

    to_email = lead_data.get("email", "")
    if not to_email:
        log.warning("[DELIVERY] No email address on lead_data \u2014 cannot send welcome email.")
        return False

    business_name = lead_data.get("business_name", "Your Shop")
    city = lead_data.get("city", "")

    subject = f"\U0001f389 Your site is live \u2014 {business_name}"

    html_body = f"""
    <!DOCTYPE html>
    <html>
    <head><meta charset=\"UTF-8\" /></head>
    <body style=\"margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;\">
      <div style=\"max-width:580px;margin:0 auto;padding:40px 24px;\">

        <h1 style=\"color:#39ff14;font-size:1.8rem;margin-bottom:8px;\">
          \U0001f389 Your site is live!
        </h1>

        <p style=\"color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;\">
          Hey <strong>{business_name}</strong> \U0001f44b<br/>
          Your custom smoke shop website for <strong>{city}</strong> is now live.
          Here\u2019s your link \u2014 share it everywhere!
        </p>

        <div style=\"text-align:center;margin:32px 0;\">
          <a href=\"{live_url}\"
             style=\"display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                    color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                    font-size:1.1rem;text-decoration:none;\">
            \U0001f310 Visit Your Live Site
          </a>
        </div>

        <p style=\"color:#aaa;font-size:.9rem;line-height:1.7;\">
          Add this link to your Google Business profile, Instagram bio, and anywhere
          else customers look for you. Reply to this email if you need any changes \u2014
          we\u2019ve got you covered.
        </p>

        <hr style=\"border:none;border-top:1px solid #222;margin:32px 0;\" />

        <p style=\"color:#666;font-size:.82rem;\">
          {SENDER_NAME} \u2022 SmokeShopGrowth<br/>
          Site built specifically for {business_name}
        </p>
      </div>
    </body>
    </html>
    """

    plain_body = (
        f"Hey {business_name},\n\n"
        f"Your site is live! Visit it here: {live_url}\n\n"
        f"Add this link to your Google Business profile and Instagram bio.\n"
        f"Reply to this email if you need any changes.\n\n"
        f"\u2014 {SENDER_NAME}"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{SENDER_NAME} <{SMTP_USER}>"
    msg["To"] = to_email
    msg.set_content(plain_body)
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        log.info(f"[DELIVERY] Welcome email sent to {to_email}")
        return True
    except smtplib.SMTPAuthenticationError:
        log.error("[DELIVERY] SMTP authentication failed \u2014 check SMTP_USER / SMTP_PASS.")
        return False
    except smtplib.SMTPException as e:
        log.error(f"[DELIVERY] SMTP error sending welcome email to {to_email}: {e}")
        return False
    except Exception as e:
        log.error(f"[DELIVERY] Unexpected error sending welcome email: {e}")
        return False


# ---------------------------------------------------------------------------
# Upsell enrolment
# ---------------------------------------------------------------------------

def _enrol_upsell(lead_data: dict, live_url: str) -> None:
    """
    Enrol the customer in the upsell follow-up sequence.

    Currently logs intent; wire to n8n webhook or email drip to activate.
    """
    business_name = lead_data.get("business_name", "")
    email = lead_data.get("email", "")
    log.info(
        f"[DELIVERY] Upsell enrolment queued \u2014 "
        f"business='{business_name}', email={email}, site={live_url}"
    )
    # TODO: POST to n8n upsell workflow:
    #   import requests
    #   requests.post(os.environ['N8N_UPSELL_WEBHOOK'], json={...}, timeout=10)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def trigger_delivery_flow(lead_data: dict, deployed_url: str) -> None:
    """
    Run the full post-payment delivery flow for a newly deployed site.

    Steps:
      1. Send a welcome email to the customer with their live URL.
      2. Enrol the lead in the upsell follow-up sequence.

    Args:
        lead_data:    Lead dict (business_name, city, email, phone, etc.)
        deployed_url: The live site URL returned by deploy_agent.deploy_shop_website()
    """
    business_name = lead_data.get("business_name", "")
    log.info(f"[DELIVERY] Starting delivery flow for '{business_name}'...")

    email_ok = _send_welcome_email(lead_data, deployed_url)
    if not email_ok:
        log.warning("[DELIVERY] Welcome email could not be sent \u2014 check SMTP configuration.")

    _enrol_upsell(lead_data, deployed_url)

    log.info("[DELIVERY] Delivery flow complete.")
