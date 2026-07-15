"""Tests for the explicit source/context/reconstruction visual workflow."""
from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))
if str(YOUTUBE_ROOT) not in sys.path:
    sys.path.insert(0, str(YOUTUBE_ROOT))

import patternlab_context_media_library as context_library
import patternlab_free_stock_acquisition as free_stock
import patternlab_visual_contract as visual_contract
from patternlab.review import owner_review_status
from patternlab.schemas import EvidenceAsset


class VisualContextWorkflowTests(unittest.TestCase):
    def test_generic_context_requests_use_action_taxonomy(self) -> None:
        requests = free_stock.generic_context_requests(
            {"generic_context_needs": [{"action": "foot_traffic", "emotion": "street life"}]}
        )
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]["kind"], "generic_context")
        self.assertEqual(requests[0]["action"], "foot_traffic")
        self.assertIn("walking", requests[0]["query"])

    def test_generic_context_candidate_cannot_imply_named_city(self) -> None:
        fields = free_stock.context_fields({"kind": "generic_context", "action": "foot_traffic", "emotion": "street life"})
        self.assertEqual(fields["editorial_role"], "context_only")
        self.assertEqual(fields["geographic_scope"], "generic")
        self.assertIs(fields["may_imply_named_city"], False)

    def test_visual_contract_accepts_complete_mixed_roles(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root = base / "output" / "video-04"
            launch = base / "launch" / "video-04"
            launch.mkdir(parents=True)
            script = launch / "final-script.md"
            script.write_text("A documented city-specific claim.\n", encoding="utf-8")
            (launch / "package.json").write_text(json.dumps({
                "video_id": "04",
                "city": "Detroit",
                "hidden_history_question": "What did Detroit erase from this neighborhood?",
                "proof_object": "A source-backed neighborhood map",
                "visual_payoff": "The old street grid and replacement footprint shown together",
            }), encoding="utf-8")
            (launch / "evidence-queries.json").write_text(json.dumps({
                "required_city_terms": ["Detroit"],
            }), encoding="utf-8")
            digest = hashlib.sha256(script.read_bytes()).hexdigest()
            path = root / "source-packet" / "visual-contract.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "status": "ready", "script_sha256": digest,
                "visual_event_policy": {"first_30_seconds": "2.5s", "remainder": "5s", "major_change": "15-30s", "movement_rule": "reveal information"},
                "beats": [
                    {"beat_id": "proof", "narration_excerpt": "A named historic claim.", "visual_mode": "proof", "claim_scope": "city_specific", "semantic_actions": ["foot_traffic"], "emotional_function": "proof", "retention_function": "open on proof", "motion_intent": "source_highlight", "visual_change_rule": "reveal information", "candidate_queries": ["a", "b", "c"], "source_role": "historical_evidence", "editorial_role": "proof", "requires_exact_evidence": True, "ai_support_allowed": False, "on_screen_disclosure": ""},
                    {"beat_id": "context", "narration_excerpt": "People walked past stores.", "visual_mode": "context", "claim_scope": "generic", "semantic_actions": ["foot_traffic"], "emotional_function": "street life", "retention_function": "humanize", "motion_intent": "native_video", "visual_change_rule": "reveal information", "candidate_queries": ["a", "b", "c"], "source_role": "modern_context", "editorial_role": "context_only", "may_imply_named_city": False, "requires_exact_evidence": False, "ai_support_allowed": False, "on_screen_disclosure": ""},
                    {
                        "beat_id": "reconstruction",
                        "narration_excerpt": "A family had to relocate.",
                        "visual_mode": "reconstruction",
                        "claim_scope": "generic",
                        "claim_ids": ["relocation-consequence"],
                        "planned_ai_asset_id": "video-04-local-ai-reconstruction",
                        "semantic_actions": ["relocation"],
                        "emotional_function": "human consequence",
                        "retention_function": "emotional payoff",
                        "motion_intent": "reconstruction_motion",
                        "visual_change_rule": "reveal information",
                        "candidate_queries": ["a", "b", "c"],
                        "source_role": "ai_reconstruction",
                        "editorial_role": "reconstruction",
                        "may_imply_named_city": False,
                        "requires_exact_evidence": False,
                        "ai_support_allowed": True,
                        "maximum_seconds": 5,
                        "visible_action": "one adult packing one box",
                        "setting": "generic mid-century American city apartment",
                        "subject": "one family preparing to move",
                        "camera": "documentary medium-wide composition",
                        "composition": "one focal action with clear edges",
                        "light_and_color": "bright natural window light",
                        "historical_constraints": "1950s clothing and household objects",
                        "preserve": "coherent faces, hands, objects, and architecture",
                        "avoid": "text, logos, watermarks, landmarks, and artifacts",
                        "on_screen_disclosure": visual_contract.DISCLOSURE,
                    },
                ],
            }), encoding="utf-8")
            with patch.object(visual_contract, "output_root", lambda _: root), patch.object(visual_contract, "launch_root", lambda _: launch):
                payload, _, _ = visual_contract.validate_contract("04")
            self.assertEqual(payload["status"], "pass")

    def test_visual_contract_rejects_context_that_can_imply_city(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root = base / "output" / "video-04"
            launch = base / "launch" / "video-04"
            launch.mkdir(parents=True)
            script = launch / "final-script.md"
            script.write_text("People walked.\n", encoding="utf-8")
            path = root / "source-packet" / "visual-contract.json"
            path.parent.mkdir(parents=True)
            path.write_text(json.dumps({
                "status": "ready", "script_sha256": hashlib.sha256(script.read_bytes()).hexdigest(),
                "beats": [{"beat_id": "context", "narration_excerpt": "People walked.", "visual_mode": "context", "claim_scope": "generic", "semantic_actions": ["foot_traffic"], "emotional_function": "street life", "candidate_queries": ["a", "b", "c"], "source_role": "modern_context", "editorial_role": "context_only", "may_imply_named_city": True, "requires_exact_evidence": False, "on_screen_disclosure": ""}],
            }), encoding="utf-8")
            with patch.object(visual_contract, "output_root", lambda _: root), patch.object(visual_contract, "launch_root", lambda _: launch):
                payload, _, _ = visual_contract.validate_contract("04")
            self.assertEqual(payload["status"], "blocked")
            self.assertIn("context:context_may_not_imply_named_city", payload["blockers"])

    def test_context_library_indexes_only_generic_context_as_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-04"
            asset = root / "source-packet" / "stock-media" / "candidates" / "walking.mp4"
            asset.parent.mkdir(parents=True)
            asset.write_bytes(b"generic context")
            receipt = {
                "asset_id": "walking", "source_title": "Walking", "source_url": "https://example.test/video/1", "download_url": "https://example.test/download/1", "creator": "Example", "license_or_rights_basis": "Example license", "license_url": "https://example.test/license", "context_action": "foot_traffic", "context_emotion": "street life", "editorial_role": "context_only", "geographic_scope": "generic", "may_imply_named_city": False, "source_role": "modern_context", "commercial_use_ok": True, "modification_ok": True, "local_path": str(asset.relative_to(root)), "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(), "human_review_status": "pending",
            }
            asset.with_suffix(".source.json").write_text(json.dumps(receipt), encoding="utf-8")
            with patch.object(context_library, "output_root", lambda _: root):
                payload, _, _ = context_library.build_report("04")
            self.assertEqual(payload["status"], "pass")
            self.assertEqual(payload["assets"][0]["status"], "candidate_only")

    def test_owner_review_requires_visual_contract_and_context_library(self) -> None:
        gates = {
            "package_hash": "pass", "canonical_preflight": "pass", "canonical_release": "pass",
            "canonical_render": "pass", "render_quality": "pass", "visual_release_quality": "pass",
            "media_qa": "pass", "long_form_quality": "pass", "shorts_quality": "pass",
            "thumbnail_quality": "pass", "episode_standard": "pass", "voice_visual_match": "pass",
            "finished_watchdown": "pass", "visual_contract": "blocked", "context_media_library": "pass",
        }
        self.assertEqual(owner_review_status(gates), "blocked-before-owner-review")

    def test_evidence_schema_rejects_generic_context_that_claims_city(self) -> None:
        with self.assertRaisesRegex(ValueError, "cannot imply a named city"):
            EvidenceAsset(
                asset_id="generic", source_id="stock", source_class="modern_context", rights_status="approved",
                evidence_fit="context_only", visual_fit="approved", relative_path="assets/generic.mp4",
                sha256="a" * 64, asset_kind="modern_video", editorial_role="context_only",
                geographic_scope="generic", may_imply_named_city=True, context_action="foot_traffic",
                context_emotion="street life",
            )

    def test_evidence_schema_requires_explicit_ai_reconstruction_disclosure(self) -> None:
        asset = EvidenceAsset(
            asset_id="reconstruction", source_id="local-ai", source_class="ai_reconstruction", rights_status="approved",
            evidence_fit="supporting", visual_fit="approved", relative_path="assets/reconstruction.png",
            sha256="b" * 64, editorial_role="reconstruction", geographic_scope="generic",
            may_imply_named_city=False, on_screen_disclosure=visual_contract.DISCLOSURE,
        )
        self.assertEqual(asset.on_screen_disclosure, visual_contract.DISCLOSURE)

    def test_source_motion_requires_source_and_recipe_hashes(self) -> None:
        asset = EvidenceAsset(
            asset_id="parallax",
            source_id="archive-photo",
            source_class="historical_evidence",
            rights_status="approved",
            evidence_fit="direct",
            visual_fit="approved",
            relative_path="assets/parallax.mp4",
            sha256="c" * 64,
            asset_kind="source_motion",
            editorial_role="proof",
            geographic_scope="city_specific",
            derivative_source_sha256="d" * 64,
            motion_receipt_sha256="e" * 64,
        )
        self.assertEqual(asset.asset_kind, "source_motion")

    def test_source_motion_without_recipe_hash_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "source and motion-receipt hashes"):
            EvidenceAsset(
                asset_id="parallax",
                source_id="archive-photo",
                source_class="historical_evidence",
                rights_status="approved",
                evidence_fit="direct",
                visual_fit="approved",
                relative_path="assets/parallax.mp4",
                sha256="c" * 64,
                asset_kind="source_motion",
                editorial_role="proof",
                geographic_scope="city_specific",
            )


if __name__ == "__main__":
    unittest.main()
