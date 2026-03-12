/**
 * Google Apps Script - Business Name Cleaner
 * 
 * Instructions:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1cCWHElqtVl8sE7lIfOxoGqfkmr8aE5tkcsyoF8RGmTU/edit
 * 2. Click on "Extensions" > "Apps Script" in the top menu.
 * 3. Delete any code there and paste this entire script.
 * 4. Click the Save icon (or Ctrl+S / Cmd+S).
 * 5. Refresh your Google Sheet. You will see a new "Lead Scraper Tools" menu at the top!
 */

// Creates the custom menu when the spreadsheet opens
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Lead Scraper Tools')
    .addItem('🧹 Clean Business Names', 'cleanBusinessNames')
    .addToUi();
}

/**
 * Main function that cleans the business names in the active sheet
 */
function cleanBusinessNames() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues(); // [Row][Column]
  const ui = SpreadsheetApp.getUi();
  
  if (values.length <= 1) {
    ui.alert('No data found to clean.');
    return;
  }
  
  // Find the column index for "business_name" or "business name" or "title"
  const headers = values[0];
  let nameColIndex = -1;
  
  for (let i = 0; i < headers.length; i++) {
    const header = String(headers[i]).toLowerCase().trim();
    if (header === 'business_name' || header === 'business name' || header === 'title' || header === 'name') {
      nameColIndex = i;
      break;
    }
  }
  
  if (nameColIndex === -1) {
    ui.alert('Could not find a column named "business_name", "business name", "title", or "name". Please rename your column header and try again.');
    return;
  }
  
  let cleanedCount = 0;
  
  // Process rows (skip header row 0)
  for (let r = 1; r < values.length; r++) {
    const originalName = String(values[r][nameColIndex] || "").trim();
    if (!originalName) continue;
    
    const cleanedName = processNameString(originalName);
    
    // If it changed, update the array
    if (originalName !== cleanedName) {
      values[r][nameColIndex] = cleanedName;
      cleanedCount++;
    }
  }
  
  // Write the updated data back to the sheet in one batch (much faster)
  if (cleanedCount > 0) {
    dataRange.setValues(values);
    ui.alert('Success!', `Cleaned ${cleanedCount} business names.`, ui.ButtonSet.OK);
  } else {
    ui.alert('All good!', 'No business names needed cleaning.', ui.ButtonSet.OK);
  }
}

/**
 * Heuristic logic to clean a single business name
 */
function processNameString(name) {
  if (!name) return name;
    
  // 1. Split by typical keyword-stuffing separators like | or — or –
  let parts = name.split(/\s*?[|—–]\s*/);
  let coreName = parts[0];
  
  // Split by " - " (needs spaces to avoid splitting hyphenated words)
  parts = coreName.split(/\s+-\s+/);
  coreName = parts[0];

  // Split by comma if it seems like a list of keywords
  if (coreName.indexOf(',') > -1) {
    coreName = coreName.split(',')[0];
  }
  
  // 2. Remove standard junk keywords (case insensitive globally)
  // Adding user mentioned: music, skate, wear, thca, cbd
  // Along with other common smoke shop keyword stuffing
  const junkRegex = /\b(music|skate|wear|thca|cbd|vape|vapes|dispensary|hookah|kratom|waterpipe|geekbar|whip-its|atm|thc|e-juices|cigars|hemp|glass pipe|open 24 hours|smoke shop|smoke|shop|store)\b/ig;
  
  let cleaned = coreName.replace(junkRegex, '');
  
  // 3. Cleanup trailing/leading punctuation resulting from the removal
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
