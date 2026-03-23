import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

# ── Credentials loaded from environment (never hardcode keys!) ──────────────
# Add OLD_VAPI_API_KEY, OLD_VAPI_ASSISTANT_ID, NEW_VAPI_ASSISTANT_ID to your .env
OLD_API_KEY      = os.getenv("OLD_VAPI_API_KEY")
OLD_ASSISTANT_ID = os.getenv("OLD_VAPI_ASSISTANT_ID")
NEW_API_KEY      = os.getenv("VAPI_API_KEY")
NEW_ASSISTANT_ID = os.getenv("VAPI_ASSISTANT_ID")

def main():
    if not all([OLD_API_KEY, OLD_ASSISTANT_ID, NEW_API_KEY, NEW_ASSISTANT_ID]):
        print("Error: Missing one or more required env vars: OLD_VAPI_API_KEY, OLD_VAPI_ASSISTANT_ID, VAPI_API_KEY, VAPI_ASSISTANT_ID")
        return

    print("Fetching Old Assistant Voice Data...")
    res = requests.get(
        f"https://api.vapi.ai/assistant/{OLD_ASSISTANT_ID}",
        headers={"Authorization": f"Bearer {OLD_API_KEY}"}
    )

    if res.status_code != 200:
        print(f"Failed to fetch old assistant: {res.text}")
        return

    old_data = res.json()
    voice_profile = old_data.get('voice')

    if not voice_profile:
        print("No voice profile found on the old assistant.")
        return

    print(f"Captured Voice Profile: {voice_profile.get('provider')} / {voice_profile.get('voiceId')}")

    print("Patching New Assistant...")
    res2 = requests.patch(
        f"https://api.vapi.ai/assistant/{NEW_ASSISTANT_ID}",
        headers={
            "Authorization": f"Bearer {NEW_API_KEY}",
            "Content-Type": "application/json"
        },
        json={"voice": voice_profile}
    )

    if res2.status_code in [200, 201]:
        print("Success! The old voice has been instantly applied to the new Assistant Settings.")
    else:
        print(f"Failed to update new assistant: {res2.text}")

if __name__ == "__main__":
    main()
