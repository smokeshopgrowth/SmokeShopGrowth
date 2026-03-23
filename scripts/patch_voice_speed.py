import os
import requests
from dotenv import load_dotenv

load_dotenv()

# ── Credentials loaded from environment (never hardcode keys!) ──────────────
API_KEY      = os.getenv("VAPI_API_KEY")
ASSISTANT_ID = os.getenv("VAPI_ASSISTANT_ID")

def patch_voice_speed():
    if not API_KEY or not ASSISTANT_ID:
        print("Error: VAPI_API_KEY and VAPI_ASSISTANT_ID must be set in your .env file.")
        return

    url = f"https://api.vapi.ai/assistant/{ASSISTANT_ID}"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    # GET current voice settings
    get_res = requests.get(url, headers=headers)
    if get_res.status_code != 200:
        print(f"Could not fetch assistant: {get_res.text}")
        return

    current = get_res.json()
    voice_cfg = current.get("voice", {})
    print(f"Current voice: {voice_cfg.get('provider')} / {voice_cfg.get('voiceId')} @ speed={voice_cfg.get('speed', 'default')}")

    # Patch speed to 0.85 (slightly slower, more natural opener pacing)
    voice_cfg["speed"] = 0.85

    res = requests.patch(url, headers=headers, json={"voice": voice_cfg})

    if res.status_code in [200, 201]:
        result = res.json()
        new_speed = result.get("voice", {}).get("speed")
        print(f"Speed updated to: {new_speed}")
    else:
        print(f"Failed: {res.status_code} - {res.text}")

if __name__ == "__main__":
    patch_voice_speed()
