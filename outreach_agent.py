import os
import csv
import sys
import time
import random
import urllib.parse
from dotenv import load_dotenv
import requests
from qualifier import clean_business_name

# Load environment variables from .env file
load_dotenv()

# Vapi Credentials
VAPI_API_KEY = os.getenv('VAPI_API_KEY')
VAPI_ASSISTANT_ID = os.getenv('VAPI_ASSISTANT_ID')
VAPI_PHONE_NUMBER_ID = os.getenv('VAPI_PHONE_NUMBER_ID')

def load_leads(csv_path):
    if not os.path.exists(csv_path):
        print(f"Error: Could not find '{csv_path}'.")
        sys.exit(1)
        
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        return list(reader), reader.fieldnames

def dispatch_vapi_call(to_number, business_name, address, reason):
    try:
        if not VAPI_API_KEY or not VAPI_ASSISTANT_ID or not VAPI_PHONE_NUMBER_ID:
            print("  [Voice Skip] Vapi credentials not found in .env")
            return False
            
        formatted_number = to_number.strip()
        if not formatted_number.startswith("+"):
            formatted_number = "+1" + "".join(filter(str.isdigit, formatted_number))
            
        # Clean and shorten the business name and address for natural speech
        b_name = clean_business_name(business_name)
        
        # Reduce address to just city/state (e.g. "Houston, TX") for natural speech
        addr_parts = [p.strip() for p in address.split(',')]
        spoken_address = ', '.join(addr_parts[-2:]) if len(addr_parts) >= 2 else address
        if "Broken website" in reason:
            first_msg = random.choice([
                f"Hey, is this {b_name}? I was just trying to pull up your website and it looks like it might be down. Did you guys know about that?",
                f"Hey there, this is Alex. I was trying to find {b_name} online and the website seems to be having some issues. Is the owner around?",
                f"Hi, is this {b_name}? Yeah I just tried your website and it's showing an error. Is the person who handles the site available?",
            ])
        elif "No website" in reason:
            first_msg = random.choice([
                f"Hey, is this {b_name}? I was just searching for you guys online and couldn't find a website. Is the owner in today?",
                f"Hey, this is Alex. I was looking up {b_name} on Google and noticed there's no website showing up for your shop. Is that something you guys have been thinking about?",
                f"Hi, is this {b_name}? I was trying to look you guys up online but didn't see a website. Is the owner around by any chance?",
            ])
        else:
            first_msg = random.choice([
                f"Hey, is this {b_name}? I was looking at your site online and had an idea that could help bring in more walk-ins. Is the owner available?",
                f"Hey, this is Alex. I was checking out {b_name}'s website and had a thought to help you guys out. Is now an okay time?",
                f"Hi, is this {b_name}? I was looking at your shop online and was hoping to speak with whoever handles the website side of things.",
            ])
        
        # System prompt that guides the AI through the full conversation flow
        system_prompt = (
            f"You are Alex, a friendly and professional sales rep for a web design agency that builds websites for smoke shops. "
            f"You are calling {b_name}. Your goal is to build rapport, pitch the value of a professional website, "
            f"and close by getting their email address to send them a free custom demo. "
            f"Flow: 1) Open with your first message. 2) Listen to their response. 3) Briefly explain the value: "
            f"'We build fully custom websites for smoke shops — it takes about a week and most of our clients see more call-ins within the first month.' "
            f"4) Ask if you can send them a free demo: 'I actually already put together a quick demo for your shop. Would it be cool if I sent it over?' "
            f"5) If they say yes, ask for their email: 'Perfect — what email should I send it to?' "
            f"6) Repeat the email back clearly to confirm it. "
            f"7) Close warmly: 'Awesome, you'll have it in your inbox shortly. Talk soon!' "
            f"Keep the tone conversational, friendly, and never pushy. If they say no or not interested, thank them and hang up."
        )
            
        url = "https://api.vapi.ai/call/phone"
        headers = {
            "Authorization": f"Bearer {VAPI_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "phoneNumberId": VAPI_PHONE_NUMBER_ID,
            "assistantId": VAPI_ASSISTANT_ID,
            "customer": {
                "number": formatted_number,
                "name": b_name
            },
            "assistantOverrides": {
                "firstMessage": first_msg
            }
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        
        if response.status_code in [200, 201]:
            data = response.json()
            print(f"  [Voice Call Dispatched] Vapi Call ID: {data.get('id')}")
            return True
        else:
            print(f"  [Voice Call Error] Status {response.status_code}: {response.text}")
            return False
            
    except Exception as e:
        print(f"  [Voice Error] Failed to dispatch Vapi call: {e}")
        return False

DEMO_BASE_URL = os.getenv('DEMO_BASE_URL', 'https://smoke-shop-premium-demo.netlify.app')

def generate_demo_url(business_name, city):
    """
    Generates a personalized demo URL by appending shop name and city as query params.
    Example: https://demo.netlify.app/?name=Cloud+9+Smoke+Shop&city=Houston
    """
    b_name = clean_business_name(business_name)
    params = urllib.parse.urlencode({'name': b_name, 'city': city})
    return f"{DEMO_BASE_URL}?{params}"



def run_outreach(csv_path):
    print("Initializing Outreach Agent...")
    leads, headers = load_leads(csv_path)
    
    # Initialize Clients
    if VAPI_API_KEY:
        print("Vapi Configuration Found.")
    else:
        print("Warning: Vapi Credentials missing.")

    print(f"Loaded {len(leads)} leads. Scanning for HOT targets...")
    
    hot_count = 0
    contacted_count = 0
    
    # Add an Outreach Status column if it doesn't exist
    if "Outreach Status" not in headers:
         headers.append("Outreach Status")
         
    for lead in leads:
        b_name = lead.get('business_name', lead.get('Name', 'Unknown')).strip().encode('ascii','ignore').decode('ascii')
        tag = lead.get('Lead Tag', '')
        score = lead.get('Opportunity Score', '0')
        reason = lead.get('Qualification Reason', '')
        phone = lead.get('phone', '').strip()
        address = lead.get('address', '').strip()
        email = lead.get('Email', '').strip() # Assuming we have an email column later
        
        # Skip previously contacted leads
        if lead.get('Outreach Status') == 'Contacted':
            continue

        if tag == "HOT":
            hot_count += 1
            print(f"\n[HOT LEAD] {b_name} | Score: {score}")
            
            voice_sent = False
            
            # Voice Call via Vapi
            if phone:
                 print(f"  Attempting AI Voice Call to {phone}...")
                 if VAPI_API_KEY and VAPI_ASSISTANT_ID:
                     voice_sent = dispatch_vapi_call(phone, b_name, address, reason)
                 else:
                     print(f"  [Dry Run Voice Call] -> {b_name} on {phone}")
            else:
                 print("  [Voice Skip] No phone number provided in CSV.")
                 
            # Note: We previously sent an SMS here. Since Twilio is removed,
            # we rely on the Vapi call agent collecting an email, or calling them back.
            
            # Mark as contacted if we actually sent something
            if voice_sent:
                lead['Outreach Status'] = 'Contacted'
                contacted_count += 1
                
            # Small delay to mimic human speed / avoid rapid fire blocks
            time.sleep(1)
            
    # Save the updated leads CSV
    try:
        output_csv = csv_path.replace(".csv", "_outreached.csv")
        with open(output_csv, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=headers)
            writer.writeheader()
            writer.writerows(leads)
        print(f"\nOutreach complete! Data saved to {output_csv}")
    except Exception as e:
        print(f"\nFailed to save updated CSV: {e}")

    print(f"\n--- Summary ---")
    print(f"HOT Leads Evaluated: {hot_count}")
    print(f"Successfully Contacted: {contacted_count}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python outreach_agent.py <path_to_qualified_csv>")
        sys.exit(1)
        
    run_outreach(sys.argv[1])
