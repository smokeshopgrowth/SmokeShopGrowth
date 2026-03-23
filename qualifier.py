import csv
import time
import requests
from urllib.parse import urlparse
import socket
import ssl
import re
import sys
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Configuration ─────────────────────────────────────────────────────────────
MAX_WORKERS    = 15   # parallel website checks
HTTP_RETRIES   = 3    # retry transient failures before marking broken
RETRY_BACKOFF  = 1.0  # seconds between retries (doubled each attempt)

# Opportunity Score Reference:
# No website:            10
# Broken website:         9
# HTTP only (No SSL):     7
# Slow website (>3s):     6
# Low review count (<50): +2 bonus (stacks with other scores)
# Good website:           2


def clean_business_name(name):
    """
    Cleans Google Maps business names to keep them simple and short.
    Example: 'Cloud 9 Smoke Shop | Vape | CBD | Kratom' -> 'Cloud 9 Smoke Shop'
    """
    if not name:
        return "Unknown Shop"

    delimiters = ['|', '-', '–', '—', ':', ',', '(']

    clean_name = name
    for delim in delimiters:
        if delim in clean_name:
            clean_name = clean_name.split(delim)[0]

    clean_name = clean_name.strip()

    clean_name = re.sub(r'(?i)\bl\b\.\bl\b\.\bc\b\.?', '', clean_name)
    clean_name = re.sub(r'(?i)\bllc\b', '', clean_name)
    clean_name = re.sub(r'(?i)\binc\.?\b', '', clean_name)
    clean_name = re.sub(r'\s+', ' ', clean_name).strip()
    clean_name = re.sub(r'[^a-zA-Z0-9]+$', '', clean_name)

    return clean_name


def check_website(url):
    """
    Checks the status of a website for qualification scoring.
    Retries up to HTTP_RETRIES times with exponential backoff before declaring failure.
    Returns (status_code, has_ssl, response_time_seconds, error_msg)
    """
    if not url or url.strip() == "" or str(url).lower() == "nan":
        return None, False, 0, "No URL"

    if not url.startswith('http'):
        url = 'http://' + url

    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path

    has_ssl = False
    error_msg = None
    status_code = None
    response_time = 0

    # 1. Check SSL Certificate (fast port-443 check — no retry needed)
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=3) as sock:
            with context.wrap_socket(sock, server_hostname=domain):
                has_ssl = True
    except Exception:
        has_ssl = False

    # 2. Check Website Status & Speed — retry on transient failures
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/91.0.4472.124 Safari/537.36'
    }
    check_url = f"https://{domain}" if has_ssl else f"http://{domain}"

    backoff = RETRY_BACKOFF
    for attempt in range(1, HTTP_RETRIES + 1):
        try:
            start_time = time.time()
            response = requests.get(check_url, headers=headers, timeout=5, allow_redirects=True)
            response_time = time.time() - start_time
            status_code = response.status_code
            error_msg = f"HTTP Error {response.status_code}" if response.status_code >= 400 else None
            break  # success — stop retrying
        except requests.exceptions.RequestException:
            if attempt < HTTP_RETRIES:
                time.sleep(backoff)
                backoff *= 2  # exponential backoff
            else:
                error_msg = "Connection Failed"
                status_code = 0

    return status_code, has_ssl, response_time, error_msg


def qualify_lead(lead):
    score = 0
    tag = "LOW"
    reason = []

    website = lead.get("website", lead.get("Website", "")).strip()

    if not website or website == "" or website.lower() == "nan":
        score = 10
        reason.append("No website")
    else:
        status_code, has_ssl, response_time, error_msg = check_website(website)

        if error_msg:
            score = 9
            reason.append(f"Broken website ({error_msg})")
        elif not has_ssl:
            score = 7
            reason.append("HTTP only (Missing SSL)")
        elif response_time > 3.0:
            score = 6
            reason.append(f"Slow website ({response_time:.1f}s)")
        else:
            score = 2
            reason.append("Good website")

    # ── Bonus: low review count signals a high-growth opportunity ─────────────
    raw_reviews = str(lead.get('review_count', lead.get('Review Count', '0')))
    review_count = int(re.sub(r'[^\d]', '', raw_reviews) or 0)
    if review_count < 50:
        score += 2
        reason.append(f"Low review count ({review_count})")

    # Determine tag based on final score
    if score >= 7:
        tag = "HOT"
    elif score >= 4:
        tag = "WARM"
    else:
        tag = "LOW"

    return score, tag, " | ".join(reason)


def main():
    if len(sys.argv) < 2:
        print("Usage: python qualifier.py <input_csv_path>")
        sys.exit(1)

    input_file = sys.argv[1]

    base_name, ext = os.path.splitext(input_file)
    output_file = f"{base_name}_qualified{ext}"

    print(f"Starting Lead Qualification Agent...")
    print(f"Reading from {input_file}...")

    try:
        with open(input_file, mode='r', encoding='utf-8') as infile:
            reader = csv.DictReader(infile)
            fieldnames = list(reader.fieldnames) + ["Opportunity Score", "Lead Tag", "Qualification Reason"]
            leads = list(reader)

        print(f"Found {len(leads)} leads. Qualifying in parallel (workers={MAX_WORKERS})...")

        # Clean business names before parallel processing
        for lead in leads:
            raw_name = lead.get('business_name', lead.get('Name', 'Unknown'))
            clean_name = clean_business_name(raw_name)
            if 'business_name' in lead:
                lead['business_name'] = clean_name
            elif 'Name' in lead:
                lead['Name'] = clean_name

        # ── Parallel qualification ─────────────────────────────────────────────
        # Map each lead to its index so we can preserve order
        results = [None] * len(leads)

        def _qualify_indexed(args):
            idx, lead = args
            return idx, qualify_lead(lead)

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(_qualify_indexed, (i, lead)): i for i, lead in enumerate(leads)}
            completed = 0
            for future in as_completed(futures):
                idx, (score, tag, reason_str) = future.result()
                results[idx] = (score, tag, reason_str)
                completed += 1
                b_name = leads[idx].get('business_name', leads[idx].get('Name', 'Unknown'))
                print(f"[{completed}/{len(leads)}] {b_name} → Score: {score} | {tag}")

        # Apply results back to leads
        qualified_leads = []
        for i, lead in enumerate(leads):
            score, tag, reason_str = results[i]
            lead["Opportunity Score"] = score
            lead["Lead Tag"] = tag
            lead["Qualification Reason"] = reason_str
            qualified_leads.append(lead)

        print(f"\nWriting qualified leads to {output_file}...")
        with open(output_file, mode='w', encoding='utf-8', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(qualified_leads)

        print("Qualification complete!")

    except FileNotFoundError:
        print(f"Error: Could not find {input_file}. Please make sure you have scraped leads first.")


if __name__ == "__main__":
    main()
