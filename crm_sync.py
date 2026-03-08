import gspread
from google.oauth2.service_account import Credentials
import csv
import sys
import os
import time

# Define the scope
SCOPE = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']

# Credentials path
CREDENTIALS_FILE = 'credentials.json'

def sync_to_crm(csv_path, sheet_url):
    print(f"Starting CRM Sync...")
    
    if not os.path.exists(CREDENTIALS_FILE):
        print(f"Error: {CREDENTIALS_FILE} not found.")
        print("Please ensure your Google Service Account credentials log is named 'credentials.json' and is in this directory.")
        sys.exit(1)
        
    if not os.path.exists(csv_path):
        print(f"Error: Input file {csv_path} not found.")
        sys.exit(1)

    print("Authenticating with Google Sheets...")
    try:
        creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPE)
        client = gspread.authorize(creds)
    except Exception as e:
        print(f"Authentication failed: {e}")
        sys.exit(1)
        
    print("Opening spreadsheet...")
    try:
        # Open by URL or Key/ID doesn't matter, URL is usually easier for users to provide
        sheet = client.open_by_url(sheet_url).sheet1
    except Exception as e:
        print(f"Failed to open spreadsheet. Ensure the service account email is added as an 'Editor' to the sheet.")
        print(f"Error details: {e}")
        sys.exit(1)

    print(f"Reading data from {csv_path}...")
    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            data = list(reader)
            headers = reader.fieldnames
    except Exception as e:
        print(f"Failed to read CSV: {e}")
        sys.exit(1)
        
    print(f"Found {len(data)} rows in local CSV.")
    
    # Write Headers if the sheet is empty
    existing_data = sheet.get_all_records()
    if not existing_data and len(sheet.range('A1:Z1')) == 0 or len(existing_data) == 0 and not sheet.row_values(1):
        print("Sheet is empty. Writing headers first...")
        sheet.insert_row(headers, 1)
        
    # Get existing business names to avoid duplicates
    try:
        # Re-fetch if we just added headers
        existing_data = sheet.get_all_records()
        existing_names = [row.get('business_name', row.get('Name', '')).strip().lower() for row in existing_data]
    except Exception as e:
        print(f"Warning: Could not fetch existing records for deduplication. Assuming empty.")
        existing_names = []

    print("Syncing data to CRM...")
    skipped_count = 0
    rows_to_add = []
    
    for row in data:
        b_name = row.get('business_name', row.get('Name', '')).strip()
        
        if not b_name:
            continue
            
        if b_name.lower() in existing_names:
            skipped_count += 1
            print(f"Skipping (Already exists): {b_name.encode('ascii','ignore').decode('ascii')}")
            continue
            
        # Convert row dict to list in the exact order of the headers
        row_values = [str(row.get(h, "")) for h in headers]
        rows_to_add.append(row_values)
        existing_names.append(b_name.lower()) # prevent duplicates within the same run

    if rows_to_add:
        max_retries = 3
        for attempt in range(max_retries):
            try:
                print(f"Adding {len(rows_to_add)} new leads to Google Sheets in bulk (Attempt {attempt + 1})...")
                sheet.append_rows(rows_to_add)
                print("Successfully added all new leads!")
                break
            except Exception as e:
                print(f"Failed to bulk add rows: {e}")
                if "429" in str(e) and attempt < max_retries - 1:
                    print("Rate limit hit. Waiting 60 seconds before retrying...")
                    time.sleep(60)
                else:
                    break
    else:
        print("No new leads to add.")

    print("\n--- CRM Sync Complete ---")
    print(f"New Leads added:  {len(rows_to_add)}")
    print(f"Duplicates skipped: {skipped_count}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python crm_sync.py <path_to_csv> <google_sheet_url>")
        sys.exit(1)
        
    csv_file = sys.argv[1]
    g_sheet_url = sys.argv[2]
    
    sync_to_crm(csv_file, g_sheet_url)
