#!/usr/bin/env node

/**
 * Project Verification Script
 * Checks that all critical components are properly configured
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

const checks = [];

function check(name, fn) {
  try {
    fn();
    console.log(`${colors.green}✓${colors.reset} ${name}`);
    checks.push({ name, pass: true });
  } catch (e) {
    console.log(`${colors.red}✗${colors.reset} ${name}`);
    console.log(`  ${e.message}`);
    checks.push({ name, pass: false });
  }
}

function fileExists(path) {
  if (!fs.existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
}

function fileDoesNotExist(path) {
  if (fs.existsSync(path)) {
    throw new Error(`File should not exist: ${path}`);
  }
}

console.log(`\n${colors.blue}========================================${colors.reset}`);
console.log(`${colors.blue}Google Maps Lead Scraper - Verification${colors.reset}`);
console.log(`${colors.blue}========================================${colors.reset}\n`);

// 1. Check environment
console.log(`${colors.blue}Environment:${colors.reset}`);
check('Node.js installed', () => {
  execSync('node --version', { stdio: 'pipe' });
});
check('npm installed', () => {
  execSync('npm --version', { stdio: 'pipe' });
});
check('Python 3 installed', () => {
  execSync('python --version', { stdio: 'pipe' });
});

// 2. Check project files
console.log(`\n${colors.blue}Project Files:${colors.reset}`);
const requiredFiles = [
  'package.json',
  'requirements.txt',
  'config.py',
  '.env.example',
  '.gitignore',
  'README.md',
  'SECURITY.md'
];

requiredFiles.forEach(file => {
  check(`${file} exists`, () => fileExists(file));
});

// 3. Check .env configuration
console.log(`\n${colors.blue}Configuration:${colors.reset}`);
check('.env is NOT tracked in git', () => {
  let output = '';
  try {
    output = execSync('git ls-files', { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
  } catch (e) {
    // ignore error
  }
  if (output.match(/^\.env$/m)) {
    throw new Error('.env should not be in git - run: git rm --cached -f .env');
  }
});

check('.env.example has OPENAI_API_KEY template', () => {
  const envExample = fs.readFileSync('.env.example', 'utf-8');
  if (!envExample.includes('OPENAI_API_KEY')) {
    throw new Error('Missing OPENAI_API_KEY in .env.example');
  }
});

check('.env.example has TWILIO_ACCOUNT_SID template', () => {
  const envExample = fs.readFileSync('.env.example', 'utf-8');
  if (!envExample.includes('TWILIO_ACCOUNT_SID')) {
    throw new Error('Missing TWILIO_ACCOUNT_SID in .env.example');
  }
});

// 4. Check dependencies
console.log(`\n${colors.blue}Dependencies:${colors.reset}`);
check('Node dependencies installed', () => {
  if (!fs.existsSync('node_modules')) {
    throw new Error('node_modules not found - run: npm install');
  }
});

check('Python dependencies installed (playwright)', () => {
  execSync('python -c "import playwright"', { stdio: 'pipe' });
});

check('Python dependencies installed (requests)', () => {
  execSync('python -c "import requests"', { stdio: 'pipe' });
});

check('Python dependencies installed (sendgrid)', () => {
  execSync('python -c "import sendgrid"', { stdio: 'pipe' });
});

check('Python dependencies installed (twilio)', () => {
  execSync('python -c "import twilio"', { stdio: 'pipe' });
});

// 5. Check syntax
console.log(`\n${colors.blue}Code Quality:${colors.reset}`);
check('Python files compile', () => {
  execSync('python -m py_compile scraper.py delivery_agent.py', { stdio: 'pipe' });
});

check('Node.js files have valid syntax', () => {
  execSync('node -c server.js && node -c run_pipeline.js', { stdio: 'pipe' });
});

// Summary
console.log(`\n${colors.blue}========================================${colors.reset}`);
const passed = checks.filter(c => c.pass).length;
const total = checks.length;

if (passed === total) {
  console.log(`${colors.green}✓ All checks passed (${passed}/${total})${colors.reset}`);
  console.log(`\n${colors.yellow}Next steps:${colors.reset}`);
  console.log('  1. Copy .env.example to .env and fill in your API credentials');
  console.log('  2. Run: npm start');
  console.log('  3. Open: http://localhost:3000\n');
} else {
  console.log(`${colors.red}✗ Some checks failed (${passed}/${total} passed)${colors.reset}`);
  console.log(`\n${colors.yellow}Failing checks:${colors.reset}`);
  checks.filter(c => !c.pass).forEach(c => {
    console.log(`  - ${c.name}`);
  });
  console.log('');
}

process.exit(passed === total ? 0 : 1);
