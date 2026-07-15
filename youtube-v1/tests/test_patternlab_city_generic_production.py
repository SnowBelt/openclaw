"""Cross-city regression proof for the canonical Pattern Lab production path."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image


YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = YOUTUBE_ROOT / "scripts"
for value in (str(YOUTUBE_ROOT), str(SCRIPTS)):
    if value not in sys.path:
        sys.path.insert(0, value)

from patternlab.production import load_contract
from patternlab.rights import acceptance_blockers
from patternlab.state import sha256_file
import patternlab_local_still_tournament as local_tournament
import patternlab_free_stock_acquisition as free_stock
import patternlab_context_media_library as context_library
import patternlab_source_pool_compiler as source_pool
import patternlab_long_form_media_qa as long_form_qa
import patternlab_thumbnail_worldclass as thumbnail_worldclass
import patternlab_visual_prompt_compiler as prompt_compiler


class PatternLabCityGenericProductionTests(unittest.TestCase):
    def test_stock_auto_selection_is_bounded_per_provider_and_context(self) -> None:
        candidates = [
            {"provider": provider, "context_action": action, "provider_item_id": str(index)}
            for provider in ("Pexels", "Pixabay")
            for action in ("foot_traffic", "industrial_labor")
            for index in range(3)
        ]
        selected = free_stock.select_candidate_downloads(candidates, per_context=1)
        keys = {(row["provider"], row["context_action"]) for row in selected}
        self.assertEqual(len(selected), 4)
        self.assertEqual(len(keys), 4)

    def test_canonical_patternlab_scripts_import_from_repo_root(self) -> None:
        contract = json.loads(
            (YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json").read_text(
                encoding="utf-8"
            )
        )
        script_paths = {
            token
            for profile in contract["profiles"].values()
            for stage in profile["stages"]
            for token in stage["command"]
            if isinstance(token, str) and token.startswith("youtube-v1/scripts/") and token.endswith(".py")
        }
        failures: list[str] = []
        for relative in sorted(script_paths):
            result = subprocess.run(
                [sys.executable, str(YOUTUBE_ROOT.parent / relative), "--help"],
                cwd=YOUTUBE_ROOT.parent,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                failures.append(f"{relative}: {result.stderr.strip()}")
        self.assertEqual(failures, [])

    def test_downloaded_free_stock_receipt_is_machine_rights_complete_but_candidate_only(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / "source-packet" / "stock-media" / "candidates" / "pexels-123-busy-street.mp4"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"rights-cleared generic context")
            candidate = {
                "provider": "Pexels",
                "provider_item_id": "123",
                "query": "busy street",
                "source_url": "https://www.pexels.com/video/people-walking-123/",
                "download_url": "https://videos.pexels.com/video-files/123/123-hd.mp4",
                "source_title": "People walking on a busy street",
                "creator": "Fixture Creator",
                "license_or_rights_basis": "Pexels License",
                "editorial_role": "context_only",
                "geographic_scope": "generic",
                "may_imply_named_city": False,
                "source_role": "modern_context",
                "context_action": "foot_traffic",
                "context_emotion": "busy street life",
            }
            receipt = free_stock.download_candidate(root, candidate)
            self.assertTrue(receipt["candidate_only"])
            self.assertEqual(receipt["acceptance_mode"], "machine_verified_exact_license")
            self.assertEqual(receipt["license_code"], "pexels-license")
            rights_item = {
                **receipt,
                "asset_id": "generic-foot-traffic-01",
                "rights_basis": receipt["rights_basis"],
            }
            self.assertEqual(
                acceptance_blockers(rights_item, episode_root=root, youtube_root=YOUTUBE_ROOT),
                [],
            )
            row = context_library.validate_receipt(
                root,
                target.with_suffix(".source.json"),
                {"foot_traffic"},
            )
            self.assertEqual(row["status"], "reusable")
            self.assertEqual(row["production_acceptance_mode"], "machine_verified_exact_license")
            promotion_blockers: list[str] = []
            promoted = source_pool.machine_accepted_context_assets(root, promotion_blockers)
            self.assertEqual(promotion_blockers, [])
            self.assertEqual([item["asset_id"] for item in promoted], ["stock-pexels-123"])
            self.assertEqual(promoted[0]["editorial_role"], "context_only")

    def test_cleveland_prompt_keeps_city_only_in_truth_boundary(self) -> None:
        policy = {
            "generation_roles": ["reconstruction"],
            "blocked_generation_roles": ["proof", "system"],
            "default_negative_prompt": "text, logo, watermark",
            "candidate_tournament": {"draft_candidate_count": 2, "seed_base": 100},
        }
        beat = {
            "beat_id": "beat-07",
            "visual_mode": "reconstruction",
            "ai_support_allowed": True,
            "claim_scope": "generic",
            "claim_ids": ["worker-consequence"],
            "planned_ai_asset_id": "video-07-local-ai-beat-07",
            "narration_excerpt": "Workers crossed a busy industrial street.",
            "visible_action": "workers crossing one busy industrial street",
        }
        compiled = prompt_compiler.compile_beat(beat, policy, 7, city="Cleveland")
        self.assertTrue(compiled["generation_allowed"])
        self.assertIn("not evidence of Cleveland", compiled["prompt"])
        self.assertNotIn("Detroit", compiled["prompt"])
        self.assertEqual(compiled["planned_ai_asset_id"], "video-07-local-ai-beat-07")

    def test_machine_verified_item_rights_pass_and_search_page_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            local = root / "source-packet" / "stock-media" / "people-walking.mp4"
            local.parent.mkdir(parents=True)
            local.write_bytes(b"generic people walking")
            item = {
                "asset_id": "cleveland-context-01",
                "rights_basis": "Pexels License",
                "commercial_use_ok": True,
                "modification_ok": True,
                "acceptance_mode": "machine_verified_exact_license",
                "source_url": "https://www.pexels.com/video/people-walking-downtown-12345/",
                "download_url": "https://videos.pexels.com/video-files/12345/12345-hd.mp4",
                "license_url": "https://www.pexels.com/license/",
                "license_code": "pexels-license",
                "retrieved_at": "2026-07-14T12:00:00Z",
                "relative_path": str(local.relative_to(root)),
                "sha256": sha256_file(local),
            }
            self.assertEqual(acceptance_blockers(item, episode_root=root, youtube_root=YOUTUBE_ROOT), [])
            item["source_url"] = "https://www.pexels.com/search/videos/people%20walking/"
            blockers = acceptance_blockers(item, episode_root=root, youtube_root=YOUTUBE_ROOT)
            self.assertIn(
                "source_pool_machine_acceptance_exact_source_url_missing:cleveland-context-01",
                blockers,
            )

    def test_generated_support_requires_hash_bound_pass_receipt(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "source-packet" / "selected-local-ai" / "beat-07.png"
            receipt = root / "approval" / "local-still-selection-receipts" / "beat-07.json"
            image.parent.mkdir(parents=True)
            receipt.parent.mkdir(parents=True)
            Image.new("RGB", (64, 64), (180, 120, 70)).save(image)
            receipt.write_text(
                json.dumps({"status": "pass", "blockers": [], "output_sha256": sha256_file(image)}),
                encoding="utf-8",
            )
            item = {
                "asset_id": "video-07-local-ai-beat-07",
                "relative_path": "source-packet/selected-local-ai/beat-07.png",
                "rights_basis": "Pattern Lab original locally generated non-proof support",
                "commercial_use_ok": True,
                "modification_ok": True,
                "acceptance_mode": "patternlab_original_generated",
                "source_class": "ai_reconstruction",
                "editorial_role": "reconstruction",
                "geographic_scope": "generic",
                "may_imply_named_city": False,
                "on_screen_disclosure": long_form_qa.DISCLOSURE,
                "selection_receipt": "approval/local-still-selection-receipts/beat-07.json",
                "selection_receipt_sha256": sha256_file(receipt),
            }
            self.assertEqual(acceptance_blockers(item, episode_root=root, youtube_root=YOUTUBE_ROOT), [])
            receipt.write_text(json.dumps({"status": "blocked", "blockers": ["face_drift"]}), encoding="utf-8")
            self.assertTrue(acceptance_blockers(item, episode_root=root, youtube_root=YOUTUBE_ROOT))

    def test_local_tournament_is_not_applicable_when_episode_needs_no_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "video-07"
            approval = root / "approval"
            approval.mkdir(parents=True)
            (approval / "local-visual-prompt-plan.json").write_text(
                json.dumps({"status": "pass", "beats": [], "generation_beat_count": 0}),
                encoding="utf-8",
            )
            with patch.object(local_tournament, "output_root", return_value=root):
                payload, _, _ = local_tournament.build_report("07", live=True)
            self.assertEqual(payload["status"], "pass")
            self.assertEqual(payload["applicability"], "not_applicable")
            self.assertEqual(payload["generation_beat_count"], 0)

    def test_ai_route_accepts_only_bounded_disclosed_nonproof_support(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            approval = Path(temp)
            (approval / "local-still-tournament-report.json").write_text(
                json.dumps(
                    {
                        "status": "pass",
                        "blockers": [],
                        "beats": [{"beat_id": "beat-07", "status": "pass", "winner": {"selected_sha256": "abc"}}],
                    }
                ),
                encoding="utf-8",
            )
            ai = {
                "beat_id": "beat-07",
                "asset_id": "video-07-local-ai-beat-07",
                "asset_kind": "graphic",
                "source_class": "ai_reconstruction",
                "role": "labeled_reconstruction",
                "editorial_role": "reconstruction",
                "evidence_fit": "context_only",
                "geographic_scope": "generic",
                "may_imply_named_city": False,
                "ai_disclosure": long_form_qa.DISCLOSURE,
                "duration_seconds": 5.0,
            }
            plan = {"beats": [ai, {"beat_id": "proof", "duration_seconds": 95.0}]}
            policy = {"ai_support": {"maximum_seconds_per_clip": 5.0, "maximum_runtime_share_long_form": 0.08}}
            self.assertEqual(
                long_form_qa.ai_route_blockers(video_id="07", plan=plan, visual_policy=policy, approval=approval),
                [],
            )
            ai["role"] = "source_proof"
            self.assertTrue(
                long_form_qa.ai_route_blockers(video_id="07", plan=plan, visual_policy=policy, approval=approval)
            )

    def test_canonical_profiles_require_local_ai_and_full_package_gates_in_order(self) -> None:
        contract_path = YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json"
        for profile in ("long_form_rebuild", "full_package"):
            contract = load_contract(contract_path, profile)
            ids = [stage.stage_id for stage in contract.stages]
            for required in (
                "visual_prompt_compile",
                "local_generation_routes",
                "context_media_library",
                "local_still_tournament",
                "source_pool_compile",
                "ai_motion_quality",
                "long_form_aggregate_qa",
            ):
                self.assertIn(required, ids)
            self.assertLess(ids.index("visual_prompt_compile"), ids.index("local_still_tournament"))
            self.assertLess(ids.index("local_still_tournament"), ids.index("source_pool_compile"))
        full = load_contract(contract_path, "full_package")
        full_ids = [stage.stage_id for stage in full.stages]
        self.assertLess(full_ids.index("shorts_final_quality"), full_ids.index("thumbnail_factory"))
        self.assertLess(full_ids.index("thumbnail_worldclass"), full_ids.index("owner_review_packet"))

    def test_thumbnail_brief_is_episode_owned_for_another_city(self) -> None:
        concepts = [
            {"headline": "CLEVELAND BURNED"},
            {"headline": "THE RIVER'S SECRET"},
            {"headline": "CLEVELAND'S FIRE MAP"},
            {"headline": "THE RIVER CHANGED"},
            {"headline": "CLEVELAND THEN / NOW"},
        ]
        package = {
            "city": "Cleveland",
            "public_angle": "The source trail behind the river fire that changed environmental law.",
            "hidden_history_question": "Why did Cleveland's river keep catching fire?",
            "proof_object": "a dated Cuyahoga River fire photograph and industrial map",
            "visual_payoff": "the exact fire location and industrial shoreline shown in the opening",
            "city_anchor": "Cleveland and the Cuyahoga River",
            "thumbnail_hero_subject": "a rights-cleared Cuyahoga River fire photograph",
            "thumbnail_source_asset_ids": ["cleveland-fire-photo", "cleveland-industry-map"],
            "upload_metadata": {"thumbnail_topic_concepts": concepts},
        }
        brief = thumbnail_worldclass.default_episode_brief("07", package)
        policy = json.loads((YOUTUBE_ROOT / "resources" / "thumbnail-worldclass-policy.json").read_text())
        self.assertEqual(thumbnail_worldclass.validate_brief(brief, policy), [])
        self.assertEqual(brief["city"], "Cleveland")
        self.assertEqual(brief["headline_options"], [row["headline"] for row in concepts])
        self.assertNotIn("Detroit", json.dumps(brief))


if __name__ == "__main__":
    unittest.main()
