const fs = require('fs').promises;
const path = require('path');

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

async function generateSites() {
  try {
    const template = await fs.readFile('template.html', 'utf8');
    const shopsData = await fs.readFile('shops.json', 'utf8');
    const shops = JSON.parse(shopsData);

    const outputDir = path.join(__dirname, 'public', 'demos');
    await fs.mkdir(outputDir, { recursive: true });

    for (const shop of shops) {
      let populatedTemplate = template;
      for (const key in shop) {
        const regex = new RegExp(`{{${key.toUpperCase()}}}`, 'g');
        populatedTemplate = populatedTemplate.replace(regex, shop[key]);
      }

      const slug = slugify(shop.business_name);
      const shopDir = path.join(outputDir, slug);
      await fs.mkdir(shopDir, { recursive: true });

      await fs.writeFile(path.join(shopDir, 'index.html'), populatedTemplate);
      console.log(`Generated site for ${shop.business_name} at ${shopDir}`);
    }

    console.log('\nAll sites generated successfully!');
    console.log(`\nTo run the generator again, use the command:`);
    console.log('npm install && node generate-sites.js');

  } catch (error) {
    console.error('Error generating sites:', error);
  }
}

generateSites();
