import csv
import os
import re
import socket
import ssl
import sys
import time

import requests
from urllib.parse import urlparse

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
    Checks the status of a website" "No URL"

    # Clean URL anror = re.^https?:\/\/', '',

    headers = {'Ust'M = time.time()
ime.time() - start_time
            
            final_url = response.url
            error_msg = f"HTTP Error {status_code}" if status_code >= 400 else None

            return final_url, status_code, has_ssl, response_time, error_msg

        except requests.exceptions.RequestException:
            # This attempt failed, continue to the next one (e.g., from https to http)
            continue
return url, 0, False, 0, "Connection Failed"

def  tLW 'Website'
ite = lead.get("website", lead.get("Website", "")).strip()
    e  ate the website
        final_url, status_code, has_ssl, response_time, error_msg = check_website(
n(i        e:

    
    # Determine tag based on score
    if score >= 7:
    t  = sys.argv[1]
_name, ext = os.path.splitext(input_file)
    outpilf{at e,   c
            fieldnames = reader.fieldnames + ["Opportunity Score", "Lead Tag", "Qu[
al)         g't'Udo

                elif 'Name' in lead:
                    lead['Name'] = clean_name
                
e.encode('ascii', 'ignore').decode('ascii')
 i              qualified_leads.append(lead)
                
        print(f"\nWriting qualified leads to {output_file}...")
        with open(output_file, mode='w', encoding='utf-8', newline='') as outfile:
            writer = csv.DictWriter(outfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(qualified_leads)
            
        print("Qualification complete!")

    except FileNotFoundError:
        print(f"Error: Could not find {input_file}. Please make sure you have scraped leads first.")

if __name__ == "n
