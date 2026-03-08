import csv
import time
import requests
from urllib.parse import urlparse
import socket
import ssl
import re

def clean_business_name(name):
    """
    Cleans Google Maps business names to keep them simple and short.
    Example: 'Cloud 9 Smoke Shop | Vape | CBD | Kratom' -> 'Cloud 9 Smoke Shop'
    """
    if not name:
        return "Unknown Shop"
        
    # Split on common advertising delimiters and take the first part
    delimiters = ['|', '-', '–', '—', ':', ',', '(']
    
    clean_name = name
    for delim in delimiters:
        if delim in clean_name:
            clean_name = clean_name.split(delim)[0]
            
    clean_name = clean_name.strip()
    
    # Remove common trailing keywords
    clean_name = re.sub(r'(?i)\bl\b\.\bl\b\.\bc\b\.?', '', clean_name)
    clean_name = re.sub(r'(?i)\bllc\b', '', clean_name)
    clean_name = re.sub(r'(?i)\binc\.?\b', '', clean_name)
    clean_name = re.sub(r'\s+', ' ', clean_name).strip()
    
    # Strip any trailing non-alphanumeric chars
    clean_name = re.sub(r'[^a-zA-Z0-9]+$', '', clean_name)
    
    return clean_name

# Opportunity Score Reference:
# No website: 10
# Broken website: 9
# HTTP only (No SSL): 7
# Slow website (>3s response): 6
# Good website: 2

def check_website(url):
    """
    Checks the status of a website for qualification scoring.
    Returns (status_code, has_ssl, response_time_seconds, error_msg)
    """
    if not url or url.strip() == "" or str(url).lower() == "nan":
        return None, False, 0, "No URL"

    # Ensure URL has scheme for requests
    original_url = url
    if not url.startswith('http'):
        url = 'http://' + url

    parsed = urlparse(url)
    domain = parsed.netloc or parsed.path

    has_ssl = False
    error_msg = None
    status_code = None
    response_time = 0

    # 1. Check SSL Certificate (Fast port 443 check)
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, 443), timeout=3) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as ssock:
                has_ssl = True
    except Exception:
        has_ssl = False

    # 2. Check Website Status & Speed
    try:
        # Use a real user agent to prevent basic bot blocking
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'}
        # Check HTTPS first if it has SSL, otherwise HTTP
        check_url = f"https://{domain}" if has_ssl else f"http://{domain}"
        
        start_time = time.time()
        response = requests.get(check_url, headers=headers, timeout=5, allow_redirects=True)
        response_time = time.time() - start_time
        status_code = response.status_code

        if response.status_code >= 400:
            error_msg = f"HTTP Error {response.status_code}"

    except requests.exceptions.RequestException as e:
        error_msg = "Connection Failed"
        status_code = 0

    return status_code, has_ssl, response_time, error_msg


def qualify_lead(lead):
    score = 0
    tag = "LOW"
    reason = []

    # Try lowercase 'website' first, then title case 'Website'
    website = lead.get("website", lead.get("Website", "")).strip()
    
    # Check if there's no website at all
    if not website or website == "" or website.lower() == "nan":
        score = 10
        reason.append("No website")
    else:
        # Evaluate the website
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

    # Determine tag based on score
    if score >= 7:
        tag = "HOT"
    elif score >= 4:
        tag = "WARM"
    else:
        tag = "LOW"

    return score, tag, " | ".join(reason)

import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: python qualifier.py <input_csv_path>")
        sys.exit(1)
        
    input_file = sys.argv[1]
    
    # Generate output filename
    base_name, ext = os.path.splitext(input_file)
    output_file = f"{base_name}_qualified{ext}"
    
    print(f"Starting Lead Qualification Agent...")
    print(f"Reading from {input_file}...")
    
    try:
        with open(input_file, mode='r', encoding='utf-8') as infile:
            reader = csv.DictReader(infile)
            fieldnames = reader.fieldnames + ["Opportunity Score", "Lead Tag", "Qualification Reason"]
            
            leads = list(reader)
            print(f"Found {len(leads)} leads to qualify.")
            
            qualified_leads = []
            
            for i, lead in enumerate(leads):
                raw_name = lead.get('business_name', lead.get('Name', 'Unknown'))
                clean_name = clean_business_name(raw_name)
                
                # Update the original dict to export the clean name to the CSV
                if 'business_name' in lead:
                    lead['business_name'] = clean_name
                elif 'Name' in lead:
                    lead['Name'] = clean_name
                
                b_name_safe = clean_name.encode('ascii', 'ignore').decode('ascii')
                print(f"[{i+1}/{len(leads)}] Qualifying: {b_name_safe}...", end=" ", flush=True)
                
                score, tag, reason = qualify_lead(lead)
                
                lead["Opportunity Score"] = score
                lead["Lead Tag"] = tag
                lead["Qualification Reason"] = reason
                
                print(f"Score: {score} | Tag: {tag}")
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
