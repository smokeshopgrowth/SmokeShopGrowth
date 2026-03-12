const fs = require('fs');
const csv = require('csv-parser');
const fastcsv = require('fast-csv');
const path = require('path');

/**
 * Heuristics to clean a business name from Google Maps.
 * Removes keyword stuffing appended after separators,
 * and removes specific junk words like music, skate, cbd, etc.
 */
function cleanBusinessName(name) {
    if (!name) return name;
    
    // 1. Split by typical keyword-stuffing separators
    // | or — or –
    let parts = name.split(/\s*?[|—–]\s*/);
    let coreName = parts[0];
    
    // Split by " - " (needs spaces to avoid splitting hyphenated words)
    parts = coreName.split(/\s+-\s+/);
    coreName = parts[0];

    // Split by comma if it seems like a list of keywords
    if (coreName.includes(',')) {
        coreName = coreName.split(',')[0];
    }
    
    // 2. Remove standard junk keywords
    // The user specifically mentioned: music, skate, wear, thca, cbd
    // Adding other common smoke shop keyword stuffing
    const junkRegex = /\b(music|skate|wear|thca|cbd|vape|vapes|dispensary|hookah|kratom|waterpipe|geekbar|whip-its|atm|thc|e-juices|cigars|hemp|glass pipe|open 24 hours|smoke shop|smoke)\b/ig;
    
    let cleaned = coreName.replace(junkRegex, '');
    
    // 3. Cleanup trailing/leading punctuation
    // Remove standalone '&', 'and', extra spaces, or non-alphanumeric at boundaries
    cleaned = cleaned.replace(/^[\s,&]+|[\s,&]+$/g, '');
    cleaned = cleaned.replace(/\s+/g, ' ');

    cleaned = cleaned.trim();
    
    // Fallback: if we accidentally stripped everything (e.g., the name was literally "Smoke Shop"),
    // return the first chunk before separators, just trimmed.
    if (!cleaned || cleaned.length < 2) {
        return name.split(/\s*?[|—–-]\s*/)[0].trim();
    }
    
    return cleaned;
}

async function processCSV(inputPath, outputPath) {
    console.log(`Processing: ${inputPath}`);
    const rows = [];
    
    return new Promise((resolve, reject) => {
        fs.createReadStream(inputPath)
            .pipe(csv())
            .on('data', (row) => {
                if (row.business_name) {
                    const original = row.business_name;
                    row.business_name = cleanBusinessName(original);
                    if (original !== row.business_name) {
                        console.log(`🧹 Cleaned: "${original}"\n   -> "${row.business_name}"`);
                    }
                }
                // Handle different possible column names just in case
                if (row.title && !row.business_name) {
                    const original = row.title;
                    row.title = cleanBusinessName(original);
                    if (original !== row.title) {
                        console.log(`🧹 Cleaned: "${original}"\n   -> "${row.title}"`);
                    }
                }
                rows.push(row);
            })
            .on('end', () => {
                const ws = fs.createWriteStream(outputPath);
                fastcsv
                    .write(rows, { headers: true })
                    .pipe(ws)
                    .on('finish', () => {
                        console.log(`✅ Saved cleaned data to: ${outputPath}`);
                        resolve();
                    });
            })
            .on('error', reject);
    });
}

// Simple CLI
const args = process.argv.slice(2);
const defaultInput = path.join(__dirname, 'data', 'houston', 'leads.csv');

(async () => {
    let input = args.includes('--input') ? args[args.indexOf('--input') + 1] : defaultInput;
    
    if (!fs.existsSync(input)) {
        console.error(`❌ Input file not found: ${input}`);
        console.log(`Usage: node clean_names.js [--input path/to/leads.csv]`);
        process.exit(1);
    }
    
    // Write to a temporary file, then replace original
    const tempOutput = input + '.tmp';
    
    try {
        await processCSV(input, tempOutput);
        fs.renameSync(tempOutput, input);
        console.log(`🎉 Finished cleaning names in ${input}`);
    } catch (err) {
        console.error(`❌ Error processing CSV:`, err);
        if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
    }
})();
