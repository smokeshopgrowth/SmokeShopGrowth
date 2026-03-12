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
    
    # Mock Customer Data — simulates what Stripe would send
    mock_email = "testowner@cloud9smokeshop.com"
    mock_ref_id = "test_lead_id_777"
    mock_stripe_metadata = {
        "business_name": "Cloud 9 Smoke Shop",
        "city": "Houston",
        "tier": "growth",
    }
    
    # --- PHASE 1: CRM UPDATE ---
    print(">>> PHASE 1: CRM Update (Marking as PAID)")
    update_crm_payment(mock_email, mock_ref_id)
    time.sleep(2)
    
    # --- PHASE 2: DEPLOYMENT & DELIVERY ---
    # This now:
    # 1. Looks up real lead data from Google Sheets CRM
    # 2. Falls back to Stripe metadata if CRM lookup fails
    # 3. Deploys via deploy_agent.py (clone template → inject config → Vercel)
    # 4. Runs QA via qa_agent.py (Playwright headless checks)
    # 5. Binds custom domain if provided (domain_agent.py)
    # 6. Sends welcome email + enrolls in upsell drip (delivery_agent.py)
    # 7. Logs failures to retry queue (error_handler.py)
    print("\n>>> PHASE 2: Automated Deployment, QA, & Delivery")
    trigger_site_deployment(mock_email, mock_ref_id, mock_stripe_metadata)
    
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
