import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto("https://www.google.com/maps/place/Smoke+Envy/@29.7408899,-95.401131,17z/data=!3m1!4b1!4m6!3m5!1s0x8640c0bdbb3c66f1:0x2283a0ad45fa5cb6!8m2!3d29.7408853!4d-95.3985561!16s%2Fg%2F1tg9ts76?entry=ttu")
        await asyncio.sleep(5)
        images = await page.eval_on_selector_all('img', 'imgs => imgs.map(i => ({src: i.src, width: i.width, height: i.height, alt: i.alt}))')
        for img in images:
            if 'googleusercontent.com' in img['src'] and img.get('width', 0) > 100:
                print(f"Img: {img['src']} (W:{img.get('width')} H:{img.get('height')}) ALT:{img.get('alt')}")
        await browser.close()

asyncio.run(main())
