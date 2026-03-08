
# Google Maps Lead Scraper + Outreach Pipeline

A complete **lead generation and outreach system** that:

1. 🔍 **Scrapes** business listings from Google Maps
2. 🏆 **Audits** lead quality with Lighthouse metrics
3. 📧 **Generates** personalized outreach messages with AI
4. 📞 **Delivers** multi-channel contact via email, SMS, and voice calls
5. 🚀 **Deploys** custom websites on Netlify

## Quick Start

### Prerequisites

- Node.js 18+ (`node --version`)
- Python 3.10+ (`python --version`)

### Setup

#### Option 1: Automated (Windows)

```bash
setup.bat
```

#### Option 2: Manual

```bash
# Install Node dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt
python -m playwright install chromium

# Create environment file
cp .env.example .env.local
# Edit .env.local with your API keys
```

### Running the System

**Start Dashboard Server:**

```bash
npm start
# Opens at http://localhost:3000
```

**Run Full Pipeline:**

```bash
npm run pipeline
```

**Individual Commands:**

```bash
npm run audit           # Audit existing leads
npm run outreach        # Generate outreach messages
npm run email           # Send emails
npm run vapi:call       # Make voice calls
```

## System Architecture

### Core Components

| File | Purpose | Technology |
| ------ | --------- | ----------- |
| `scraper.py` | Google Maps web scraping | Playwright (async) |
| `server.js` | Web dashboard & orchestration | Express.js |
| `auditor.js` | Lighthouse performance auditing | Puppeteer + Lighthouse |
| `outreach_agent.py` | AI message generation | OpenAI GPT |
| `delivery_agent.py` | Email/SMS sending | SendGrid, Twilio |
| `qa_agent.py` | Quality checks | Custom validation |
| `vapi_agent_setup.js` | Voice calling setup | Vapi API |

### Pipeline Flow

```text
Google Maps
    ↓
[scraper.py] → CSV with raw leads
    ↓
[auditor.js] → Audit quality scores
    ↓
[qualifier.py] → Filter by criteria
    ↓
[outreach_agent.py] → Generate messages
    ↓
[delivery_agent.py] → Send email/SMS/voice
    ↓
[generate_demo.js] → Create custom websites
    ↓
[deploy_agent.py] → Deploy to Netlify
```

## Configuration

### Required Environment Variables

Create `.env.local` with these:

```env
# OpenAI (message generation)
OPENAI_API_KEY=sk-...

# Elevenlabs (voice synthesis)
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# Email
SENDGRID_API_KEY=...
SENDER_EMAIL=your@email.com

# SMS
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+1...

# Voice Calls
VAPI_API_KEY=...
VAPI_ASSISTANT_ID=...
VAPI_PHONE_NUMBER_ID=...

# Deployment
DEMO_BASE_URL=https://your-domain.netlify.app
```

See `.env.example` for complete list.

## Usage Examples

### 1. Scrape Google Maps

```bash
python scraper.py --city "Houston" --type "smoke shop" --max-results 100
```

Output: `leads.csv`

### 2. Audit Quality

```bash
npm run audit:fast
```

Adds Lighthouse scores to leads.

### 3. Generate Outreach

```bash
npm run outreach:preview
```

Preview messages before sending.

### 4. Send Emails

```bash
npm run email
```

Delivers emails with tracked links.

### 5. Make Voice Calls

```bash
npm run vapi:batch
```

Makes outbound calls from leads.

## Key Features

### 🔍 Smart Scraping

- Handles Google Maps anti-bot detection
- Extracts: name, address, phone, website, rating, reviews
- Consent dialog handling
- Automatic retries and error handling

### 📊 Lead Quality Auditing

- Lighthouse performance scores
- Web vitals metrics
- Mobile responsiveness checks
- Breaks down by category

### 🤖 AI-Powered Outreach

- Context-aware message generation
- Multiple message variants
- Personalization by business type
- Natural language voice scripts

### 📞 Multi-Channel Delivery

- **Email**: via SendGrid with tracking
- **SMS**: via Twilio with formatting
- **Voice**: via Vapi with natural conversation
- **Demos**: Custom website previews

## Common Tasks

### Check Scraper Status

```bash
npm run pipeline -- --dry-run
```

### Fast Audit (Skip Lighthouse)

```bash
npm run audit:fast
```

### Preview Outreach Messages

```bash
npm run outreach:preview
```

### Test Email Configuration

```bash
node test_email.js
```

### View Vapi Call Logs

```bash
cat logs/calls.jsonl
```

## Troubleshooting

### "Playwright browser not found"

```bash
python -m playwright install chromium
```

### "API keys not configured"

- Copy `.env.example` to `.env.local`
- Add your actual API keys
- Restart server

### "Google Maps blocked my requests"

- Wait 10-15 minutes before retrying
- Use `--headless` flag: `python scraper.py --headless`
- Reduce max results: `--max-results 50`

### "Email delivery failing"

- Verify SendGrid API key in `.env.local`
- Check sender email is configured
- Look at logs for detailed error

## Security

**⚠️ CRITICAL**: Never commit `.env` file with real credentials!

- `.env.local` is in `.gitignore`
- Use `.env.example` as template
- Rotate all API keys after any exposure
- See `SECURITY.md` for detailed info

## File Structure

```text
.
├── scraper.py                 # Google Maps scraper
├── server.js                  # Express dashboard
├── auditor.js                 # Lighthouse auditor
├── outreach_agent.py          # AI message gen
├── delivery_agent.py          # Email/SMS sending
├── qa_agent.py                # Quality checks
├── deploy_agent.py            # Netlify deployment
├── config.py                  # Scraper config
├── qualifier.py               # Lead filtering
├── requirements.txt           # Python deps
├── package.json               # Node deps
├── .env.example              # Config template
├── SECURITY.md               # Security guide
├── SHEETS_SETUP.md           # Sheets integration
├── data/                      # Output CSV files
├── logs/                      # Call logs
├── public/                    # Web assets
└── template/                  # Website template
```

## Performance Tips

- Use `npm run audit:fast` to skip Lighthouse (saves ~30s per lead)
- Increase concurrency: `npm run audit -- --concurrency 20`
- Run scraper with headless: `python scraper.py --headless`
- Batch process in smaller chunks: `--max-results 50`

## Support & Documentation

- **Setup Issues**: See `SECURITY.md`
- **Sheets Integration**: See `SHEETS_SETUP.md`
- **Scraper Details**: `python scraper.py --help`
- **Server API**: See routes in `server.js`

## Recent Fixes

- ✅ Removed exposed API credentials from repository
- ✅ Improved `.gitignore` to prevent future leaks
- ✅ Fixed duplicate import in `outreach_agent.py`
- ✅ Added comprehensive security documentation
- ✅ Created automated setup script

---

**Last Updated**: March 8, 2026
**Version**: 1.0.0
