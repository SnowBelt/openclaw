import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from patternlab_fetch_youtube_analytics import dedupe_rows as dedupe_api_rows
from patternlab_import_studio_metrics import dedupe_rows as dedupe_studio_rows


class ReliabilityGuardTests(unittest.TestCase):
    def test_api_rows_dedupe_by_youtube_asset_surface_and_checkpoint(self):
        rows = [
            {
                "video_id": "03",
                "youtube_video_id": "abc",
                "surface": "long-form",
                "hours_since_publish": "24",
                "views": "16",
            },
            {
                "video_id": "03",
                "youtube_video_id": "abc",
                "surface": "long-form",
                "hours_since_publish": "24",
                "average_percentage_viewed": "35.48",
            },
        ]
        result = dedupe_api_rows(rows)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["views"], "16")
        self.assertEqual(result[0]["average_percentage_viewed"], "35.48")

    def test_studio_rows_dedupe_keeps_distinct_checkpoints(self):
        rows = [
            {"video_id": "03", "surface": "long-form", "hours_since_publish": "24", "views": "16"},
            {"video_id": "03", "surface": "long-form", "hours_since_publish": "72", "views": "22"},
            {"video_id": "03", "surface": "long-form", "hours_since_publish": "24", "ctr_percent": "5.2"},
        ]
        result = dedupe_studio_rows(rows)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["ctr_percent"], "5.2")


if __name__ == "__main__":
    unittest.main()
