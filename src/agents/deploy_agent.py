import json
import os
import shutil
import subprocess
from dotenv import load_dotenv
from qa_agent import run_qa_check
from domain_agent import bind_custom_domain

load_dotenv()

def deploy_shop_website(lead_data):
    """
    Given a lead's data, this function:
    1. Clones the 'template' directory.
    2. Overwrites 'config.js' with the lead's personalized data.
    3. Deploys the new site to Vercel.
    """
    shop_slug = lead_data.get('business_name', 'smoke-shop').lower().replace(' ', '-').replace("'", "")
    deploy_dir = f"deployments/{shop_slug}"
    
    print(f"\n[DEPLOY AGENT] Preparing deployment for {lead_data.get('business_name')}...")
    
    # 1. Clone Template into a unique deployment folder
    if os.path.exists(deploy_dir):
        shutil.rmtree(deploy_dir)
    
    # Ensure the deployments folder exists
    os.makedirs("deployments", exist_ok=True)
    
    try:
        shutil.copytree("template", deploy_dir)
        print(f"  [*] Cloned template to {deploy_dir}")
    except Exception as e:
        print(f"  [Error] Failed to clone template: {e}")
        return None

    # 2. Inject Data into config.js
    config_js_path = os.path.join(deploy_dir, "config.js")
    
    config_data = {
        "name": lead_data.get('business_name'),
        "city": lead_data.get('city'),
        "phone": lead_data.get('phone'),
        "address": lead_data.get('address'),
        "hours": lead_data.get('hours', 'Open Daily 9am - 10pm'),
        "instagram": lead_data.get('instagram', 'https://instagram.com/'),
        "googleMaps": lead_data.get('maps_url', 'https://maps.google.com'),
        "heroImage": "https://images.unsplash.com/photo-1579761925697-3fadcc9eac04?q=80&w=1974&auto=format&fit=crop",
        "categories": ["Vapes", "Glass", "CBD", "Kratom", "Hookah", "Cigars"],
        "testimonials": [
            {"quote": f"Best selection in {lead_data.get('city')}. Phenomenal prices.", "name": "Local Guide", "role": "Customer", "stars": 5},
            {"quote": "Super clean and the staff is incredibly helpful.", "name": "Verified Buyer", "role": "Customer", "stars": 5},
        ],
    }
    js_content = f"// AUTO-GENERATED CONFIG FOR {lead_data.get('business_name')}\nwindow.BUSINESS = {json.dumps(config_data, indent=2)};\n"
    
    with open(config_js_path, "w") as f:
        f.write(js_content)
    print(f"  [*] Injected shop-specific data into config.js")
        
    print(f"\n[DEPLOY AGENT] Triggering Vercel Production Build...")
    
    # 3. Deploy using Vercel CLI
    # It executes 'npx vercel --prod --yes' inside the clone directory to skip prompts
    try:
        # Note: the user must be authenticated with Vercel CLI locally or have VERCEL_TOKEN linked
        result = subprocess.run(
            ["npx", "vercel", "--prod", "--yes"],
            cwd=deploy_dir,
            capture_output=True,
            text=True,
        )

        # Vercel outputs the production URL to stdout
        output = result.stdout.strip()
        errors = result.stderr.strip()
        
        # The URL usually starts with https:// 
        deployed_url = None
        for line in (output + "\n" + errors).split("\n"):
            if line.startswith("https://") and "vercel.app" in line:
                 deployed_url = line

        if deployed_url:
            print(f"\n  [*] SUCCESS! Website is live at: {deployed_url}")
            
            # --- Run Automated Quality Assurance ---
            print(f"\n  [*] Running Post-Deployment QA...")
            qa_passed = run_qa_check(deployed_url, shop_slug)
            
            if not qa_passed:
                print(f"  [Error] Deployment completed but QA failed. Review required.")
                return None
                
            # --- Optional: Bind Custom Domain ---
            custom_domain = lead_data.get('custom_domain')
            if custom_domain:
                bind_custom_domain(deploy_dir, custom_domain)
                
            return deployed_url
        else:
            print(f"\n  [Error] Vercel deployed but could not extract URL.\nOutput: {output}\nErrors: {errors}")
            return None
            
    except Exception as e:
        print(f"  [Error] Deployment subprocess failed: {e}")
        return None


if __name__ == "__main__":
    # Test Payload - This models the data that Stripe/the CRM would pass
    test_lead = {
        "business_name": "Cloud 9 Smoke Shop",
        "city": "Houston",
        "phone": "(713) 555-9999",
        "address": "123 Cloud St, Houston, TX 77002",
        "maps_url": "https://maps.google.com/?q=Cloud+9",
        "custom_domain": None # "cloud9smokeshophtx.com" 
    }
    
    deploy_shop_website(test_lead)
