"""
Google Maps Lead Scraper
========================
Scrapes business listings from Google Maps for a given city and business type.

Usage:
    python scraper.py --city "Houston" --type "smoke shop"
    python scraper.py --city "Dallas" --type "vape shop" --max-results 150 --headless
    python scraper.py --city "Austin" --output austin_leads.csv

Requirements:
    pip install -r requirements.txt
    playwright install chromium
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import os
import random
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional
from urllib.parse import quote_plus

import pandas as pd
from playwright.async_api import (
    Browser,
    Page,
    Playwright,
    async_playwright,
    TimeoutError as PlaywrightTimeout,
)
from tqdm import tqdm

import config


# ──────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("gmaps-scraper")


# ──────────────────────────────────────────────
# Data model
# ──────────────────────────────────────────────
@dataclass
class Business:
    business_name: str = ""
    address: str = ""
    phone: str = ""
    website: str = ""
    rating: str = ""
    review_count: str = ""
    google_maps_url: str = ""
    image_url: str = ""





# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def _clean(text: str) -> str:
    """Strip whitespace and invisible chars."""
    return re.sub(r"\s+", " ", text or "").strip()


async def _safe_text(page: Page, selector: str, timeout: int = config.SAFE_SELECTOR_TIMEOUT) -> str:
    """Return inner text of first matching element, or empty string."""
    try:
        el = await page.wait_for_selector(selector, timeout=timeout)
        return _clean(await el.inner_text()) if el else ""
    except PlaywrightTimeout:
        return ""
    except Exception:
        return ""


async def _safe_attr(page: Page, selector: str, attr: str, timeout: int = config.SAFE_SELECTOR_TIMEOUT) -> str:
    """Return attribute of first matching element, or empty string."""
    try:
        el = await page.wait_for_selector(selector, timeout=timeout)
        val = await el.get_attribute(attr) if el else ""
        return _clean(val or "")
    except PlaywrightTimeout:
        return ""
    except Exception:
        return ""


async def _random_delay(min_s: float = config.MIN_RANDOM_DELAY_S, max_s: float = config.MAX_RANDOM_DELAY_S) -> None:
    await asyncio.sleep(random.uniform(min_s, max_s))


# ──────────────────────────────────────────────
# Core scraper class
# ──────────────────────────────────────────────
class GoogleMapsScraper:
    """
    Scrapes Google Maps search results for a given query.

    Parameters
    ----------
    city        : City name to search in.
    biz_type    : Business type / category (default: "smoke shop").
    max_results : Hard cap on the number of listings to collect.
    headless    : Run browser with no UI (True) or visible (False).
    output_file : Path to save the CSV results.
    """

    def __init__(
        self,
        city: str,
        biz_type: str = "smoke shop",
        max_results: int = config.MAX_RESULTS,
        headless: bool = config.HEADLESS_MODE,
        output_file: str = config.DEFAULT_OUTPUT_FILENAME,
    ) -> None:
        self.city = city.strip()
        self.biz_type = biz_type.strip()
        self.max_results = int(os.getenv("SCRAPER_MAX_RESULTS", max_results))
        self.headless = os.getenv("SCRAPER_HEADLESS", str(headless)).lower() in ("true", "1", "yes")
        self.output_file = os.getenv("SCRAPER_OUTPUT_FILE", output_file)


        self._results: list[Business] = []
        self._seen_urls: set[str] = set()

        # Load existing CSV to support incremental runs
        self._load_existing()

    # ── Setup ──────────────────────────────────
    def _load_existing(self) -> None:
        p = Path(self.output_file)
        if p.exists():
            try:
                df = pd.read_csv(p, dtype=str)
                for _, row in df.iterrows():
                    url = row.get("google_maps_url", "")
                    if url and url not in self._seen_urls:
                        self._seen_urls.add(url)
                        self._results.append(Business(**{
                            k: str(row.get(k, "") or "") for k in Business.__dataclass_fields__
                        }))
                log.info("Loaded %d existing records from %s", len(self._results), self.output_file)
            except Exception as exc:
                log.warning("Could not load existing CSV: %s", exc)

    def _build_search_url(self) -> str:
        query = quote_plus(f"{self.biz_type} in {self.city}")
        return config.SEARCH_URL_TEMPLATE.format(query=query)

    # ── Saving ─────────────────────────────────
    def save(self) -> None:
        if not self._results:
            log.warning("No results to save.")
            return
        df = pd.DataFrame([asdict(b) for b in self._results])
        df = df.drop_duplicates(subset=["google_maps_url"])
        df.to_csv(self.output_file, index=False, quoting=csv.QUOTE_ALL)
        log.info("Saved %d records to %s", len(df), self.output_file)

    # ── Extraction helpers ──────────────────────
    async def _extract_detail(self, page: Page) -> Business:
        """Extract all fields from the currently-open detail panel."""
        biz = Business()

        # Name
        biz.business_name = await _safe_text(page, config.SEL_DETAIL_NAME, timeout=4000)

        # Address
        biz.address = await _safe_text(page, config.SEL_DETAIL_ADDRESS)

        # Phone — try multiple selectors
        biz.phone = await _safe_text(page, config.SEL_DETAIL_PHONE, timeout=2000)

        # Website
        biz.website = await _safe_attr(page, config.SEL_DETAIL_WEBSITE, "href")
        if not biz.website:
            # fallback: grab text that looks like a URL
            raw = await _safe_text(page, config.SEL_DETAIL_WEBSITE)
            if raw:
                biz.website = raw

        # Rating
        biz.rating = await _safe_text(page, config.SEL_DETAIL_RATING, timeout=2000)

        # Review count — strip non-numeric chars except dots/commas
        raw_reviews = await _safe_text(page, config.SEL_DETAIL_REVIEWS, timeout=2000)
        if not raw_reviews:
            # alternate selector
            raw_reviews = await _safe_text(
                page, 'button[jsaction*="pane.rating"] span[aria-label]', timeout=2000
            )
        biz.review_count = re.sub(r"[^\d,]", "", raw_reviews)

        # Canonical URL (strip query params / extra state)
        current_url = page.url
        # Keep only the /maps/place/... portion
        match = re.search(r"(https://www\.google\.com/maps/place/[^?]+)", current_url)
        biz.google_maps_url = match.group(1) if match else current_url

        # Image URL
        biz.image_url = await _safe_attr(page, config.SEL_DETAIL_IMAGE, "src", timeout=4000)
        # fallback: any image with lh5.googleusercontent.com in it
        if not biz.image_url:
            raw_img = await page.evaluate('''() => {
                const imgs = Array.from(document.querySelectorAll("img"));
                const hero = imgs.find(img => img.src.includes("googleusercontent.com/p/"));
                return hero ? hero.src : "";
            }''')
            if raw_img:
                biz.image_url = raw_img

        return biz

    # ── Scroll loop ─────────────────────────────
    async def _scroll_and_collect_urls(self, page: Page) -> list[str]:
        """
        Scroll the result feed until no new items appear or max_results reached.
        Returns list of deduplicated result card hrefs.
        """
        log.info("Scrolling results list...")
        collected_urls: list[str] = []
        seen_hrefs: set[str] = set()
        stale_count = 0
        max_stale = config.MAX_STALE_SCROLLS  # stop after this many scrolls with no new items

        with tqdm(desc="Scanning result cards", unit=" cards") as pbar:
            while True:
                # Grab all anchor hrefs in the result feed
                cards = await page.query_selector_all(
                    'div[role="feed"] a[href*="/maps/place/"]'
                )
                new = 0
                for card in cards:
                    href = await card.get_attribute("href")
                    if href and href not in seen_hrefs:
                        seen_hrefs.add(href)
                        # Normalise URL
                        match = re.search(
                            r"(https://www\.google\.com/maps/place/[^?&]+)", href
                        )
                        url = match.group(1) if match else href
                        if url not in self._seen_urls:
                            collected_urls.append(url)
                        new += 1
                        pbar.update(1)

                if len(collected_urls) + len(self._seen_urls) >= self.max_results:
                    log.info("Reached max_results limit (%d).", self.max_results)
                    break

                if new == 0:
                    stale_count += 1
                    if stale_count >= max_stale:
                        log.info("No new results after %d scrolls — stopping.", max_stale)
                        break
                else:
                    stale_count = 0

                # Check for end-of-list marker
                end_marker = await page.query_selector(config.SEL_END_OF_LIST)
                if end_marker:
                    log.info("Reached end of Google Maps results list.")
                    break

                # Scroll the feed container
                feed = await page.query_selector(config.SEL_SCROLL_CONTAINER)
                if feed:
                    await feed.evaluate("el => el.scrollTop += el.clientHeight * 0.9")
                else:
                    await page.keyboard.press("End")

                await _random_delay(0.8, 1.8)

        # Trim to budget
        remaining_budget = self.max_results - len(self._seen_urls)
        return collected_urls[:max(0, remaining_budget)]

    # ── Main entry point ────────────────────────
    async def run(self) -> None:
        async with async_playwright() as pw:
            browser: Browser = await pw.chromium.launch(
                headless=self.headless,
                args=config.BROWSER_ARGS,
            )
            context = await browser.new_context(
                viewport={"width": config.VIEWPORT_WIDTH, "height": config.VIEWPORT_HEIGHT},
                locale="en-US",
                user_agent=config.USER_AGENT,
            )
            # Hide playwright fingerprint
            await context.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

            page: Page = await context.new_page()

            search_url = self._build_search_url()
            log.info("Navigating to: %s", search_url)
            try:
                await page.goto(search_url, wait_until="domcontentloaded", timeout=config.REQUEST_TIMEOUT)
            except PlaywrightTimeout:
                log.error("Timed out loading Google Maps. Check your internet connection.")
                await browser.close()
                return

            # Accept cookies / consent dialog if it appears
            await self._handle_consent(page)

            # Wait for results pane
            try:
                await page.wait_for_selector(config.SEL_SCROLL_CONTAINER, timeout=15_000)
            except PlaywrightTimeout:
                log.error("Result feed not found. Google may have changed its layout.")
                await browser.close()
                return

            await _random_delay(1.0, 2.0)

            # Phase 1: collect all card URLs by scrolling
            card_urls = await self._scroll_and_collect_urls(page)
            log.info("Found %d new listings to scrape.", len(card_urls))

            if not card_urls:
                log.warning("No new listings found. Exiting.")
                await browser.close()
                return

            # Phase 2: visit each card URL and extract details
            log.info("Extracting business details...")
            try:
                for idx, url in enumerate(tqdm(card_urls, desc="Extracting details", unit=" biz"), 1):
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=config.DETAIL_EXTRACT_TIMEOUT)
                        await _random_delay(0.5, 1.5)

                        biz = await self._extract_detail(page)

                        if biz.google_maps_url and biz.google_maps_url not in self._seen_urls:
                            self._seen_urls.add(biz.google_maps_url)
                            self._results.append(biz)
                            log.debug(
                                "[%d] ✓ %s | %s | %s",
                                idx, biz.business_name, biz.address, biz.phone,
                            )
                        else:
                            log.debug("[%d] Duplicate or empty URL — skipped.", idx)

                        # Periodic save every 20 records
                        if idx % config.PERIODIC_SAVE_INTERVAL == 0:
                            self.save()

                    except PlaywrightTimeout:
                        log.warning("[%d] Timeout on %s — skipping.", idx, url)
                    except Exception as exc:
                        log.warning("[%d] Error on %s: %s", idx, url, exc)

            except KeyboardInterrupt:
                log.info("Interrupted — saving partial results.")

            finally:
                await browser.close()

        self.save()

    # ── Consent dialog ──────────────────────────
    @staticmethod
    async def _handle_consent(page: Page) -> None:
        """Dismiss Google's cookie / consent popup if present."""
        for sel in config.CONSENT_SELECTORS:
            try:
                btn = await page.wait_for_selector(sel, timeout=3000)
                if btn:
                    await btn.click()
                    await _random_delay(0.5, 1.0)
                    log.info("Dismissed consent dialog.")
                    return
            except PlaywrightTimeout:
                continue


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape business leads from Google Maps.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scraper.py --city "Houston" --type "smoke shop"
  python scraper.py --city "Dallas" --type "vape shop" --max-results 150 --headless
  python scraper.py --city "Austin" --type "dispensary" --output austin_dispensaries.csv
        """,
    )
    parser.add_argument(
        "--city", required=True, help="City to search in (e.g. 'Houston TX')."
    )
    parser.add_argument(
        "--type",
        dest="biz_type",
        default="smoke shop",
        help="Business type to search for (default: 'smoke shop').",
    )
    parser.add_argument(
        "--max-results",
        type=int,
        default=config.MAX_RESULTS,
        help=f"Maximum number of results to collect (default: {config.MAX_RESULTS}).",
    )
    parser.add_argument(
        "--output",
        default=config.DEFAULT_OUTPUT_FILENAME,
        help=f"Output CSV file path (default: {config.DEFAULT_OUTPUT_FILENAME}).",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run browser in headless (no UI) mode.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable DEBUG logging.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    log.info("=" * 60)
    log.info("Google Maps Lead Scraper")
    log.info("  City        : %s", args.city)
    log.info("  Type        : %s", args.biz_type)
    log.info("  Max results : %d", args.max_results)
    log.info("  Output      : %s", args.output)
    log.info("  Headless    : %s", args.headless)
    log.info("=" * 60)

    scraper = GoogleMapsScraper(
        city=args.city,
        biz_type=args.biz_type,
        max_results=args.max_results,
        headless=args.headless,
        output_file=args.output,
    )

    start = time.perf_counter()
    try:
        asyncio.run(scraper.run())
    except KeyboardInterrupt:
        log.info("Interrupted by user.")
    elapsed = time.perf_counter() - start
    log.info("Done in %.1f seconds.", elapsed)


if __name__ == "__main__":
    main()
