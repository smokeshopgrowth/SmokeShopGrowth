import json
import os
import re
import shutil
import subprocess
from dotenv import load_dotenv
from qa_agent import run_qa_check
from domain_agent import bind_custom_domain

load_dotenv()

OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')


def generate_testimonials(shop_name, city, rating, review_count):
    """
    Uses OpenAI to generate 2 realistic customer testimonials based on the
    shop's actual rating and review count. Falls back to generic quotes if
    OpenAI is unavailable.
    """
    # Fallback testimonials (always available, no API required)
    fallback = [
        {"quote": f"Best selection in {city}. Phenomenal prices.", "name": "Local Guide",    "role": "Customer", "stars": 5},
        {"quote": "Super clean store and the staff is incredibly helpful.",  "name": "Verified Buyer", "role": "Customer", "stars": 5},
    ]

    if not OPENAI_API_KEY:
        return fallback

    try:
        import requests as _requests

        rating_str = f"{float(rating):.1f}" if rating else "4.5"
        reviews_str = str(review_count) if review_count else "a handful of"

        prompt = (
            f"Write exactly 2 short, realistic customer reviews for a smoke shop called '{shop_name}' "
            f"in {city}. The shop has a {rating_str}-star rating based on {reviews_str} Google reviews. "
            f"Each review should be 1–2 sentences, written in casual first-person, and highlight something "
            f"specific (selection, prices, staff, location, or atmosphere). "
            f"Return ONLY a JSON array with 2 objects, each having keys: quote, name, role ('Customer'), stars (integer 4 or 5). "
            f"Example: [{{'quote': '...', 'name': 'John D.', 'role': 'Customer', 'stars': 5}}]"
        )

        response = _requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": "gpt-4o-mini",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.8,
                "max_tokens": 300,
            },
            timeout=15,
        )

        if response.status_code == 200:
            text = response.json()["choices"][0]["message"]["content"].strip()
            # Strip markdown fences if present
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
            testimonials = json.loads(text)
            if isinstance(testimonials, list) and len(testimonials) == 2:
                print(f"  [*] AI-generated testimonials for {shop_name}")
                return testimonials

    except Exception as e:
        print(f"  [Testimonials] Falling back to generic quotes ({e})")

    return fallback


def deploy_shop_website(lead_data):
    """
    Given a lead's data, this function:
    1. Clones the 'template' directory.
    2. Overwrites 'config.js' with the lead's personalized data.
    3. Deploys the new site to Vercel (using --json for reliable URL extraction).
    """
    shop_slug  = lead_data.get('business_name', 'smoke-shop').lower().replace(' ', '-').replace("'", "")
    deploy_dir = f"deployments/{shop_slug}"

    print(f"\n[DEPLOY AGENT] Preparing deployment for {lead_data.get('business_name')}...")

    # 1. Clone Template into a unique deployment folder
    if os.path.exists(deploy_dir):
        shutil.rmtree(deploy_dir)

    os.makedirs("deployments", exist_ok=True)

    try:
        shutil.copytree("template", deploy_dir)
        print(f"  [*] Cloned template to {deploy_dir}")
    except Exception as e:
        print(f"  [Error] Failed to clone template: {e}")
        return None

    # 2. Generate AI testimonials using real shop data
    city         = lead_data.get('city', '')
    rating       = lead_data.get('rating', '')
    review_count = lead_data.get('review_count', '')
    testimonials = generate_testimonials(
        shop_name=lead_data.get('business_name', 'this shop'),
        city=city,
        rating=rating,
        review_count=review_count,
    )

    # 3. Inject Data into config.js
    config_js_path = os.path.join(deploy_dir, "config.js")

    config_data = {
        "name":         lead_data.get('business_name'),
        "city":         city,
        "phone":        lead_data.get('phone'),
        "address":      lead_data.get('address'),
        "hours":        lead_data.get('hours', 'Open Daily 9am - 10pm'),
        "instagram":    lead_data.get('instagram', 'https://instagram.com/'),
        "googleMaps":   lead_data.get('maps_url', 'https://maps.google.com'),
        "heroImage":    "https://images.unsplash.com/photo-1579761925697-3fadcc9eac04?q=80&w=1974&auto=format&fit=crop",
        "categories":   ["Vapes", "Glass", "CBD", "Kratom", "Hookah", "Cigars"],
        "testimonials": testimonials,
    }
    js_content = f"// AUTO-GENERATED CONFIG FOR {lead_data.get('business_name')}\nwindow.BUSINESS = {json.dumps(config_data, indent=2)};\n"

    with open(config_js_path, "w") as f:
        f.write(js_content)
    print(f"  [*] Injected shop-specific data into config.js")

    print(f"\n[DEPLOY AGENT] Triggering Vercel Production Build...")

    # 4. Deploy using Vercel CLI with --json for structured output
    try:
        result = subprocess.run(
            ["npx", "vercel", "--prod", "--yes", "--json"],
            cwd=deploy_dir,
            capture_output=True,
            text=True,
        )

        deployed_url = None

        # Primary: parse structured JSON output
        try:
            data = json.loads(result.stdout.strip())
            raw_url = data.get("url") or data.get("deploymentUrl") or data.get("alias", [None])[0]
            if raw_url:
                deployed_url = raw_url if raw_url.startswith("https://") else f"https://{raw_url}"
        except (json.JSONDecodeError, Exception):
            pass

        # Fallback: scan all lines for a vercel.app URL (handles older CLI versions)
        if not deployed_url:
            for line in (result.stdout + "\n" + result.stderr).split("\n"):
                line = line.strip()
                if line.startswith("https://") and "vercel.app" in line:
                    # Prefer production URL over preview URLs (production contains no git hash)
                    if ".vercel.app" in line and line.count("-") <= 3:
                        deployed_url = line
                        break
                    deployed_url = line  # keep last match as fallback

        if deployed_url:
            print(f"\n  [*] SUCCESS! Website is live at: {deployed_url}")

            # Run Automated Quality Assurance
            print(f"\n  [*] Running Post-Deployment QA...")
            qa_passed = run_qa_check(deployed_url, shop_slug)

            if not qa_passed:
                print(f"  [Error] Deployment completed but QA failed. Review required.")
                return None

            # Optional: Bind Custom Domain
            custom_domain = lead_data.get('custom_domain')
            if custom_domain:
                bind_custom_domain(deploy_dir, custom_domain)

            return deployed_url
        else:
            print(f"\n  [Error] Vercel deployed but could not extract URL.\nStdout: {result.stdout}\nStderr: {result.stderr}")
            return None

    except Exception as e:
        print(f"  [Error] Deployment subprocess failed: {e}")
        return None


if __name__ == "__main__":
    test_lead = {
        "business_name": "Cloud 9 Smoke Shop",
        "city":          "Houston",
        "phone":         "(713) 555-9999",
        "address":       "123 Cloud St, Houston, TX 77002",
        "maps_url":      "https://maps.google.com/?q=Cloud+9",
        "rating":        "4.6",
        "review_count":  "38",
        "custom_domain": None,
    }

    deploy_shop_website(test_lead)
