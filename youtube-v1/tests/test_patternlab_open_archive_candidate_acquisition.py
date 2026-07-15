import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import patternlab_open_archive_candidate_acquisition as acquisition


class OpenArchiveCandidateAcquisitionTests(unittest.TestCase):
    def test_openverse_accepts_only_commercial_modification_compatible_license_rows(self):
        payload = {
            "results": [
                {
                    "id": "ok",
                    "title": "I-375 Detroit",
                    "creator": "Example Creator",
                    "license": "by-sa",
                    "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
                    "foreign_landing_url": "https://commons.wikimedia.org/wiki/File:Example.jpg",
                    "url": "https://upload.wikimedia.org/example.jpg",
                    "source": "wikimedia",
                },
                {
                    "id": "blocked",
                    "title": "No commercial license",
                    "creator": "Example Creator",
                    "license": "by-nc",
                    "license_url": "https://creativecommons.org/licenses/by-nc/4.0/",
                    "foreign_landing_url": "https://example.invalid/blocked",
                    "url": "https://example.invalid/blocked.jpg",
                    "source": "flickr",
                },
            ]
        }
        rows = acquisition.parse_openverse(payload, "I-375 Detroit")
        self.assertEqual([row["provider_item_id"] for row in rows], ["ok"])
        self.assertEqual(rows[0]["candidate_role"], "historical_or_context_pending_original_source_verification")

    def test_internet_archive_blocks_nc_nd_or_missing_rights(self):
        payload = {
            "response": {
                "docs": [
                    {"identifier": "public", "title": "Detroit Public Film", "licenseurl": "http://creativecommons.org/licenses/publicdomain/"},
                    {"identifier": "nc", "title": "Detroit NC Film", "licenseurl": "https://creativecommons.org/licenses/by-nc/4.0/"},
                    {"identifier": "none", "title": "Detroit Unknown Film"},
                ]
            }
        }
        rows = acquisition.parse_internet_archive(payload, "Detroit")
        self.assertEqual([row["provider_item_id"] for row in rows], ["public"])
        self.assertEqual(rows[0]["source_url"], "https://archive.org/details/public")
        self.assertEqual(rows[0]["download_url"], "")

    def test_generated_urls_encode_candidate_constraints(self):
        self.assertIn("license_type=commercial%2Cmodification", acquisition.openverse_query_url("Detroit", 12))
        self.assertIn("collection%3Aprelinger", acquisition.internet_archive_query_url("Detroit", 12))


if __name__ == "__main__":
    unittest.main()
