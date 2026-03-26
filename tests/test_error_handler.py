"""Tests for the error_handler module."""

import sys
import os
import json
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'python'))

import error_handler
from error_handler import log_failed_job

class TestErrorHandler(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_log = os.path.join(self.temp_dir.name, "failed_jobs.jsonl")
        self.original_log_file = error_handler.FAILED_JOBS_LOG
        error_handler.FAILED_JOBS_LOG = self.temp_log

    def tearDown(self):
        error_handler.FAILED_JOBS_LOG = self.original_log_file
        self.temp_dir.cleanup()

    def test_log_failed_job_writes_json(self):
        job_type = "test_job"
        data = {"key": "value"}
        error_msg = "A test error occurred"
        
        log_failed_job(job_type, data, error_msg)
        
        self.assertTrue(os.path.exists(self.temp_log))
        with open(self.temp_log, "r", encoding="utf-8") as f:
            lines = f.readlines()
            
        self.assertEqual(len(lines), 1)
        record = json.loads(lines[0])
        self.assertEqual(record["job_type"], job_type)
        self.assertEqual(record["error"], error_msg)
        self.assertDictEqual(record["data"], data)
        self.assertIn("timestamp", record)

if __name__ == "__main__":
    unittest.main()
