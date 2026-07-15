import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(YOUTUBE_ROOT))
sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

import patternlab_thumbnail_font_quality as font_quality
import patternlab_thumbnail_pixel_quality as pixel_quality
import patternlab_thumbnail_semantic_quality as semantic_quality
from patternlab.thumbnail import load_thumbnail_candidate_manifest
from patternlab.thumbnail.quality import candidate_issues, quality_status


class PatternLabThumbnailArchitectureTests(unittest.TestCase):
    def test_manifest_repository_filters_invalid_candidate_members(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            approval.mkdir()
            path = approval / "thumbnail-codex-primary-review.json"
            path.write_text(json.dumps({"candidates": [{"id": "valid"}, "invalid", 3]}))

            manifest = load_thumbnail_candidate_manifest(root)

        self.assertEqual(manifest.path, path)
        self.assertEqual([candidate["id"] for candidate in manifest.candidates], ["valid"])

    def test_manifest_repository_is_fail_closed_for_invalid_json(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            approval.mkdir()
            (approval / "thumbnail-codex-primary-review.json").write_text("not json")

            manifest = load_thumbnail_candidate_manifest(root)
            manifest_exists = manifest.exists

        self.assertTrue(manifest_exists)
        self.assertEqual(manifest.candidates, ())
        self.assertEqual(quality_status(has_candidates=False, blockers=[]), "blocked")

    def test_pixel_legacy_manifest_helper_delegates_to_domain_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            approval.mkdir()
            path = approval / "thumbnail-codex-primary-review.json"
            path.write_text(json.dumps({"candidates": [{"id": "candidate"}]}))

            actual_path, candidates = pixel_quality.candidate_manifest(root)

        self.assertEqual(actual_path, path)
        self.assertEqual(candidates, [{"id": "candidate"}])

    def test_semantic_and_pixel_reports_share_manifest_fail_closed_behavior(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "approval").mkdir()
            with patch.object(pixel_quality, "output_root", return_value=root), patch.object(semantic_quality, "output_root", return_value=root):
                pixel_report, _, _ = pixel_quality.build_report("04")
                semantic_report, _, _ = semantic_quality.build_report("04")

        self.assertEqual(pixel_report["status"], "blocked")
        self.assertIn("thumbnail_candidate_manifest_missing_or_empty", pixel_report["blockers"])
        self.assertEqual(semantic_report["status"], "blocked")
        self.assertIn("thumbnail_semantic_candidate_manifest_missing", semantic_report["blockers"])

    def test_font_adapter_consumes_canonical_manifest_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            approval.mkdir()
            image = root / "candidate.png"
            Image.new("RGB", (1280, 720), (240, 180, 20)).save(image)
            (approval / "thumbnail-codex-primary-review.json").write_text(
                json.dumps(
                    {
                        "candidates": [
                            {
                                "id": "candidate",
                                "city": "Cleveland",
                                "path": str(image),
                                "public_text": ["CLEVELAND", "BURNED"],
                                "typography": {
                                    "city_font": "Anton",
                                    "main_font": "Bowlby One SC",
                                    "support_font": "Anton",
                                    "city_stroke_width": 3,
                                    "main_stroke_width": 2,
                                    "support_stroke_width": 0,
                                },
                            }
                        ]
                    }
                )
            )

            entries = font_quality.iter_chrome_fontsource_entries(root)

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["file"], "candidate.png")
        self.assertEqual(entries[0]["font"]["city_anchor"]["family"], "Anton")

    def test_candidate_issue_aggregation_is_stable_and_candidate_qualified(self):
        issues = candidate_issues(
            [
                {"id": "b", "blockers": ["dim", "dim"]},
                {"id": "a", "blockers": ["text"]},
            ],
            "blockers",
            deduplicate=True,
        )
        self.assertEqual(issues, ["a:text", "b:dim"])


if __name__ == "__main__":
    unittest.main()
