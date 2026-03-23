"""
deploy_agent.py — Automated site deployment for paid smoke shop leads.

Generates a personalised HTML site from the project template and publishes
it to Netlify (or a configurable provider).  Returns the live URL on success,
None on failure.

Required env vars:
  NETLIFY_AUTH_TOKEN  — Netlify personal access token
  NETLIFY_SITE_ID     — (recommended) Netlify site to deploy to

Optional env vars:
  SITE_TEMPLATE_PATH  — Path to template.html (default: <repo_root>/template.html)
  DEMO_BASE_URL       — Fallback base URL when Netlify is not configured
"""

import os
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import quote

from logger import get_logger

log = get_logger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

NETLIFY_AUTH_TOKEN = os.environ.get("NETLIFY_AUTH_TOKEN", "")
NETLIFY_SITE_ID = os.environ.get("NETLIFY_SITE_ID", "")
DEMO_BASE_URL = os.environ.get("DEMO_BASE_URL", "https://smoke-shop-premium-demo.netlify.app")

# Resolve template path relative to repo root (two levels above src/python/)
_REPO_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = os.environ.get(
    "SITE_TEMPLATE_PATH",
    str(_REPO_ROOT / "template.html"),
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load_template() -> str:
    """Load the HTML template file."""
    try:
        with open(TEMPLATE_PATH, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        log.error(f"Template not found at: {TEMPLATE_PATH}")
        return ""


def _personalise(template: str, lead_data: dict) -> str:
    """
    Replace {{PLACEHOLDER}} tokens in the template with real lead data.
    Unknown placeholders are left unchanged.
    """
    replacements = {
        "{{BUSINESS_NAME}}": lead_data.get("business_name", "Your Smoke Shop"),
        "{{CITY}}": lead_data.get("city", ""),
        "{{PHONE}}": lead_data.get("phone", ""),
        "{{ADDRESS}}": lead_data.get("address", ""),
        "{{MAPS_URL}}": lead_data.get("maps_url", "https://maps.google.com"),
        "{{HOURS}}": lead_data.get("hours", "Open Daily 9am \u2013 10pm"),
        "{{INSTAGRAM}}": lead_data.get("instagram", ""),
        "{{EMAIL}}": lead_data.get("email", ""),
    }
    html = template
    for placeholder, value in replacements.items():
        html = html.replace(placeholder, str(value) if value else "")
    return html


def _fallback_demo_url(business_name: str, city: str) -> str:
    """Return a demo URL as a safe fallback when deployment isn't available."""
    return f"{DEMO_BASE_URL}/?shop={quote(business_name)}&city={quote(city)}"


def _deploy_to_netlify(site_html: str) -> str | None:
    """
    Write the HTML to a temp directory and deploy it to Netlify via the CLI.
    Returns the live URL on success, or None on failure.
    """
    if not NETLIFY_AUTH_TOKEN:
        log.warning("[DEPLOY] NETLIFY_AUTH_TOKEN not set \u2014 skipping live deploy.")
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        index_path = Path(tmpdir) / "index.html"
        index_path.write_text(site_html, encoding="utf-8")

        cmd = [
            "netlify", "deploy", "--prod",
            "--dir", tmpdir,
            "--auth", NETLIFY_AUTH_TOKEN,
        ]
        if NETLIFY_SITE_ID:
            cmd += ["--site", NETLIFY_SITE_ID]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0:
                for line in result.stdout.splitlines():
                    if "Live URL:" in line or "Website URL:" in line:
                        url = line.split()[-1].strip()
                        log.info(f"[DEPLOY] Netlify deploy succeeded: {url}")
                        return url
                # Netlify succeeded but URL not in output \u2014 use site ID
                fallback = f"https://{NETLIFY_SITE_ID}.netlify.app" if NETLIFY_SITE_ID else None
                log.warning(f"[DEPLOY] Deploy succeeded, using site URL: {fallback}")
                return fallback
            else:
                log.error(f"[DEPLOY] Netlify CLI returned non-zero exit: {result.stderr}")
                return None
        except subprocess.TimeoutExpired:
            log.error("[DEPLOY] Netlify deploy timed out after 120s.")
            return None
        except FileNotFoundError:
            log.error("[DEPLOY] netlify CLI not found. Install with: npm i -g netlify-cli")
            return None
        except Exception as e:
            log.error(f"[DEPLOY] Unexpected error during Netlify deploy: {e}")
            return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def deploy_shop_website(lead_data: dict) -> str | None:
    """
    Generate and deploy a personalised smoke shop website for a paying customer.

    Args:
        lead_data: Dict with keys \u2014 business_name, city, phone, address,
                   email, maps_url, custom_domain, hours, instagram

    Returns:
        The live URL of the deployed site, or None on unrecoverable failure.
    """
    business_name = lead_data.get("business_name", "Smoke Shop")
    city = lead_data.get("city", "")

    log.info(f"[DEPLOY] Building site for '{business_name}' in {city or 'unknown city'}...")

    template = _load_template()
    if not template:
        log.error("[DEPLOY] Template could not be loaded \u2014 aborting deployment.")
        return None

    personalised_html = _personalise(template, lead_data)
    log.info(f"[DEPLOY] HTML personalised ({len(personalised_html):,} bytes).")

    # Attempt live Netlify deployment
    live_url = _deploy_to_netlify(personalised_html)

    # Safe fallback: return personalised demo URL so the webhook can still respond
    if not live_url:
        log.warning("[DEPLOY] Live deploy unavailable \u2014 returning demo URL as fallback.")
        live_url = _fallback_demo_url(business_name, city)

    log.info(f"[DEPLOY] Final URL: {live_url}")
    return live_url
