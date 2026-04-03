"""
SmokeShopGrowth — Pipeline Entry Point
=======================================
The primary way to run the pipeline is via the dashboard:

    npm start          # Launch the web dashboard at http://localhost:3000
    npm run pipeline   # Run the full pipeline headlessly (see run_pipeline.js)

This file exists as a convenience wrapper for running individual Python pipeline
stages from the command line.

Usage examples:
    python main.py scrape   "Houston, TX"   # Scrape leads
    python main.py qualify  data/houston-tx/leads.csv
    python main.py outreach data/houston-tx/leads_qualified.csv
    python main.py crm      data/houston-tx/leads_qualified.csv <sheet_url>
    python main.py retry                    # Process failed job retry queue
"""

import sys
import os

# Ensure src/python is on the path so scraper and other modules resolve correctly
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'python'))


def print_help():
    print(__doc__)


def main():
    if len(sys.argv) < 2:
        print_help()
        sys.exit(0)

    command = sys.argv[1].lower()

    if command == "scrape":
        from scraper import run_scraper
        city = sys.argv[2] if len(sys.argv) > 2 else None
        if not city:
            print("Usage: python main.py scrape \"City, ST\"")
            sys.exit(1)
        run_scraper(city)

    elif command == "qualify":
        import qualifier
        # qualifier.main() reads sys.argv[1] itself; shift args
        sys.argv = [sys.argv[0]] + sys.argv[2:]
        qualifier.main()

    elif command == "outreach":
        from outreach_agent import run_outreach
        if len(sys.argv) < 3:
            print("Usage: python main.py outreach <qualified_csv_path>")
            sys.exit(1)
        run_outreach(sys.argv[2])

    elif command == "crm":
        from crm_sync import sync_to_crm
        if len(sys.argv) < 4:
            print("Usage: python main.py crm <csv_path> <google_sheet_url>")
            sys.exit(1)
        sync_to_crm(sys.argv[2], sys.argv[3])

    elif command == "retry":
        from error_handler import process_retry_queue
        process_retry_queue()

    else:
        print(f"Unknown command: {command}")
        print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
