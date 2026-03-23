import gspread
from config import GOOGLE_SHEET_URL
from google.oauth2.service_account import Credentials
from logger import get_logger

log = get_logger(__name__)

# ---------------------------------------------------------------------------- #
#                                 CRM HELPERS                                  #
# ---------------------------------------------------------------------------- #

def _get_sheets_client():
    """Return an authorized gspread client using service account credentials."""
    try:
        scopes = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
        creds = Credentials.from_service_account_file('credentials.json', scopes=scopes)
        return gspread.authorize(creds)
    except FileNotFoundError:
        log.error("Google credentials file not found at credentials.json")
        return None
    except Exception as e:
        log.error(f"Failed to authorize Google Sheets client: {e}")
        return None

def lookup_lead_from_crm(email, ref_id=None):
    """
    Look up a lead's full data from Google Sheets by email (or ref_id).
    Returns a dict with business_name, city, phone, address, maps_url, email, custom_domain
    or None if not found.
    """
    if not GOOGLE_SHEET_URL:
        log.warning("GOOGLE_SHEET_URL not set — cannot look up lead.")
        return None

    try:
        client = _get_sheets_client()
        if not client:
            return None
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1
        all_records = sheet.get_all_records()

        # Try to find by email first, then by ref_id
        for row in all_records:
            row_email = str(row.get('email', row.get('Email', ''))).strip().lower()
            row_ref = str(row.get('ref_id', row.get('client_reference_id', row.get('lead_id', '')))).strip()

            if (email and row_email == email.strip().lower()) or (ref_id and row_ref == ref_id):
                lead = {
                    "business_name": row.get('business_name', row.get('Business Name', row.get('title', 'Smoke Shop'))),
                    "city": row.get('city', row.get('City', '')),
                    "phone": row.get('phone', row.get('Phone', '')),
                    "address": row.get('address', row.get('Address', '')),
                    "email": email or row_email,
                    "maps_url": row.get('maps_url', row.get('google_maps_url', 'https://maps.google.com')),
                    "custom_domain": row.get('custom_domain', row.get('domain', None)) or None,
                    "hours": row.get('hours', row.get('Hours', 'Open Daily 9am - 10pm')),
                    "instagram": row.get('instagram', row.get('Instagram', '')),
                }
                log.info(f"Found lead in CRM: {lead['business_name']} ({lead['city']})")
                return lead

        log.warning(f"Lead not found in CRM for email={email}, ref_id={ref_id}")
        return None

    except gspread.exceptions.SpreadsheetNotFound:
        log.error(f"Google Sheet not found at URL: {GOOGLE_SHEET_URL}")
        return None
    except gspread.exceptions.APIError as e:
        log.error(f"Google Sheets API error: {e}")
        return None
    except Exception as e:
        log.error(f"CRM lookup failed: {e}")
        return None

def update_crm_payment(email, ref_id):
    """
    Find the lead in Google Sheets and update their status to 'WON - PAID'.
    """
    log.info(f"Updating CRM for {email} to WON - PAID...")
    if not GOOGLE_SHEET_URL:
        log.warning("GOOGLE_SHEET_URL not set — skipping CRM update.")
        return

    try:
        client = _get_sheets_client()
        if not client:
            return
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1

        try:
            cell = sheet.find(email)
            if cell:
                sheet.update_cell(cell.row, cell.col + 1, "WON - PAID")
                log.info(f"Marked {email} as PAID in CRM.")
            else:
                log.info(f"Email {email} not found in CRM. Appending as new paid lead.")
                sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])
        except gspread.exceptions.CellNotFound:
            log.info(f"Email {email} not found in CRM. Appending as new paid lead.")
            sheet.append_row([email, ref_id, "WON - PAID", "Awaiting Auto-Deploy"])

    except gspread.exceptions.SpreadsheetNotFound:
        log.error(f"Google Sheet not found at URL: {GOOGLE_SHEET_URL}")
    except gspread.exceptions.APIError as e:
        log.error(f"Google Sheets API error during payment update: {e}")
    except Exception as e:
        log.error(f"CRM payment update failed: {e}")

def update_crm_deployed(email, deployed_url):
    """Update the CRM row with the live URL after deployment."""
    if not GOOGLE_SHEET_URL:
        return
    try:
        client = _get_sheets_client()
        if not client:
            return
        sheet = client.open_by_url(GOOGLE_SHEET_URL).sheet1
        cell = sheet.find(email)
        if cell:
            sheet.update_cell(cell.row, cell.col + 2, deployed_url)
            sheet.update_cell(cell.row, cell.col + 1, "DEPLOYED")
            log.info(f"Updated CRM for {email} with live URL: {deployed_url}")
    except gspread.exceptions.CellNotFound:
        log.warning(f"Could not find {email} in CRM to update with deployed URL.")
    except gspread.exceptions.APIError as e:
        log.error(f"Google Sheets API error during deployment update: {e}")
    except Exception as e:
        log.error(f"Failed to update CRM with deployed URL: {e}")
