"""
error_handler.py — Centralised failure logging for background jobs.

Logs failed jobs to a JSONL file so they can be inspected and retried.
"""

import json
import os
from datetime import datetime

from logger import get_logger

log = get_logger(__name__)

FAILED_JOBS_LOG = os.environ.get("FAILED_JOBS_LOG", "logs/failed_jobs.jsonl")


def log_failed_job(job_type: str, data: dict, error_msg: str) -> None:
    """
    Log a failed background job to a JSONL file for retry/inspection.

    Args:
        job_type:  Category of failure (e.g. 'deploy', 'delivery', 'email').
        data:      Contextual payload that caused the failure.
        error_msg: Human-readable error description.
    """
    record = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "job_type": job_type,
        "error": error_msg,
        "data": data,
    }

    log.error(f"[{job_type.upper()}] Job failed: {error_msg}")

    try:
        log_dir = os.path.dirname(FAILED_JOBS_LOG)
        if log_dir:
            os.makedirs(log_dir, exist_ok=True)
        with open(FAILED_JOBS_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        log.debug(f"Failure logged to {FAILED_JOBS_LOG}")
    except OSError as e:
        log.warning(f"Could not write to failed jobs log ({FAILED_JOBS_LOG}): {e}")
