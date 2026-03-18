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

# Scraper Configuration
SAFE_SELECTOR_TIMEOUT = 5000  # milliseconds
MIN_RANDOM_DELAY_S = 0.5  # seconds
MAX_RANDOM_DELAY_S = 2.0  # seconds
HEADLESS_MODE = True
DEFAULT_OUTPUT_FILENAME = "leads.csv"
MAX_RESULTS = 200
MAX_STALE_SCROLLS = 5

# Google Maps CSS Selectors
SEARCH_URL_TEMPLATE = "https://www.google.com/maps/search/{query}"
SEL_DETAIL_NAME = "h1.fontHeadlineLarge"
SEL_DETAIL_ADDRESS = "button[data-item-id='address']"
SEL_DETAIL_PHONE = "button[data-item-id='phone:tel']"
SEL_DETAIL_WEBSITE = "button[data-item-id='website']"
SEL_DETAIL_RATING = "div.f8scje span[aria-label*='star']"
SEL_DETAIL_REVIEWS = "button[jsaction*='pane.rating'] span:nth-child(2)"
SEL_DETAIL_IMAGE = "img.NIzKQf"
SEL_SCROLL_CONTAINER = "div.m6QErb"
SEL_END_OF_LIST = "p.HFRwqf"
SEL_RESULT_ITEM = "div[data-result-index]"

# Playwright Settings
BROWSER_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
]
VIEWPORT_WIDTH = 1200
VIEWPORT_HEIGHT = 800
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
)

# Request Timeouts
REQUEST_TIMEOUT = 30_000  # milliseconds
DETAIL_EXTRACT_TIMEOUT = 25_000  # milliseconds
PERIODIC_SAVE_INTERVAL = 10  # Save every N results

# Consent/Cookie Popup Selectors
CONSENT_SELECTORS = [
    "button[aria-label='Reject all']",
    "button:has-text('Reject all')",
    "button[jsname='b3VHJc']",  # Google's reject button class
]
