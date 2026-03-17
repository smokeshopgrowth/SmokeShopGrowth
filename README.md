
# Google Maps Lead Scraper

This project is a comprehensive tool for scraping business leads from Google Maps, with a focus on automation and monetization. It includes a web server for handling webhooks, a suite of Node.js scripts for scraping and outreach, and a Python-based backend for processing data and sending emails.

## Tech Stack

*   **Backend:** Python (Flask), Node.js
*   **Frontend:** (Not yet implemented, but intended to be vanilla HTML/JS/CSS)
*   **Scraper:** Node.js (likely using a library like Playwright or Puppeteer)
*   **Deployment:** Docker, Railway, Render

## Project Structure

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

