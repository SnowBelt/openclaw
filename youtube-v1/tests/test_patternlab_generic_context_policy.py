"""Regression tests for honest generic-context sourcing."""
from __future__ import annotations

import json
import unittest
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]


class GenericContextPolicyTests(unittest.TestCase):
    def test_policy_allows_semantic_generic_context_without_city_claim(self) -> None:
        policy = json.loads((BASE / "resources" / "source-media-policy.json").read_text(encoding="utf-8"))
        text = policy["visual_density_requirements"]["generic_context_rule"].lower()
        self.assertIn("foot traffic", text)
        self.assertIn("context_only", text)
        self.assertIn("must never be presented as evidence", text)

    def test_modern_context_role_cannot_carry_historical_claim(self) -> None:
        policy = json.loads((BASE / "resources" / "source-media-policy.json").read_text(encoding="utf-8"))
        role = policy["source_roles"]["modern_context"].lower()
        self.assertIn("generic human action", role)
        self.assertIn("cannot carry a historical claim", role)
        self.assertIn("must not imply", role)


if __name__ == "__main__":
    unittest.main()
