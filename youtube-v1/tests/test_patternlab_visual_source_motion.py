from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import patternlab_free_stock_acquisition as free_stock
import patternlab_local_generation_router as local_router
import patternlab_thumbnail_semantic_quality as semantic
import patternlab_visual_acquisition_quality as acquisition
import source_visual_rebuild_assets as source_rebuild


class VisualSourceMotionTests(unittest.TestCase):
    def setUp(self):
        source_rebuild.PROVIDER_EVENTS.clear()

    def test_exact_item_url_rejects_provider_search_pages(self):
        blocked = ["candidate-search://", "/search/", "/search?"]
        self.assertFalse(acquisition.source_url_is_exact("https://www.pexels.com/search/videos/detroit/", blocked))
        self.assertTrue(acquisition.source_url_is_exact("https://www.pexels.com/video/cars-on-a-detroit-street-123456/", blocked))
        self.assertTrue(acquisition.source_url_is_exact("https://commons.wikimedia.org/wiki/File:Detroit.jpg", blocked))

    def test_historical_match_does_not_trust_search_query_notes(self):
        asset = {
            "source_title": "Singer performing the Black Bottom dance in London",
            "source_url": "https://example.invalid/black-bottom-dance",
            "notes": "query=Black Bottom Detroit",
        }
        self.assertFalse(acquisition.historical_entity_match(asset, ["detroit"], ["black bottom"]))

    def test_pixel_gate_blocks_gloomy_modern_thumbnail_inset(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            dull = root / "dull.jpg"
            Image.new("RGB", (640, 360), (110, 110, 120)).save(dull)
            candidate = {
                "id": "dull",
                "composition_mode": "proof_context",
                "visual_objects": [
                    {"role": "proof", "kind": "map", "source_url": "https://www.loc.gov/item/x/", "slot": "background"},
                    {"role": "context", "kind": "modern_photo", "source_url": "https://example.com/item", "local_path": str(dull), "slot": "inset"},
                ],
                "visible_proof_area_ratio": 0.5,
                "hero_luminance": "bright",
                "generic_text_card": False,
                "non_city_word_count": 3,
                "public_text": ["DETROIT", "MAP CHANGED"],
            }
            row = semantic.validate_candidate(candidate, root)
            self.assertEqual(row["status"], "blocked")
            self.assertIn("modern_thumbnail_source_saturation_below_floor", row["blockers"])

    def test_thumbnail_energy_reader_uses_canonical_review_manifest(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            approval.mkdir()
            hero = root / "hero.jpg"
            Image.new("RGB", (640, 360), (240, 160, 40)).save(hero)
            (approval / "thumbnail-codex-primary-review.json").write_text(
                json.dumps(
                    {
                        "candidates": [
                            {
                                "id": "canonical-candidate",
                                "visual_objects": [
                                    {"kind": "modern_photo", "slot": "hero", "local_path": str(hero)}
                                ],
                            },
                            "invalid-candidate-member",
                        ]
                    }
                ),
                encoding="utf-8",
            )

            rows = acquisition.thumbnail_energy_rows(
                root,
                {
                    "modern_thumbnail_visual_energy": {
                        "minimum_mean_luma": 0.1,
                        "minimum_mean_saturation": 0.1,
                        "minimum_luma_standard_deviation": 0.0,
                    }
                },
            )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["candidate_id"], "canonical-candidate")
        self.assertEqual(rows[0]["status"], "pass")

    def test_pexels_parser_keeps_exact_item_creator_and_download(self):
        payload = {
            "videos": [
                {
                    "id": 42,
                    "url": "https://www.pexels.com/video/detroit-street-42/",
                    "duration": 9,
                    "user": {"name": "Creator Name"},
                    "video_files": [
                        {"width": 1920, "height": 1080, "file_size": 10, "link": "https://cdn.example/42.mp4"}
                    ],
                }
            ]
        }
        rows = free_stock.parse_pexels(payload, "Detroit street")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["creator"], "Creator Name")
        self.assertEqual(rows[0]["download_url"], "https://cdn.example/42.mp4")
        self.assertIn("/video/", rows[0]["source_url"])

    def test_pixabay_parser_keeps_exact_item_creator_and_download(self):
        payload = {
            "hits": [
                {
                    "id": 7,
                    "pageURL": "https://pixabay.com/videos/detroit-city-7/",
                    "user": "Creator",
                    "duration": 5,
                    "videos": {"large": {"url": "https://cdn.example/7.mp4", "width": 1920, "height": 1080}},
                }
            ]
        }
        rows = free_stock.parse_pixabay(payload, "Detroit")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["creator"], "Creator")
        self.assertEqual(rows[0]["download_url"], "https://cdn.example/7.mp4")

    def test_local_router_is_degraded_not_falsely_ready_without_ai_benchmarks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "video-04"
            (root / "approval").mkdir(parents=True)
            with patch.object(local_router, "output_root", return_value=root), patch.object(
                local_router, "BASE", Path(temp)
            ), patch.object(local_router, "model_rows", return_value=[]), patch.object(
                local_router, "comfy_health", return_value=(False, "offline")
            ), patch.object(local_router.shutil, "which", side_effect=lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None):
                (Path(temp) / "resources").mkdir(parents=True)
                (Path(temp) / "resources" / "local-visual-generation-routing-policy.json").write_text(
                    json.dumps({"version": 1}), encoding="utf-8"
                )
                payload, _, _ = local_router.build_report("04")
            self.assertEqual(payload["status"], "degraded")
            self.assertEqual(payload["routes"]["deterministic_motion"], "ready")
            self.assertEqual(payload["routes"]["local_routine_stills"], "blocked")
            self.assertTrue(payload["no_silent_paid_fallback"])

    def test_draw_things_ltx_receipt_can_satisfy_local_video_route(self):
        benchmark = {
            "status": "pass",
            "local_only": True,
            "engine": "draw_things_ltx_2_3",
            "model_hash_verified": True,
            "source_image_sha256": "a" * 64,
            "output_sha256": "b" * 64,
        }
        ready, reason = local_router.local_video_route_ready(
            benchmark, draw_cli_present=True, comfy_ready=False
        )
        self.assertTrue(ready)
        self.assertEqual(reason, "draw_things_ltx_2_3")

    def test_draw_things_ltx_receipt_fails_when_model_hash_is_unverified(self):
        benchmark = {
            "status": "pass",
            "local_only": True,
            "engine": "draw_things_ltx_2_3",
            "model_hash_verified": False,
            "source_image_sha256": "a" * 64,
            "output_sha256": "b" * 64,
        }
        ready, reason = local_router.local_video_route_ready(
            benchmark, draw_cli_present=True, comfy_ready=False
        )
        self.assertFalse(ready)
        self.assertEqual(reason, "draw_things_receipt_incomplete")

    def test_comfyui_route_requires_endpoint_and_workflow_hash(self):
        benchmark = {
            "status": "pass",
            "local_only": True,
            "engine": "comfyui",
            "model_hash_verified": True,
            "workflow_sha256": "a" * 64,
            "output_sha256": "b" * 64,
        }
        self.assertEqual(
            local_router.local_video_route_ready(
                benchmark, draw_cli_present=False, comfy_ready=True
            ),
            (True, "comfyui"),
        )

    def test_public_archive_fetch_uses_fresh_cache_without_network(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(
            source_rebuild, "CACHE_ROOT", Path(temp)
        ):
            url = "https://example.invalid/item.json"
            cache = source_rebuild._json_cache_path(url)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"cached": True}), encoding="utf-8")
            with patch.object(source_rebuild.urllib.request, "urlopen") as urlopen:
                self.assertEqual(source_rebuild.fetch_json(url), {"cached": True})
                urlopen.assert_not_called()

    def test_public_archive_fetch_uses_stale_cache_when_provider_rate_limits(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(
            source_rebuild, "CACHE_ROOT", Path(temp)
        ):
            url = "https://www.loc.gov/item.json"
            cache = source_rebuild._json_cache_path(url)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps({"cached": "stale"}), encoding="utf-8")
            old = source_rebuild.CACHE_TTL_SECONDS + 60
            os.utime(cache, (cache.stat().st_atime - old, cache.stat().st_mtime - old))
            error = urllib.error.HTTPError(url, 429, "rate limited", {}, None)
            with patch.object(source_rebuild.urllib.request, "urlopen", side_effect=error):
                self.assertEqual(source_rebuild.fetch_json(url), {"cached": "stale"})


if __name__ == "__main__":
    unittest.main()
