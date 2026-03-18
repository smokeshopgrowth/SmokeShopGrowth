import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Stripe Configuration
STRIPE_API_KEY = os.getenv('STRIPE_API_KEY')
STRIPE_WEBHOOK_SECRET = os.getenv('STRIPE_WEBHOOK_SECRET')

# Google Sheets Configuration
GOOGLE_SHEET_URL = os.getenv('GOOGLE_SHEET_URL')

# Demo Site Configuration
DEMO_BASE_URL = os.getenv('DEMO_BASE_URL', 'https://smoke-shop-premium-demo.netlify.app')

# Email SMTP Configuration
SMTP_HOST = os.getenv('SMTP_HOST', 'smtp.gmail.com')
SMTP_PORT = int(os.getenv('SMTP_PORT', 587))
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
SENDER_NAME = os.getenv('AGENT_NAME', 'Alex')
