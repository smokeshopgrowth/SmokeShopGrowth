const fs = require('fs');
const path = require('path');
const csv = require('fast-csv');
const fsPromises = require('fs').promises;

const inputFile = path.resolve(__dirname, 'data', 'houston-texas', 'leads.csv');
const outputFile = path.resolve(__dirname, 'data', 'houston-texas', 'leads_with_demo_links.csv');
const templatePath = path.resolve(__dirname, 'demo', 'index.html');
const demoOutputDir = path.resolve(__dirname, 'demo', 'output');

(async () => {
    try {
        await fsPromises.mkdir(demoOutputDir, { recursive: true });
        const template = await fsPromises.readFile(templatePath, 'utf8');
        const leads = [];

        fs.createReadStream(inputFile)
            .pipe(csv.parse({ headers: true }))
            .on('error', error => console.error(error))
            .on('data', row => leads.push(row))
            .on('end', async () => {
                const leadsWithDemoLinks = [];
                for (const lead of leads) {
                    const businessName = lead.business_name || '';
                    const address = lead.address || '';
                    const phone = lead.phone || '';

                    let city = '';
                    let state = '';
                    const addressParts = address.split(',');
                    if (addressParts.length >= 2) {
                        city = addressParts[addressParts.length - 2].trim();
                        const stateAndZip = addressParts[addressParts.length - 1].trim().split(' ');
                        if (stateAndZip.length >= 2) {
                            state = stateAndZip[0];
                        }
                    }

                    const sanitizedBusinessName = businessName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const shopOutputDir = path.join(demoOutputDir, sanitizedBusinessName);
                    await fsPromises.mkdir(shopOutputDir, { recursive: true });
                    const personalizedHtmlPath = path.join(shopOutputDir, 'index.html');
                    
                    const personalizedHtml = template
                        .replace(/{{SHOP_NAME}}/g, businessName)
                        .replace(/{{CITY}}/g, city)
                        .replace(/{{ADDRESS}}/g, address)
                        .replace(/{{STATE}}/g, state)
                        .replace(/{{PHONE}}/g, phone)
                        .replace(/{{PHONE_DISPLAY}}/g, phone)
                        .replace(/{{YEARS}}/g, Math.floor(Math.random() * 5) + 2);

                    await fsPromises.writeFile(personalizedHtmlPath, personalizedHtml);
                    
                    const demoLink = `file://${personalizedHtmlPath}`;

                    leadsWithDemoLinks.push({
                        business_name: businessName,
                        city: city,
                        email: '', // Email is missing
                        phone: phone,
                        demo_link: demoLink,
                    });
                }

                csv.writeToPath(outputFile, leadsWithDemoLinks, { headers: true })
                    .on('error', err => console.error('Error writing CSV file:', err))
                    .on('finish', () => console.log('CSV file with demo links has been written successfully.'));
            });
    } catch (error) {
        console.error('An error occurred:', error);
    }
})();
