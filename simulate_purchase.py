import os
import time
from dotenv import load_dotenv
from webhook import update_crm_payment, trigger_site_deployment

load_dotenv()

def run_simulation():
    print("=====================================================")
    print("   [*] SMOKE SHOP GROWTH - FULL PIPELINE SIMULATION   ")
    print("=====================================================")
    print(f"Time: {time.ctime()}")
    print("\n[SIMULATION] Triggering Simulated Stripe checkout.session.completed Event...\n")
    
    # Mock Customer Data (Usually comes from Stripe Checkout payload)
    mock_email = "testowner@cloud9smokeshop.com"
    mock_ref_id = "test_lead_id_777"
    
    # --- PHASE 1: CRM UPDATE ---
    print(">>> PHASE 1: CRM Update (Marking as PAID)")
    update_crm_payment(mock_email, mock_ref_id)
    time.sleep(2)
    
    # --- PHASE 2: DEPLOYMENT & DELIVERY ---
    print("\n>>> PHASE 2: Automated Deployment, QA, & Delivery")
    # This will call trigger_site_deployment which:
    # 1. Calls deploy_agent.py (Clones template, injects data, runs Vercel deploy)
    # 2. Inside deploy_agent, if successful -> Calls qa_agent.py (Playwright check)
    # 3. Inside deploy_agent, if custom_domain -> Calls domain_agent.py
    # 4. Back in webhook logic -> Calls delivery_agent.py (Twilio/SendGrid)
    
    trigger_site_deployment(mock_email, mock_ref_id)
    
    print("\n=====================================================")
    print("   [*] FULL PIPELINE SIMULATION COMPLETE ")
    print("=====================================================")

if __name__ == "__main__":
    # Ensure Vercel is logged in
    print("Checking Vercel CLI Authentication before simulation...")
    import subprocess
    result = subprocess.run(["npx", "vercel", "whoami"], capture_output=True, text=True)
    if "Error" in result.stderr or result.returncode != 0:
        print("[WARNING] You may not be logged into Vercel CLI. Run `npx vercel login` first.")
    else:
        print(f"[OK] Logged into Vercel as: {result.stdout.strip()}")
        
    print("\nBeginning the automated pipeline simulation...")
    run_simulation()
