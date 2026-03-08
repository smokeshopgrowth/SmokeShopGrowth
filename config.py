"""
Default non-sensitive configurations for the scraper.
"""

# -- Scraping Behavior --
MAX_RESULTS = 200  # Default maximum number of results to collect
MAX_STALE_SCROLLS = 4  # Stop after this many scrolls with no new items
PERIODIC_SAVE_INTERVAL = 20  # Save results every N records

# -- Network & Timeouts --
REQUEST_TIMEOUT = 30_000  # Global timeout for page navigation
DETAIL_EXTRACT_TIMEOUT = 20_000 # Timeout for extracting details from a business page
SAFE_SELECTOR_TIMEOUT = 3000  # Timeout for safe_text and safe_attr helpers
MIN_RANDOM_DELAY_S = 0.4  # Minimum random delay between actions
MAX_RANDOM_DELAY_S = 1.4  # Maximum random delay between actions

# -- Browser Settings --
HEADLESS_MODE = False  # Default headless mode
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
VIEWPORT_WIDTH = 1400
VIEWPORT_HEIGHT = 900
BROWSER_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
]

# -- URLs and Selectors --
SEARCH_URL_TEMPLATE = "https://www.google.com/maps/search/{query}/"

# Selectors (update here if Google changes DOM)
SEL_RESULT_ITEMS = 'div[role="feed"] > div > div[jsaction]'
SEL_RESULT_PANEL = 'div[role="main"]'
SEL_DETAIL_NAME = 'h1.DUwDvf, h1[class*="DUwDvf"]'
SEL_DETAIL_ADDRESS = '[data-item-id="address"] .Io6YTe, [data-tooltip="Copy address"] .Io6YTe'
SEL_DETAIL_PHONE = '[data-item-id^="phone"] .Io6YTe, [data-tooltip="Copy phone number"] .Io6YTe'
SEL_DETAIL_WEBSITE = 'a[data-item-id="authority"], a[data-tooltip="Open website"]'
SEL_DETAIL_RATING = 'div.F7nice span[aria-hidden="true"]'
SEL_DETAIL_REVIEWS = 'div.F7nice span[aria-label*="review"]'
SEL_DETAIL_IMAGE = 'button[jsaction*="pane.heroHeaderImage"] img, button[aria-label*="Photo"] img, div.m6BEpe img'
SEL_SCROLL_CONTAINER = 'div[role="feed"]'
SEL_END_OF_LIST = 'span.HlvSq'  # "You've reached the end of the list"

# Consent dialog selectors
CONSENT_SELECTORS = [
    'button[aria-label*="Accept all"]',
    'button[aria-label*="Agree"]',
    'form[action*="consent"] button',
    '#L2AGLb',  # "I agree" button in some regions
]

# -- Output --
DEFAULT_OUTPUT_FILENAME = "leads.csv"
