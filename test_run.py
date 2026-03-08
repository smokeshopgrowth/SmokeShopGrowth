import os
from dotenv import load_dotenv
from outreach_agent import generate_sms_script, send_sms
from twilio.rest import Client

load_dotenv()

def main():
    target_number = "+17134916004"
    print(f"Executing Test Run to {target_number}...\n")
    
    # Basic setup
    TWILIO_ACCOUNT_SID = os.getenv('TWILIO_ACCOUNT_SID')
    TWILIO_AUTH_TOKEN = os.getenv('TWILIO_AUTH_TOKEN')
    
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN:
        print("[ERROR] Missing Twilio credentials in .env! Cannot send a live SMS.")
        return
        
    try:
        client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    except Exception as e:
        print(f"[ERROR] Failed to authenticate with Twilio: {e}")
        return
    
    # Mock Lead Data
    business_name = "Cloud 9 Smoke Shop"
    address = "123 Main St, Austin TX"
    reason = "Broken website"
    
    # Test 1: Outreach SMS
    outreach_sms = generate_sms_script(business_name, address, reason)
    print(f"[Test 1] Outreach SMS Script:\n\"{outreach_sms}\"")
    print("Sending Outreach SMS...")
    
    success = send_sms(client, target_number, outreach_sms)
    if success:
        print("[SUCCESS] Outreach SMS sent!\n")
    else:
        print("[FAILED] Outreach SMS failed. Check Twilio logs/funds.\n")
        
    # Test 2: Delivery SMS
    live_url = "https://cloud9smokeshop-demo.vercel.app"
    delivery_sms = f"Hey from the SmokeShopGrowth Team! Your new site for {business_name} is fully built and deployed. Check it out here: {live_url}"
    
    print(f"[Test 2] Delivery SMS Script:\n\"{delivery_sms}\"")
    print("Sending Delivery SMS...")
    
    success2 = send_sms(client, target_number, delivery_sms)
    
    if success2:
        print("[SUCCESS] Delivery SMS sent!\n")
    else:
        print("[FAILED] Delivery SMS failed.\n")

if __name__ == "__main__":
    main()
