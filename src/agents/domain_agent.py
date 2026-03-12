import os
import subprocess
from dotenv import load_dotenv

load_dotenv()

def bind_custom_domain(deploy_dir, custom_domain):
    """
    Automated Script to link a custom domain to a Vercel project.
    Note: You must own the domain or have DNS control over it for it to go live.
    This script attaches the domain to the Vercel project programmatically.
    """
    print(f"\n[DOMAIN AGENT] Binding Custom Domain: {custom_domain}...")
    
    if not os.path.exists(deploy_dir):
        print(f"  ❌ ERROR: Deployment directory {deploy_dir} does not exist.")
        return False
        
    try:
        # Vercel CLI command to add a domain to the current linked project
        # `npx vercel domains add <domain>`
        print(f"  Executing Vercel CLI command...")
        
        result = subprocess.run(
            ["npx", "vercel", "domains", "add", custom_domain, "--yes"],
            cwd=deploy_dir,
            capture_output=True,
            text=True,
        )
        
        output = result.stdout.strip()
        errors = result.stderr.strip()
        
        # We check the output for success keywords (Vercel usually says "Success!" or "is now active" or "Added...")
        if "Success" in output or "Added" in output or result.returncode == 0:
            print(f"  🎉 SUCCESS! Domain {custom_domain} bound to project.")
            print(f"  ⚠️ Action Required: Ensure your DNS records (A Record or CNAME) on your registrar point to Vercel!")
            print(f"     A Record: 76.76.21.21")
            print(f"     Alternatively, change nameservers to Vercel's nameservers.")
            return True
        else:
            # Maybe the domain is already added
            if "already exists" in errors or "already exists" in output:
                print(f"  [OK] Domain {custom_domain} is already attached to this project.")
                return True
                
            print(f"  [Error] Failed to add domain.\nOutput: {output}\nErrors: {errors}")
            return False
            
    except Exception as e:
        print(f"  ❌ FATAL ERROR running domain command: {e}")
        return False

if __name__ == "__main__":
    # Test Payload - Attaching a domain to our demo wrapper test
    test_deploy_dir = "deployments/demo-wrapper-test"
    
    # This domain must be one you actually plan to configure DNS for,
    # otherwise Vercel will just sit in "Pending Configuration".
    test_domain = "premiumsmokeshoptx.com" 
    
    # We won't actually run it by default to avoid cluttering your real Vercel account with fake domains
    print("Run this directly to test custom domain attachment. Make sure you own the domain or plan to buy it.")
    # bind_custom_domain(test_deploy_dir, test_domain)
