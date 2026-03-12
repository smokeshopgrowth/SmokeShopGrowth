"""Tests for the lead qualifier module."""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src', 'python'))

from qualifier import clean_business_name


def test_clean_business_name_strips_pipe_suffix():
    result = clean_business_name("Cloud 9 Smoke Shop | Vape | CBD | Kratom")
    assert result == "Cloud 9 Smoke Shop"


def test_clean_business_name_strips_dash_suffix():
    result = clean_business_name("Eagle Smoke - Tobacco - Open 24 Hours")
    assert result == "Eagle Smoke"


def test_clean_business_name_returns_default_for_empty():
    assert clean_business_name("") == "Unknown Shop"
    assert clean_business_name(None) == "Unknown Shop"


def test_clean_business_name_preserves_simple_name():
    assert clean_business_name("Puff Daddy Smoke Shop") == "Puff Daddy Smoke Shop"


if __name__ == "__main__":
    test_clean_business_name_strips_pipe_suffix()
    test_clean_business_name_strips_dash_suffix()
    test_clean_business_name_returns_default_for_empty()
    test_clean_business_name_preserves_simple_name()
    print("All qualifier tests passed!")
