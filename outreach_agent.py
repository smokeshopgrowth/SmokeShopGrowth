import os
import csv
import sys
import time
import random
import urllib.parse
from dotenv import load_dotenv
from twilio.rest import Client
import requests
from qualifier import clean_business_name

# Load environment variables from .env file
load_dotenv()

# Twilio Credentials
TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
TWILIO_PHONE_NUMBER = os.getenv('TWILIO_PHONE_NUMBER')

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

def send_sms(client, to_number, message_body):
    try:
        if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
            print("  [SMS Skip] Twilio credentials not found in .env")
            return False
            
        # Basic phone formatting check for Twilio (requires E.164 usually)
        # Assuming US numbers for this script
        formatted_number = to_number.strip()
        if not formatted_number.startswith("+"):
            formatted_number = "+1" + "".join(filter(str.isdigit, formatted_number))
            if len(formatted_number) == 2: # Only "+1"
                print(f"  [SMS Skip] Invalid phone number format: {to_number}")
                return False

        message = client.messages.create(
            body=message_body,
            from_=TWILIO_PHONE_NUMBER,
            to=formatted_number
        )
        print(f"  [SMS Sent] Message SID: {message.sid}")
        return True
    except Exception as e:
        print(f"  [SMS Error] Failed to send SMS: {e}")
        return False

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
                f"Hey, is this {b_name}? Hey real quick, I tried pulling up your website just now and it doesn't seem to be loading. Did you guys know about that?",
                f"Hey there, this is Alex. I was trying to find {b_name} online and the website looks like it might be down. Is the owner around?",
                f"Hey, is this {b_name}? Yeah I just tried your website and it's showing an error. Quick question for whoever handles the site.",
            ])
        elif "No website" in reason:
            first_msg = random.choice([
                f"Hey, is this {b_name}? Quick question, I was just searching for you guys online and noticed there's no website showing up. Is the owner in?",
                f"Hey, this is Alex. I was looking up {b_name} on Google and couldn't find a website for you guys. Is that something you've been thinking about?",
                f"Hey, is this {b_name}? I was looking you guys up online and noticed there's no website showing up for your shop. Is the owner in?",
            ])
        else:
            first_msg = random.choice([
                f"Hey, is this {b_name}? Real quick, I was looking at your site online and had an idea that could bring in more customers. Is the owner available?",
                f"Hey, this is Alex. I was checking out {b_name}'s website and had a thought that could help you guys get more walk-ins. Is now an okay time?",
                f"Hey, is this {b_name}? I was looking at your shop online and had a quick question for whoever handles the website side of things.",
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


def generate_sms_script(business_name, address, reason):
    # Short and punchy for SMS
    b_name = clean_business_name(business_name)
    
    script = f"Hey {b_name}, I noticed your vape shop on {address} doesn't have a modern website. "
    
    if "Broken website" in reason:
        script = f"Hey {b_name}, I noticed your website is currently down or broken! "
    elif "No website" in reason:
        script = f"Hey {b_name}, I noticed your shop on {address} doesn't have a website yet. "
        
    script += "I build high-converting sites for smoke shops that handle inventory and drive local traffic. Text back if you want to see a free custom demo I made for you!"
    return script



def run_outreach(csv_path):
    print("Initializing Outreach Agent...")
    leads, headers = load_leads(csv_path)
    
    # Initialize Clients
    twilio_client = None
    if TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN:
        try:
            twilio_client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            print("Twilio Client Initialized.")
        except Exception as e:
            print(f"Warning: Failed to init Twilio: {e}")
            
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
            
            sms_sent = False
            voice_sent = False
            
            # SMS
            if phone:
                print(f"  Attempting SMS to {phone}...")
                sms_script = generate_sms_script(b_name, address, reason)
                if twilio_client:
                    # In a real run without credentials, this will just return False
                    sms_sent = send_sms(twilio_client, phone, sms_script)
                else:
                    print(f"  [Dry Run SMS] -> {sms_script}")
            else:
                print("  [SMS Skip] No phone number provided in CSV.")
                
            # Voice Call via Vapi — prime them to receive the SMS
            if phone:
                 print(f"  Attempting AI Voice Call to {phone}...")
                 if VAPI_API_KEY and VAPI_ASSISTANT_ID:
                     voice_sent = dispatch_vapi_call(phone, b_name, address, reason)
                 else:
                     print(f"  [Dry Run Voice Call] -> {b_name} on {phone}")
            else:
                 print("  [Voice Skip] No phone number provided in CSV.")
                 
            # Demo Link Follow-Up SMS fired right after the voice call
            if phone and voice_sent:
                addr_parts = [p.strip() for p in address.split(',')]
                city = addr_parts[-2] if len(addr_parts) >= 2 else address
                demo_url = generate_demo_url(b_name, city)
                demo_sms = f"Hey! This is Alex — I just called about your website. Here's the free custom demo I built for {b_name}: {demo_url} \nReply YES if you want it live this week!"
                print(f"  Sending Demo Link SMS to {phone}...")
                if twilio_client:
                    send_sms(twilio_client, phone, demo_sms)
                else:
                    print(f"  [Dry Run Demo SMS] -> {demo_sms}")
                 
            # Mark as contacted if we actually sent something
            if sms_sent or voice_sent:
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
