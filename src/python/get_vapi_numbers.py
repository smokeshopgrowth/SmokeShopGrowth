import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()
vapi_key = os.getenv('VAPI_API_KEY')
url = 'https://api.vapi.ai/phone-number'
headers = {
    'Authorization': f'Bearer {vapi_key}',
    'Content-Type': 'application/json'
}
response = requests.get(url, headers=headers)

if response.status_code == 200:
    for num in response.json():
        print(f"Num: {num.get('number')} -> ID: {num.get('id')}")
else:
    print("Error:", response.text)
