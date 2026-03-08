const puppeteer = require('puppeteer');
// const { OpenAI } = require('openai'); // Uncomment to use OpenAI
// const { ElevenLabsClient } = require('elevenlabs'); // Uncomment to use ElevenLabs

(async () => {
    // 1. Launch the browser
    // headless: false allows you to see the browser action for debugging
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized']
    });

    const page = await browser.newPage();

    // 2. Navigate to Google Maps
    console.log('Navigating to Google Maps...');
    await page.goto('https://www.google.com/maps', { waitUntil: 'networkidle2' });

    // 3. Perform Search
    const searchQuery = "Plumbers in New York"; // Change this to your desired niche/location
    console.log(`Searching for: ${searchQuery}`);

    try {
        // Type into the search box
        await page.waitForSelector('input#searchboxinput');
        await page.type('input#searchboxinput', searchQuery);
        await page.keyboard.press('Enter');

        // Wait for the results feed to load
        await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        console.log('Results loaded. Scrolling...');

        // 4. Scroll to load more results
        await page.evaluate(async () => {
            const feed = document.querySelector('div[role="feed"]');
            if (feed) {
                for (let i = 0; i < 3; i++) { // Scroll 3 times
                    feed.scrollTop = feed.scrollHeight;
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for load
                }
            }
        });

        // 5. Extract Raw Text
        const rawText = await page.evaluate(() => {
            const feed = document.querySelector('div[role="feed"]');
            return feed ? feed.innerText : '';
        });
        console.log(`Extracted raw text (${rawText.length} chars). Ready for OpenAI parsing.`);

    } catch (error) {
        console.error('Error during scraping:', error);
    }

    console.log('Ready to scrape.');

    // await browser.close();
})();