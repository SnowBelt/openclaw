import json
import tempfile
import unittest
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import patternlab_package_hashes as package_hashes
import patternlab_status as status_module
import patternlab_transcript_editorial_quality as transcript_quality
import patternlab_milestone_registry_quality as registry_quality
import patternlab_full_auto_production as full_auto
import patternlab_daily_loop as daily_loop
import patternlab_daily_factory as daily_factory
import patternlab_common as common
import build_video_ffmpeg as video_builder
import patternlab_keychain_secret_provider as keychain_provider
import patternlab_asset_identity as asset_identity
import patternlab_claim_ledger_quality as claim_quality


class PatternLabReliabilityGateTests(unittest.TestCase):
    def test_status_reports_blocked_when_mandatory_report_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            approval = Path(temp) / "approval"
            approval.mkdir()
            blockers = status_module.mandatory_blockers(approval, {})
            self.assertTrue(any(item.startswith("package_hash:missing") for item in blockers))

    def test_status_considers_private_readiness_json(self):
        with tempfile.TemporaryDirectory() as temp:
            approval = Path(temp) / "approval"
            approval.mkdir()
            (approval / "private-upload-readiness.json").write_text(
                json.dumps({"status": "blocked-before-private-upload"}), encoding="utf-8"
            )
            self.assertEqual(status_module.readiness_status(approval, "private_readiness")[0], "blocked-before-private-upload")

    def test_editorial_gate_rejects_production_direction(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            script = base / "launch" / "video-01" / "final-script.md"
            script.parent.mkdir(parents=True)
            script.write_text("The visual payoff should be direct.\n", encoding="utf-8")
            output = base / "output" / "video-01"
            with patch.object(transcript_quality, "BASE", base), patch.object(transcript_quality, "output_root", lambda _: output):
                payload, _, _ = transcript_quality.build_report("01")
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(len(payload["hits"]), 1)

    def test_editorial_gate_accepts_documentary_sentence(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            script = base / "launch" / "video-01" / "final-script.md"
            script.parent.mkdir(parents=True)
            script.write_text("The map shows the blocks that disappeared.\n", encoding="utf-8")
            output = base / "output" / "video-01"
            with patch.object(transcript_quality, "BASE", base), patch.object(transcript_quality, "output_root", lambda _: output):
                payload, _, _ = transcript_quality.build_report("01")
            self.assertEqual(payload["status"], "pass")

    def test_package_paths_use_current_canonical_files(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            (base / "resources").mkdir(parents=True)
            (base / "resources" / "pattern-lab-brand-tokens.json").write_text("{}", encoding="utf-8")
            root = base / "output" / "video-01"
            (root / "source-packet" / "visual-rebuild").mkdir(parents=True)
            (root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json").write_text("{}", encoding="utf-8")
            (base / "launch" / "video-01").mkdir(parents=True)
            (base / "launch" / "video-01" / "final-script.md").write_text("script", encoding="utf-8")
            with patch.object(package_hashes, "BASE", base), patch.object(package_hashes, "output_root", lambda _: root):
                payload, _, _ = package_hashes.build_report("01")
            self.assertNotIn("missing_dependency:brand_kit", payload["blockers"])
            self.assertNotIn("missing_dependency:source_manifest", payload["blockers"])
            self.assertEqual(len(payload["final_package_hash"]), 64)

    def test_registry_quality_blocks_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            registry = base / "production-grade-milestones.md"
            registry.write_text("## Milestone 1 — One\n\n## Milestone 1 — Two\n", encoding="utf-8")
            output = base / "output" / "video-01"
            with patch.object(registry_quality, "BASE", base), patch.object(registry_quality, "output_root", lambda _: output):
                payload, _, _ = registry_quality.build_report("01")
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["duplicate_ids"], ["1"])

    def test_registry_quality_counts_transcript_viral_milestones(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            (base / "production-grade-milestones.md").write_text(
                "## Milestone 1 — One\n\n## Transcript/Viral Milestone 48 — Hook\n",
                encoding="utf-8",
            )
            output = base / "output" / "video-01"
            with patch.object(registry_quality, "BASE", base), patch.object(registry_quality, "output_root", lambda _: output):
                payload, _, _ = registry_quality.build_report("01")
            self.assertEqual(payload["milestone_count"], 2)
            self.assertEqual(payload["transcript_viral_milestone_count"], 1)

    def test_asset_identity_blocks_missing_receipt_media(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-01"
            approval = root / "approval"
            approval.mkdir(parents=True)
            (approval / "youtube-upload-report.json").write_text(json.dumps({
                "youtube_video_id": "abc", "video_file_sha256": "deadbeef", "video_file": "local-output/video-01/video/missing.mp4"
            }), encoding="utf-8")
            with patch.object(asset_identity, "output_root", lambda _: root):
                payload, _, _ = asset_identity.build_report("01")
            self.assertEqual(payload["status"], "blocked")
            self.assertTrue(any("local_file_missing" in item for item in payload["blockers"]))

    def test_verified_claim_requires_known_visual_asset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-01"
            approval = root / "approval"
            approval.mkdir(parents=True)
            claim = {key: "x" for key in claim_quality.REQUIRED}
            claim.update({"confidence": "high", "fact_checker_status": "verified", "visual_asset_ids": []})
            (approval / "claim-ledger.json").write_text(json.dumps([claim]), encoding="utf-8")
            with patch.object(claim_quality, "output_root", lambda _: root):
                payload, _, _ = claim_quality.build_report("01")
            self.assertEqual(payload["status"], "blocked")
            self.assertTrue(any("requires_visual" in item for item in payload["blockers"]))

    def test_full_auto_stops_after_required_failure(self):
        calls = []

        def runner(name, command, *, dry_run, required):
            calls.append(name)
            return {"name": name, "command": " ".join(command), "exit_code": 1 if name == "package" else 0, "ok": name != "package", "status": "blocked" if name == "package" else "pass", "required": required}

        steps = full_auto.run_steps_fail_fast(
            [("package", ["package"], True), ("owner_packet", ["packet"], True)],
            dry_run=False,
            runner=runner,
        )
        self.assertEqual(calls, ["package"])
        self.assertEqual(steps[1]["status"], "skipped")
        self.assertEqual(steps[1]["blocked_by"], "package")

    def test_factory_rejects_generic_topic_from_production_script_lane(self):
        self.assertFalse(daily_factory.production_script_available({"working_title": "How Detroit Became the Motor City"}))
        self.assertTrue(daily_factory.production_script_available({"working_title": "What Detroit Erased: Black Bottom"}))

    def test_dotenv_uses_keychain_fallback_without_overwriting_env(self):
        class Result:
            returncode = 0
            stdout = "keychain-value\n"

        with tempfile.TemporaryDirectory() as temp, patch.dict(common.os.environ, {"OPENAI_API_KEY": "already-set"}, clear=False), patch.object(common.subprocess, "run", return_value=Result()):
            common.load_dotenv(Path(temp) / "missing.env")
            self.assertEqual(common.os.environ["OPENAI_API_KEY"], "already-set")
            self.assertEqual(common.os.environ["ELEVENLABS_API_KEY"], "keychain-value")

    def test_visual_match_requires_specific_proof_entity(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            image = root / "fisher-building-detroit.jpg"
            image.write_bytes(b"image")
            metadata = video_builder.visual_match_metadata(
                root,
                "Black Bottom was cleared for I-375.",
                image,
                "historical_evidence",
                [],
                {},
                False,
                {},
            )
            self.assertFalse(metadata["proof_match_eligible"])
            self.assertEqual(metadata["match_strength"], "weak")

    def test_keychain_provider_exposes_only_allowlisted_ids(self):
        self.assertEqual(keychain_provider.ACCOUNTS["discord/bot-token"], "discord.bot-token")
        self.assertNotIn("youtube/oauth-token", keychain_provider.ACCOUNTS)

    def test_review_delivery_fingerprint_changes_with_media(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            video = root / "video"
            review = root / "review"
            video.mkdir()
            review.mkdir()
            (video / "pattern-lab-video-01-draft.mp4").write_bytes(b"first")
            (review / "owner-review-packet.md").write_text("packet", encoding="utf-8")
            first = daily_loop.review_fingerprint(root, "01")
            (video / "pattern-lab-video-01-draft.mp4").write_bytes(b"second")
            self.assertNotEqual(first, daily_loop.review_fingerprint(root, "01"))


if __name__ == "__main__":
    unittest.main()
