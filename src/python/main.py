"""
SmokeShopGrowth — Main Entry Point
===================================
For Railway/Render deployment, this starts the unified webhook server.
For local dev, use individual scripts directly.

Usage:
    python main.py                  → starts webhook server (Stripe + Vapi)
    python main.py --retry-queue    → process failed job retry queue
    python main.py --upsell         → run upsell drip cron
"""

import os
import sys

# Add source directories to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'python'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src', 'agents'))

def main():
    args = sys.argv[1:]

    if '--retry-queue' in args:
        from error_handler import process_retry_queue
        process_retry_queue()

    elif '--upsell' in args:
        from upsell_cron import process_upsell_queue
        process_upsell_queue()

    else:
        # Default: start the unified Flask webhook server
        from webhook import app
        port = int(os.environ.get('PORT', 4242))
        is_debug = os.environ.get('FLASK_DEBUG', '').lower() == 'true'
        print(f"Starting SmokeShopGrowth webhook server on port {port}...")
        app.run(host='0.0.0.0', port=port, debug=is_debug)


if __name__ == '__main__':
    main()
