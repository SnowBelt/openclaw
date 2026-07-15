from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
YOUTUBE_ROOT = SCRIPTS.parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import patternlab_ai_motion_quality as ai_motion
import patternlab_historical_parallax as parallax
import patternlab_local_media_runtime as runtime
import patternlab_local_image_to_video_benchmark as image_to_video
import patternlab_local_still_tournament as tournament
import patternlab_local_visual_judge_runner as local_judge
import patternlab_storage_lifecycle as storage
import patternlab_storage_migration as migration
import patternlab_visual_prompt_compiler as compiler
import patternlab_visual_retention_quality as retention


class LocalMediaDurabilityTests(unittest.TestCase):
    def test_visual_dependency_lock_is_a_consistent_subset_of_runtime_lock(self):
        def pinned(path: Path) -> dict[str, str]:
            rows: dict[str, str] = {}
            for raw in path.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                name, version = line.split("==", 1)
                rows[name.casefold()] = version
            return rows

        runtime_lock = pinned(YOUTUBE_ROOT / "requirements-python312.lock")
        visual_lock = pinned(YOUTUBE_ROOT / "requirements-visual.lock")
        self.assertEqual(
            {name: runtime_lock.get(name) for name in visual_lock},
            visual_lock,
        )
        self.assertEqual(runtime_lock["numpy"], "2.4.6")
        # PySceneDetect declares opencv-python while rembg declares the
        # headless distribution. Keep both at the same build and probe media
        # modules in isolated child processes (the environment-health rule)
        # so their shared cv2 files cannot drift independently.
        self.assertEqual(
            runtime_lock["opencv-python"],
            runtime_lock["opencv-python-headless"],
        )
        self.assertIn("opencv-python-headless", runtime_lock)
        self.assertIn("opencv-python", runtime_lock)

    def test_codex_seatbelt_is_not_trusted_for_metal_generation(self):
        with patch.dict(os.environ, {"CODEX_SANDBOX": "seatbelt"}, clear=False):
            context = runtime.execution_context()
        self.assertEqual(context["name"], "codex_seatbelt")
        self.assertFalse(context["metal_generation_trusted"])

    def test_native_user_runtime_is_trusted_but_root_is_recorded(self):
        environment = dict(os.environ)
        environment.pop("CODEX_SANDBOX", None)
        with patch.dict(os.environ, environment, clear=True):
            context = runtime.execution_context()
        self.assertEqual(context["name"], "native_user_runtime")
        self.assertTrue(context["metal_generation_trusted"])

    def test_candidate_generation_signature_changes_with_prompt_or_binary(self):
        base = dict(
            prompt="one",
            negative_prompt="none",
            seed=1,
            width=768,
            height=512,
            model_sha256="a" * 64,
            cli_sha256="b" * 64,
        )
        first = tournament.generation_signature(**base)
        second = tournament.generation_signature(**{**base, "prompt": "two"})
        third = tournament.generation_signature(**{**base, "cli_sha256": "c" * 64})
        self.assertNotEqual(first, second)
        self.assertNotEqual(first, third)

    def test_local_still_total_score_cannot_hide_failed_dimensions(self):
        policy = {
            "minimum_local_visual_judge_score": 93,
            "minimum_local_visual_judge_dimension_score": 93,
        }
        self.assertFalse(
            tournament.judgment_passes(
                {
                    "score": 93,
                    "narration_match": 1,
                    "visual_quality": 1,
                    "historical_integrity": 1,
                    "hard_failures": [],
                },
                policy,
            )
        )
        self.assertTrue(
            tournament.judgment_passes(
                {
                    "score": 95,
                    "narration_match": 94,
                    "visual_quality": 96,
                    "historical_integrity": 93,
                    "hard_failures": [],
                },
                policy,
            )
        )

    def test_local_judge_normalizes_only_explicit_no_failure_sentinels(self):
        self.assertEqual(local_judge.normalize_hard_failures(["none", "No hard failures.", "N/A"]), [])
        self.assertEqual(
            local_judge.normalize_hard_failures(["none", "warped architecture"]),
            ["warped architecture"],
        )

    def test_hash_bound_candidate_can_resume_and_tampering_invalidates_it(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "candidate.png"
            receipt = root / "candidate.json"
            Image.new("RGB", (64, 64), "red").save(image)
            signature = "s" * 64
            runtime.atomic_write_json(
                receipt,
                {
                    "status": "generated",
                    "generation_signature": signature,
                    "output_sha256": runtime.sha256_file(image),
                },
            )
            self.assertIsNotNone(tournament.reusable_candidate(image, receipt, signature))
            Image.new("RGB", (64, 64), "blue").save(image)
            self.assertIsNone(tournament.reusable_candidate(image, receipt, signature))

    def test_prompt_compiler_keeps_narration_in_receipt_not_generator_payload(self):
        policy = {
            "generation_roles": ["reconstruction"],
            "blocked_generation_roles": ["proof", "system"],
            "default_negative_prompt": "text",
            "candidate_tournament": {"draft_candidate_count": 2, "seed_base": 100},
        }
        beat = {
            "beat_id": "beat-01",
            "visual_mode": "reconstruction",
            "ai_support_allowed": True,
            "claim_scope": "generic",
            "narration_excerpt": "A family had to leave the block.",
            "visible_action": "one adult packing one box",
            "historical_constraints": "1950 clothing and vehicle only",
        }
        compiled = compiler.compile_beat(beat, policy, 1, city="Cleveland")
        self.assertTrue(compiled["generation_allowed"])
        self.assertNotIn("NARRATION:", compiled["prompt"])
        self.assertIn("HISTORICAL CONSTRAINTS", compiled["prompt"])
        self.assertEqual(compiled["prompt_fields"]["narration"], beat["narration_excerpt"])

    def test_proof_role_cannot_enable_ai_generation(self):
        policy = {
            "generation_roles": ["context", "reconstruction"],
            "blocked_generation_roles": ["proof", "system"],
            "default_negative_prompt": "text",
            "candidate_tournament": {},
        }
        compiled = compiler.compile_beat(
            {"beat_id": "beat-01", "visual_mode": "proof", "ai_support_allowed": True, "claim_scope": "city_specific"},
            policy,
            1,
            city="Detroit",
        )
        self.assertFalse(compiled["generation_allowed"])
        self.assertIn("ai_generation_for_proof_or_system_role_forbidden", compiled["blockers"])

    def test_storage_classifies_only_explicit_transients_as_disposable(self):
        policy = {
            "protected_path_tokens": ["/source-packet/", "/approval/"],
            "disposable_path_tokens": ["/intermediates/", "/source-packet/local-ai-candidates/"],
        }
        self.assertEqual(storage.classify(Path("source-packet/evidence/photo.jpg"), policy), "protected")
        self.assertEqual(storage.classify(Path("source-packet/local-ai-candidates/seed.png"), policy), "disposable")
        self.assertEqual(storage.classify(Path("intermediates/frames/1.png"), policy), "disposable")
        self.assertEqual(storage.classify(Path("approval/rights.json"), policy), "protected")

    def test_storage_operation_budget_fails_closed(self):
        policy = {"disk_reserves": {"local_image_to_video": {"minimum_free_gib": 250, "minimum_free_fraction": 0.15}}}
        result = storage.operation_budget(policy, "local_image_to_video", {"free_gib": 100, "free_fraction": 0.05})
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(len(result["blockers"]), 2)

    def test_storage_requested_operation_is_not_blocked_by_larger_runtime_reserve(self):
        payload = {
            "status": "blocked",
            "operation_budgets": {
                "routine_still_generation": {"status": "pass"},
                "long_form_render": {"status": "blocked"},
            },
        }
        self.assertEqual(storage.requested_status(payload, "routine_still_generation"), "pass")
        self.assertEqual(storage.requested_status(payload, "long_form_render"), "blocked")
        self.assertEqual(storage.requested_status(payload, None), "blocked")

    def test_external_migration_rejects_unmounted_or_internal_destination(self):
        safe, blockers, _ = migration.destination_is_safe(Path("/tmp/PatternLabMedia"))
        self.assertFalse(safe)
        self.assertIn("destination_must_be_a_mounted_external_volume", blockers)

    def test_parallax_layer_metrics_catch_fragmented_masks(self):
        image = np.full((180, 320, 3), 128, dtype=np.uint8)
        mask = np.zeros((180, 320), dtype=np.uint8)
        for x in range(20, 300, 30):
            cv2.circle(mask, (x, 90), 7, 255, -1)
        _background, _foreground, _alpha, metrics = parallax.prepare_layers(
            image,
            mask,
            parallax.PRESETS["safe_subject_push"],
        )
        self.assertGreater(metrics["foreground_component_count"], 5)
        self.assertLess(metrics["largest_foreground_component_ratio"], 0.35)

    def test_ai_motion_metrics_detect_temporal_jump(self):
        frames = [np.full((90, 160, 3), value, dtype=np.uint8) for value in range(11)]
        frames.append(np.full((90, 160, 3), 255, dtype=np.uint8))
        metrics = ai_motion.deterministic_metrics(frames)
        self.assertGreater(metrics["maximum_frame_difference"], metrics["median_frame_difference"])

    def test_image_to_video_companions_are_independent_hash_locked_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            model = root / "model.ckpt"
            companion = root / "vae.ckpt"
            model.write_bytes(b"model")
            companion.write_bytes(b"vae")
            rows, verified = image_to_video.companion_receipts(
                model,
                [{"id": companion.name, "sha256": runtime.sha256_file(companion)}],
            )
        self.assertTrue(verified)
        self.assertEqual(rows[0]["id"], "vae.ckpt")
        self.assertTrue(rows[0]["sha256_verified"])

    def test_retention_longest_run(self):
        self.assertEqual(retention.longest_run(["proof", "system", "system", "system", "proof"]), 3)


if __name__ == "__main__":
    unittest.main()
