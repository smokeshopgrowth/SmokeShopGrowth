#!/usr/bin/env node
/**
 * Generate Demo Sites from smoke-shop-sites Templates
 * ====================================================
 * Reads leads from a CSV, picks a template from templates/smoke-shop-sites/sites/,
 * and generates a personalized single-file demo for each lead.
 *
 * Usage:
 *   node src/node/generate-from-templates.js --input data/leads.csv --output public/demos
 *   node src/node/generate-from-templates.js --template cloud-nine --input data/leads.csv
 */

'use strict';

import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates/smoke-shop-sites/sites');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../../public/demos');
const DEFAULT_INPUT = path.resolve(__dirname, '../../data/leads.csv');

// Color palette to rotate through for variety
const COLORS = [
  { primary: '#7c3aed', hover: '#6d28d9', name: 'purple' },
  { primary: '#0ea5e9', hover: '#0284c7', name: 'blue' },
  { primary: '#16a34a', hover: '#15803d', name: 'green' },
  { primary: '#dc2626', hover: '#b91c1c', name: 'red' },
  { primary: '#d97706', hover: '#b45309', name: 'amber' },
];

function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

function getAvailableTemplates() {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error(`Templates directory not found: ${TEMPLATES_DIR}`);
    console.error('Run: git submodule update --init');
    process.exit(1);
  }
  return fs.readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.html'));
}

function personalizeTemplate(html, lead, colorIndex) {
  const color = COLORS[colorIndex % COLORS.length];

  // Replace business details
  let out = html
    .replace(/Cloud Nine Smoke Shop/g, lead.business_name || 'Your Smoke Shop')
    .replace(/Cloud Nine/g, (lead.business_name || 'Your Shop').split(' ').slice(0, 2).join(' '))
    .replace(/123 High St/g, lead.address || '123 Main St')
    .replace(/Denver, CO 80203/g, lead.city || 'Your City')
    .replace(/\(303\) 555-0199/g, lead.phone || '(555) 000-0000')
    .replace(/tel:3035550199/g, `tel:${(lead.phone || '').replace(/\D/g, '')}`)
    .replace(/https:\/\/maps\.google\.com\/\?q=123\+High\+St\+Denver\+CO/g,
      `https://maps.google.com/?q=${encodeURIComponent(lead.address || '')}`)

  // Swap brand color
  out = out
    .replace(/#7c3aed/g, color.primary)
    .replace(/#6d28d9/g, color.hover)
    .replace(/rgba\(124,\s*58,\s*237,\s*0\.15\)/g,
      `${color.primary}26`); // hex with alpha

  return out;
}

async function loadLeads(inputPath) {
  return new Promise((resolve, reject) => {
    const leads = [];
    fs.createReadStream(inputPath)
      .pipe(csvParser())
      .on('data', row => leads.push(row))
      .on('end', () => resolve(leads))
      .on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const outputIdx = args.indexOf('--output');
  const templateIdx = args.indexOf('--template');

  const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : DEFAULT_INPUT;
  const outputDir = outputIdx >= 0 ? args[outputIdx + 1] : DEFAULT_OUTPUT;
  const templateFilter = templateIdx >= 0 ? args[templateIdx + 1] : null;

  const templates = getAvailableTemplates();
  console.log(`Found ${templates.length} template(s): ${templates.join(', ')}`);

  // Pick template
  let templateFile = templates[0];
  if (templateFilter) {
    const match = templates.find(t => t.includes(templateFilter));
    if (match) templateFile = match;
    else console.warn(`Template "${templateFilter}" not found, using ${templateFile}`);
  }

  const templateHtml = fs.readFileSync(path.join(TEMPLATES_DIR, templateFile), 'utf8');
  console.log(`Using template: ${templateFile}`);

  if (!fs.existsSync(inputPath)) {
    console.error(`Input file not found: ${inputPath}`);
    console.error('Run the scraper first: python src/python/scraper.py --city "Houston" --type "smoke shop"');
    process.exit(1);
  }

  const leads = await loadLeads(inputPath);
  console.log(`Loaded ${leads.length} leads from ${inputPath}`);

  fs.mkdirSync(outputDir, { recursive: true });

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const name = lead.business_name || lead.name || `lead-${i}`;
    const slug = slugify(name);
    const html = personalizeTemplate(templateHtml, lead, i);

    const shopDir = path.join(outputDir, slug);
    fs.mkdirSync(shopDir, { recursive: true });
    fs.writeFileSync(path.join(shopDir, 'index.html'), html);
    console.log(`  Γ£ö ${name} -> ${slug}/index.html (${COLORS[i % COLORS.length].name})`);
  }

  console.log(`\nGenerated ${leads.length} demo sites in ${outputDir}`);
  console.log('Deploy to Netlify Drop or any static host for shareable links.');
}

export async function generateForOne(options) {
    const { TargetBusiness, TargetOutput, isProduction, templateFilter } = options;
    
    const templates = getAvailableTemplates();
    let templateFile = templates[0];
    if (templateFilter) {
      const match = templates.find(t => t.includes(templateFilter));
      if (match) templateFile = match;
    }
    
    // In production, we might use a more robust template or different logic
    const templatePath = path.join(TEMPLATES_DIR, templateFile);
    if (!fs.existsSync(templatePath)) throw new Error(`Template not found: ${templateFile}`);
    
    let html = fs.readFileSync(templatePath, 'utf8');
    
    // Minimal personalization for demo-style delivery
    html = personalizeTemplate(html, { business_name: TargetBusiness }, 0);
    
    if (isProduction) {
      // Add logic here to enable purchased features (Instagram, Menu, etc.)
      // For now, we'll mark it as a 'Production Build'
      html = html.replace('<!-- PRODUCTION_READY_PLACEHOLDER -->', `
        <script>
          console.log('--- PRODUCTION SITE ACTIVATED ---');
          window.SITE_TIER = 'Growth'; // Extracted from lead data
        </script>
      `);
    }

    if (TargetOutput) {
      const dir = path.dirname(TargetOutput);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TargetOutput, html);
    }

    return { success: true, previewUrl: TargetOutput };
  }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
