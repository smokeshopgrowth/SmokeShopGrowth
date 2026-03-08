import requests
import json

OLD_API_KEY = "f42e9ddb-8294-4898-95a9-eaf526dbb6b0"
OLD_ASSISTANT_ID = "535d867a-5127-45a5-abbe-c04f334bd5c5"

NEW_API_KEY = "84618ca5-5f25-42d0-914a-ba17a6383559"
NEW_ASSISTANT_ID = "f219bbbf-2880-47e8-a434-933a8e8067bf"

def main():
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
