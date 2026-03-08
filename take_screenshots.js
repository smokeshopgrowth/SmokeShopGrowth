const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const csv = require('fast-csv');
const puppeteer = require('puppeteer');

const inputFile = path.resolve(__dirname, 'data', 'houston-texas', 'leads_with_demo_links.csv');
const outputDir = path.resolve(__dirname, 'screenshots');

(async () => {
  try {
    await fsPromises.mkdir(outputDir, { recursive: true });

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const leads = [];
    fs.createReadStream(inputFile)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => console.error(error))
      .on('data', row => leads.push(row))
      .on('end', async () => {
        for (const lead of leads) {
          const businessName = lead.business_name;
          const demoLink = lead.demo_link;

          if (businessName && demoLink) {
            console.log(`Processing ${businessName}...`);
            try {
              await page.goto(demoLink, { waitUntil: 'networkidle2' });
              await new Promise(resolve => setTimeout(resolve, 3000));
              
              // Sanitize the business name for use as a filename
              const sanitizedBusinessName = businessName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
              const screenshotPath = path.join(outputDir, `${sanitizedBusinessName}.png`);
              
              await page.screenshot({ path: screenshotPath });
              console.log(`Screenshot saved to ${screenshotPath}`);
            } catch (error) {
              console.error(`Failed to process ${businessName}:`, error);
            }
          }
        }

        await browser.close();
        console.log('All screenshots have been taken.');
      });
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();
