import os
from playwright.sync_api import sync_playwright

def run_qa_check(deployed_url, shop_slug):
    """
    Automated Quality Assurance Bot
    Visits the deployed URL, checks for critical elements, and takes a screenshot.
    Returns True if passed, False if failed.
    """
    print(f"\n[QA AGENT] Starting Automated Quality Check for:")
    print(f"  URL: {deployed_url}")
    
    os.makedirs("qa_reports", exist_ok=True)
    screenshot_path = f"qa_reports/{shop_slug}_passed.png"
    
    with sync_playwright() as p:
        # Launch headless Chromium browser
        browser = p.chromium.launch(headless=True)
        # Emulate a typical desktop screen
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        
        try:
            # Go to the newly deployed site
            response = page.goto(deployed_url, timeout=45000)
            
            if not response or not response.ok:
                print(f"  [ERROR] ERROR: Site returned status {response.status if response else 'UNKNOWN'}")
                return False

            # Wait for any dynamic content/animations to settle
            page.wait_for_load_state('networkidle')
            
            checks_passed = True
            
            # --- ASSERTION 1: Hero Section ---
            if not page.locator('.hero').is_visible():
                print("  [ERROR] FAILED: Hero section is missing or invisible!")
                checks_passed = False
            else:
                print("  [OK] Hero section rendered successfully.")
                
            # --- ASSERTION 2: Pricing Section ---
            if not page.locator('#pricing').is_visible():
                print("  [ERROR] FAILED: Pricing section is missing or invisible!")
                checks_passed = False
            else:
                print("  [OK] Pricing tier section verified.")

            # --- ASSERTION 3: Contact/Lead Form ---
            if not page.locator('#leadForm').is_visible():
                print("  [ERROR] FAILED: Secure lead form is missing or invisible!")
                checks_passed = False
            else:
                print("  [OK] Lead capture form is functional.")
                
            # Take a full page "Proof of Life" screenshot
            page.screenshot(path=screenshot_path, full_page=True)
            print(f"  [OK] QA Screenshot saved to: {screenshot_path}")
            
            if checks_passed:
                print("\n  [SUCCESS] QA PASSED: Site is fully functional and ready for client delivery!")
            else:
                print("\n  [WARNING] QA FAILED: Site is missing critical components. Holding deployment.")
                
            return checks_passed
            
        except Exception as e:
            print(f"  [FATAL] QA FATAL ERROR: Could not connect to the site. {e}")
            return False
        finally:
            browser.close()

if __name__ == "__main__":
    # Test Payload - Running QA on your own demo wrapper
    test_url = "https://smoke-shop-premium-demo.netlify.app"
    test_slug = "demo-wrapper-test"
    
    run_qa_check(test_url, test_slug)
