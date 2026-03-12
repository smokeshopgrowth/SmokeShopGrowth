"""Tests for the scraper module — unit tests only (no browser needed)."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'python'))

from scraper import Business


def test_business_dataclass_defaults():
    biz = Business(business_name="Test Shop", address="123 Main St")
    assert biz.business_name == "Test Shop"
    assert biz.address == "123 Main St"
    assert biz.phone == ""
    assert biz.website == ""


def test_business_to_dict():
    biz = Business(business_name="Test Shop", address="123 Main St", phone="555-1234")
    from dataclasses import asdict
    d = asdict(biz)
    assert d["business_name"] == "Test Shop"
    assert d["phone"] == "555-1234"


if __name__ == "__main__":
    test_business_dataclass_defaults()
    test_business_to_dict()
    print("All scraper tests passed!")
