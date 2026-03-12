#!/bin/bash
# Quick Start Test Script - Tests all major components

set -e

echo "=========================================="
echo "Google Maps Lead Scraper - Quick Start"
echo "=========================================="
echo ""

# Check environment
echo "[1/5] Verifying environment..."
npm run verify
echo ""

# Create sample data
echo "[2/5] Creating sample test data..."
cat > data/test_leads.csv << 'EOF'
business_name,address,city,state,phone,website,rating,review_count
"Smoke Therapy","123 Main St","Houston","TX","713-555-8899","https://smoketherapy.com","4.8","156"
"Rock N Roll Smoke","456 Rocker Ave","Houston","TX","832-555-1234","https://rocknroll.com","4.5","98"
"Vape City","789 Vapor Ln","Houston","TX","713-555-5678","https://vapecity.com","4.2","67"
EOF
echo "✓ Sample test data created: data/test_leads.csv"
echo ""

# Test Python scraper
echo "[3/5] Testing Python scraper..."
echo "  Command: python scraper.py --help"
python scraper.py --help > /dev/null
echo "  ✓ Scraper ready"
echo ""

# Test Node scripts
echo "[4/5] Testing Node.js scripts..."
echo "  Checking: server.js"
node -c server.js > /dev/null && echo "  ✓ Server syntax valid"
echo "  Checking: run_pipeline.js"  
node -c run_pipeline.js > /dev/null && echo "  ✓ Pipeline syntax valid"
echo "  Checking: auditor.js"
node -c auditor.js > /dev/null && echo "  ✓ Auditor syntax valid"
echo ""

# Summary
echo "[5/5] Summary"
echo "=========================================="
echo "✓ All tests passed!"
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with your API keys"
echo "  2. Run: npm start"
echo "  3. Visit: http://localhost:3000"
echo ""
echo "To test scraper:"
echo "  python scraper.py --city 'Houston' --type 'smoke shop' --max-results 10"
echo ""
echo "To run full pipeline:"
echo "  npm run pipeline"
echo "=========================================="
