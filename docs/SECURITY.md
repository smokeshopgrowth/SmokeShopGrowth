# Security & Setup Guide

## Critical Security Issues Resolved

### 🔴 Exposed Credentials (FIXED)
**Status**: ✅ RESOLVED (March 8, 2026)

The `.env` file contained live API credentials that were committed to the repository:
- OpenAI API key
- ElevenLabs API key  
- Twilio credentials
- SendGrid API key
- Vapi credentials
- Stripe keys
- SMTP credentials

**Actions Taken:**
1. ✅ Removed `.env` from git tracking using `git rm --cached -f .env`
2. ✅ Created comprehensive `.env.example` with all required variables and placeholders
3. ✅ Created `.env.local` template for local development
4. ✅ Updated `.gitignore` to prevent future credential leaks
5. ✅ Committed security improvements (commit: 13bb764)

### Next Steps - CREDENTIAL ROTATION REQUIRED

**All exposed credentials should be rotated immediately:**

- [ ] **OpenAI**: Revoke old key at https://platform.openai.com/account/api-keys
- [ ] **ElevenLabs**: Rotate API key in account settings  
- [ ] **Twilio**: Regenerate auth token in Twilio Console
- [ ] **SendGrid**: Create new API key, disable old one
- [ ] **Vapi**: Regenerate API key in Vapi dashboard
- [ ] **Stripe**: Rotate API keys in Dashboard → Developers → API Keys
- [ ] **SMTP (Gmail)**: Generate new app password at myaccount.google.com

## Setup Instructions

### 1. Environment Configuration

Copy the template and add your credentials:
```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual credentials (NOT committed to git):
```env
# Example structure
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
TWILIO_ACCOUNT_SID=...
# ... etc
```

### 2. Install Dependencies

**Node.js:**
```bash
npm install
```

**Python:**
```bash
pip install -r requirements.txt
playwright install chromium
```

### 3. Start the Server

```bash
npm start
# or
node server.js
```

Server runs on http://localhost:3000

## Project Architecture

### Components

| Component | Type | Purpose |
|-----------|------|---------|
| `scraper.py` | Python | Google Maps lead scraping with Playwright |
| `server.js` | Node.js | Express dashboard and pipeline orchestrator |
| `outreach_agent.py` | Python | AI-powered outreach message generation |
| `delivery_agent.py` | Python | SMS/Email delivery via Twilio & SendGrid |
| `qa_agent.py` | Python | Quality assurance and validation |
| `deploy_agent.py` | Python | Website deployment automation |
| `vapi_agent_setup.js` | Node.js | Vapi voice agent configuration |

### Key Scripts

- `npm start` - Run dashboard server
- `npm run pipeline` - Execute full scraping → audit → outreach pipeline
- `npm run audit` - Audit lead quality with Lighthouse
- `npm run outreach` - Generate personalized outreach messages
- `npm run email` - Send emails to leads
- `npm run vapi:*` - Manage Vapi voice calling

## Environment Variables Reference

See `.env.example` for complete list. Critical variables:

```
# APIs
OPENAI_API_KEY              # For message generation
ELEVENLABS_API_KEY          # For voice synthesis
VAPI_API_KEY                # For outbound calls
SENDGRID_API_KEY            # Email delivery
TWILIO_ACCOUNT_SID          # SMS delivery

# Services
SMTP_HOST, SMTP_PORT        # Email server
TWILIO_PHONE_NUMBER         # SMS sender
STRIPE_API_KEY              # Payment processing

# Config
DEMO_BASE_URL               # Public URL for demo sites
WEBHOOK_PORT, WEBHOOK_URL   # For Vapi callbacks
```

## Best Practices

1. **Never commit `.env`** - Always use `.env.local` or `.env.*.local` for local development
2. **Rotate credentials regularly** - Especially after any exposure
3. **Use environment-specific keys** - Different keys for dev/staging/production
4. **Monitor API usage** - Set up alerts in service dashboards
5. **Audit git history** - Ensure no credentials in commit history
6. **Use `.gitignore`** - Include all sensitive file patterns

## Testing the Setup

```bash
# Verify Python packages
python -m py_compile scraper.py outreach_agent.py delivery_agent.py

# Verify Node.js syntax
node -c server.js

# List npm dependencies
npm list --depth=0

# Test basic scraper (dry run, no actual scraping)
python scraper.py --help
```

## Support

For issues or questions about setup, refer to individual component documentation:
- `scraper.py` docstring for scraping parameters
- `SHEETS_SETUP.md` for Google Sheets integration
- `package.json` scripts section for available commands

---

**Last Updated**: March 8, 2026
**Status**: ✅ Security audit completed
