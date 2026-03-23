
# Google Maps Lead Scraper

This project is a comprehensive tool for scraping business leads from Google Maps, with a focus on automation and monetization. It includes a web server for handling webhooks, a suite of Node.js scripts for scraping and outreach, and a Python-based backend for processing data and sending emails.

## Tech Stack

*   **Backend:** Python (Flask), Node.js
*   **Frontend:** (Not yet implemented, but intended to be vanilla HTML/JS/CSS)
*   **Scraper:** Node.js (likely using a library like Playwright or Puppeteer)
*   **Deployment:** Docker, Railway, Render

## Project Structure

```
├── server.js              # Dashboard web server (Express)
├── main.py                # Python entry point (webhook server)
├── src/
│   ├── python/            # Core Python modules (scraper, qualifier, webhook)
│   ├── node/              # Core Node modules (auditor, outreach, email, vapi)
│   └── agents/            # Python agents (delivery, deploy, domain, QA)
├── scripts/               # Pipeline runners and setup scripts
├── template/              # Website template for lead sites
├── public/                # Static dashboard assets
├── demo/                  # Demo site assets
├── docs/                  # Guides, reports, and documentation
├── tests/                 # Python and Node test suites
└── .github/workflows/     # CI pipeline
```

## Quick Start

### Prerequisites

- Node.js 18+ and Python 3.10+
- Playwright: `pip install playwright && playwright install chromium`

### Setup

```bash
# Install dependencies
npm install
pip install -r requirements.txt

# Configure environment
cp .env.example .env.local
# Edit .env.local with your API keys (see table below)
```

### Run

```bash
# Start dashboard
npm start                    # http://localhost:3000

# Run full pipeline
npm run pipeline -- --city "Houston" --type "smoke shop"

# Individual steps
python src/python/scraper.py --city "Houston" --type "smoke shop"
npm run audit
npm run outreach
npm run email
```

### Docker

```bash
docker-compose up
```

## Deployment

### Railway

1. Push to GitHub and connect your repo in [Railway](https://railway.app)
2. Set environment variables in Railway's dashboard (see table below)
3. Railway uses the `Procfile` — no extra config needed
4. Health checks hit `GET /health` automatically

### Render

Set the start command to `node server.js` and configure the same environment variables.

## Environment Variables

| Variable | Service | Required |
|----------|---------|----------|
| `OPENAI_API_KEY` | OpenAI (outreach generation) | ✅ |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Email delivery | ✅ |
| `ELEVENLABS_API_KEY` | AI phone calls | Optional |
| `ELEVENLABS_AGENT_ID` | ElevenLabs agent | Optional |
| `ELEVENLABS_PHONE_NUMBER_ID` | ElevenLabs phone | Optional |
| `VAPI_API_KEY`, `VAPI_ASSISTANT_ID` | AI phone calls (Vapi) | Optional |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | SMS follow-ups | Optional |
| `STRIPE_API_KEY` | Payments | Optional |
| `MINIMAX_API_KEY` | Demo video generation | Optional |
| `SPREADSHEET_ID` | Google Sheets export | Optional |
| `API_KEY` | Webhook authentication | Recommended |
| `NODE_ENV` | Runtime environment | Recommended |

See `.env.example` for the full list.

## npm Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start dashboard server |
| `npm run pipeline` | Run full scrape → audit → outreach pipeline |
| `npm run audit` | Audit lead websites with Lighthouse |
| `npm run audit:fast` | Audit without Lighthouse (faster) |
| `npm run outreach` | Generate personalized outreach messages |
| `npm run email` | Send outreach emails |
| `npm run vapi:call` | Make AI phone calls |
| `npm test` | Run test suite |
| `npm run lint` | Lint JS + Python |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check — returns uptime & job count |
| `POST` | `/api/run` | Start a pipeline job |
| `GET` | `/api/status/:jobId` | SSE stream for job progress |
| `GET` | `/api/jobs` | List all jobs |
| `GET` | `/api/download/:jobId/:file` | Download result CSV |
| `POST` | `/api/create-checkout` | Create Stripe checkout session |
| `POST` | `/webhook/call` | Trigger an ElevenLabs outbound call |
| `POST` | `/api/template-submission` | Accept a lead form submission |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Playwright not found | `pip install playwright && playwright install chromium` |
| SMTP auth fails | Use Gmail App Password (not regular password) |
| Lighthouse timeout | Use `npm run audit:fast` to skip Lighthouse |
| Port 3000 in use | Set `PORT=3001` in `.env.local` |
| Stripe not working | Ensure `STRIPE_API_KEY` is set in `.env.local` |
| ElevenLabs call fails | Set `ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID` |

## Security

- Never commit `.env`, `.env.local`, or `credentials.json`
- All secrets should be in `.env.local` (gitignored)
- Protect `/webhook/call` and `/api/create-checkout` with `API_KEY` header
- See `docs/SECURITY.md` for full security guidelines

## Contributing

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes and add tests where applicable
3. Run `npm run lint` and `npm test` before committing
4. Open a pull request with a clear description of the change
*   `.github/workflows/`: Contains CI/CD pipeline configurations.
*   `data/`: For storing data such as scraped leads.
*   `src/`: Contains the main source code, divided into `node` and `python`.
*   `src/agents/`: Contains the core business logic for agents (e.g., `deploy_agent.py`).
*   `src/node/`: Contains all Node.js scripts for scraping, outreach, and other tasks.
*   `src/python/`: Contains the Python backend, including the Flask web server for handling webhooks.

## Setup and Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    ```

2.  **Install dependencies:**
    *   **Node.js:**
        ```bash
        npm install
        ```
    *   **Python:**
        ```bash
        pip install -r requirements.txt
        ```

3.  **Set up environment variables:**
    *   Copy the `.env.example` file to a new file named `.env.local`.
    *   Fill in the required API keys and credentials in `.env.local`. This includes keys for Vapi, Stripe, OpenAI, and your SMTP server for sending emails.

## Running the Application

*   **To run the main webhook server:**
    ```bash
    python src/python/webhook.py
    ```
    *Note: There is a known issue with the Flask environment that may cause "404 Not Found" errors. This is likely due to a misconfiguration in the system's PATH.* 

*   **To run other scripts:**
    *   Individual Node.js and Python scripts can be run directly from the command line. For example:
        ```bash
        node src/node/places_scraper.js
        ```

## Known Issues

*   **Flask Server "404 Not Found" Errors:** There is a persistent issue with the Flask server not correctly routing requests, even for simple test cases. This is likely due to an environment-specific problem with the Python or Flask installation. The warning `The script flask.exe is installed in ... which is not on PATH` is a strong indicator of the root cause.
*   **`@bonsai-ai/cli` Crash:** The `@bonsai-ai/cli` tool is crashing with an `Assertion failed` error. This appears to be a bug in the CLI itself.

