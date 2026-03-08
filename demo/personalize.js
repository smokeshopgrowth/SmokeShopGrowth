/**
 * demo/personalize.js
 * 
 * Generates a personalized smoke shop demo for a specific lead.
 * 
 * Usage:
 *   node demo/personalize.js --name "Cloud 9 Smoke Shop" --city Houston --phone "713-555-1234"
 *   node demo/personalize.js --name "Vape Kingdom" --city Austin --phone "512-555-9999" --address "4200 Lamar Blvd" --state TX
 * 
 * Output:
 *   demo/output/cloud-9-smoke-shop/index.html  ← ready to deploy
 */

const fs = require("fs");
const path = require("path");

function getArg(flag, def = "") {
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : def;
}

const rawName = getArg("--name");
const city = getArg("--city", "Houston");
const phone = getArg("--phone", "(713) 555-0100");
const address = getArg("--address", "123 Main St");
const state = getArg("--state", "TX");
const years = getArg("--years", "5");

if (!rawName) {
    console.error("Usage: node demo/personalize.js --name \"Shop Name\" --city Houston --phone \"713-555-1234\"");
    process.exit(1);
}

// Normalize phone for tel: links (digits only)
const phoneDigits = phone.replace(/\D/g, "");
const phoneE164 = phoneDigits.startsWith("1") ? `+${phoneDigits}` : `+1${phoneDigits}`;

// Pretty display format: (713) 555-1234
function formatPhone(digits) {
    const d = digits.replace(/\D/g, "").replace(/^1/, "");
    if (d.length === 10) {
        return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    return phone; // fallback to raw input
}

const phoneDisplay = formatPhone(phone);

// URL-safe folder name
const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Read template
const templatePath = path.join(__dirname, "index.html");
if (!fs.existsSync(templatePath)) {
    console.error("❌ Template not found at demo/index.html");
    process.exit(1);
}
let html = fs.readFileSync(templatePath, "utf-8");

// Replace all tokens
const replacements = {
    "{{SHOP_NAME}}": rawName,
    "{{CITY}}": city,
    "{{STATE}}": state,
    "{{ADDRESS}}": address,
    "{{PHONE}}": phoneE164,
    "{{PHONE_DISPLAY}}": phoneDisplay,
    "{{YEARS}}": years,
};

for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, value);
}

// Output directory
const outDir = path.join(__dirname, "output", slug);
fs.mkdirSync(outDir, { recursive: true });

// Write personalized HTML
fs.writeFileSync(path.join(outDir, "index.html"), html, "utf-8");

// Copy the hero image
const heroDest = path.join(outDir, "hero.png");
const heroSrc = path.join(__dirname, "hero.png");
if (fs.existsSync(heroSrc) && !fs.existsSync(heroDest)) {
    fs.copyFileSync(heroSrc, heroDest);
}

console.log(`✅ Demo generated for: ${rawName}`);
console.log(`   📁 Output: demo/output/${slug}/index.html`);
console.log(`\n📋 Next steps:`);
console.log(`   1. Preview: open demo/output/${slug}/index.html in your browser`);
console.log(`   2. Deploy:  drag demo/output/${slug}/ into https://netlify.com/drop`);
console.log(`   3. Share:   send the Netlify URL via text or email to the lead`);
