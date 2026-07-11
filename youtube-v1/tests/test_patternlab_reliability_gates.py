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
import patternlab_claim_visual_fidelity as claim_visual_fidelity
import patternlab_topic_qualification_queue as topic_queue
import patternlab_runtime_watchdog as runtime_watchdog
import patternlab_topic_research_worker as topic_research
import patternlab_environment_health as environment_health
import patternlab_monetization_tracker as monetization_tracker
import patternlab_local_model_health as model_health
import patternlab_word_alignment as word_alignment
import patternlab_canonical_renderer as canonical_renderer
import patternlab_visual_judge as visual_judge
import patternlab_visual_release_quality as visual_release_quality


class PatternLabReliabilityGateTests(unittest.TestCase):
    def test_canonical_renderer_escapes_source_labels_for_ffmpeg_drawtext(self):
        escaped = canonical_renderer.escape_drawtext("Source: Black Bottom 50%")
        self.assertIn(r"\:", escaped)
        self.assertIn(r"\%", escaped)

    def test_visual_judge_blocks_missing_local_hash_bound_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-04"
            with patch.object(visual_judge, "output_root", lambda _: root), patch.object(visual_judge, "BASE", Path(temp)):
                payload, _, _ = visual_judge.build_report("04")
            self.assertEqual(payload["status"], "blocked")
            self.assertIn("local_visual_judge_receipt_missing", payload["blockers"])

    def test_visual_release_quality_requires_all_hash_bound_visual_reports(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-04"
            approval = root / "approval"
            approval.mkdir(parents=True)
            for filename in visual_release_quality.REQUIRED.values():
                (approval / filename).write_text(json.dumps({"status": "pass"}), encoding="utf-8")
            with patch.object(visual_release_quality, "output_root", lambda _: root):
                payload, _, _ = visual_release_quality.build_report("04")
            self.assertEqual(payload["status"], "pass")

    def test_word_alignment_caption_cards_are_short_and_timestamped(self):
        words = [
            {"word": "Black", "start": 0.0, "end": 0.3},
            {"word": "Bottom", "start": 0.3, "end": 0.7},
            {"word": "was", "start": 0.7, "end": 0.9},
            {"word": "not", "start": 0.9, "end": 1.1},
            {"word": "empty.", "start": 1.1, "end": 1.5},
        ]
        captions = word_alignment.captions_from_words(words)
        self.assertEqual(captions[0]["text"], "Black Bottom was not empty.")
        self.assertIn("00:00:00,000", word_alignment.srt_text(captions))

    def test_local_model_health_blocks_when_required_quality_model_is_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-04"
            manifest_path = Path(temp) / "model-manifest.json"
            manifest_path.write_text(json.dumps({
                "model_root_environment": "PATTERNLAB_TEST_MODEL_ROOT",
                "default_model_root": str(Path(temp) / "models"),
                "models": {
                    "siglip2_frame_match": {
                        "repository": "google/siglip2-base-patch16-224",
                        "revision": "main",
                        "local_directory": "siglip2",
                        "required_files": ["config.json"],
                        "purpose": "test",
                    }
                },
            }), encoding="utf-8")
            with patch.object(model_health, "output_root", lambda _: root):
                payload, _, _ = model_health.build_report("04", manifest_path=manifest_path)
            self.assertEqual(payload["status"], "blocked")
            self.assertIn("local_model_missing:siglip2_frame_match", payload["blockers"])

    def test_monetization_tracker_treats_prelaunch_metrics_as_nonblocking(self):
        with patch.object(monetization_tracker, "build_profit_analytics", side_effect=SystemExit("metrics absent")):
            payload, _ = monetization_tracker.build_tracker_report(write=False)
        self.assertEqual(payload["profit_analytics"]["status"], "missing")

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

    def test_claim_visual_fidelity_rejects_generic_unlinked_visuals(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-01"
            approval = root / "approval"
            rebuild = root / "source-packet" / "rebuild-v2"
            approval.mkdir(parents=True)
            rebuild.mkdir(parents=True)
            (approval / "claim-ledger.json").write_text(json.dumps([{
                "claim_id": "v01-001",
                "fact_checker_status": "verified",
            }]), encoding="utf-8")
            (rebuild / "claim-visual-links.json").write_text(json.dumps({"links": [{
                "claim_id": "v01-001",
                "asset_id": "generic-detroit-skyline",
                "evidence_basis": "modern_then_now_context",
                "relevance_note": "Generic skyline only.",
            }]}), encoding="utf-8")
            (root / "rights-ledger.csv").write_text(
                "asset_id,source_class\n"
                "generic-detroit-skyline,modern_context\n",
                encoding="utf-8",
            )
            with patch.object(claim_visual_fidelity, "output_root", lambda _: root):
                payload, _, _ = claim_visual_fidelity.build_claim_visual_fidelity_report("01")
            self.assertEqual(payload["status"], "blocked")
            self.assertTrue(any("requires_direct_historical" in item for item in payload["blockers"]))

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

    def test_full_auto_recognizes_hash_bound_paid_voice_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            script = base / "launch" / "video-04" / "final-script.md"
            script.parent.mkdir(parents=True)
            script.write_text("A source-backed Detroit script.", encoding="utf-8")
            root = base / "output" / "video-04"
            (root / "approval").mkdir(parents=True)
            expected_sha = __import__("hashlib").sha256(script.read_bytes()).hexdigest()
            (root / "approval" / "paid-service-approval.json").write_text(json.dumps({
                "provider": "elevenlabs",
                "video_id": "04",
                "script_sha256": expected_sha,
                "operation": "video_04_upload_ready_narration",
            }), encoding="utf-8")
            with patch.object(full_auto, "BASE", base), patch.object(full_auto, "output_root", lambda _: root):
                self.assertEqual(full_auto.paid_voice_approval("04"), (True, "approved"))

    def test_full_auto_adds_credit_preflight_before_live_voice_generation(self):
        with patch.object(full_auto, "paid_voice_approval", return_value=(True, "approved")), patch.object(full_auto, "run_steps_fail_fast", return_value=[]), patch.object(full_auto, "build_full_auto_report", return_value=({"status": "pass"}, Path("x"), Path("x"))), patch.object(full_auto, "load_dotenv"):
            with patch.object(sys, "argv", ["program", "--video-id", "04", "--live-voice", "when-approved"]):
                with patch.object(full_auto, "run_step"):
                    # Main delegates definitions to run_steps_fail_fast; capture the command list.
                    captured = {}
                    def capture(definitions, **kwargs):
                        captured["definitions"] = definitions
                        return []
                    with patch.object(full_auto, "run_steps_fail_fast", side_effect=capture):
                        full_auto.main()
                    self.assertIn("elevenlabs_credit_preflight", [item[0] for item in captured["definitions"]])

    def test_full_auto_requires_canonical_evidence_and_release_before_owner_packet(self):
        with patch.object(full_auto, "paid_voice_approval", return_value=(False, "missing")), patch.object(full_auto, "build_full_auto_report", return_value=({"status": "pass"}, Path("x"), Path("x"))), patch.object(full_auto, "load_dotenv"):
            with patch.object(sys, "argv", ["program", "--video-id", "04"]):
                captured = {}

                def capture(definitions, **kwargs):
                    captured["definitions"] = definitions
                    return []

                with patch.object(full_auto, "run_steps_fail_fast", side_effect=capture):
                    full_auto.main()
        names = [item[0] for item in captured["definitions"]]
        self.assertLess(names.index("canonical_evidence_preflight"), names.index("owner_packet"))
        self.assertLess(names.index("canonical_release_registration"), names.index("owner_packet"))

    def test_full_auto_accepts_generic_hash_bound_paid_voice_approval_for_future_video(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            script = base / "launch" / "video-05" / "final-script.md"
            script.parent.mkdir(parents=True)
            script.write_text("A source-backed future city script.", encoding="utf-8")
            root = base / "output" / "video-05"
            (root / "approval").mkdir(parents=True)
            expected_sha = __import__("hashlib").sha256(script.read_bytes()).hexdigest()
            (root / "approval" / "paid-service-approval.json").write_text(json.dumps({
                "provider": "elevenlabs",
                "video_id": "05",
                "script_sha256": expected_sha,
                "operation": "upload_ready_narration",
            }), encoding="utf-8")
            with patch.object(full_auto, "BASE", base), patch.object(full_auto, "output_root", lambda _: root):
                self.assertEqual(full_auto.paid_voice_approval("05"), (True, "approved"))

    def test_full_auto_next_scheduled_uses_only_qualified_queue_candidate(self):
        with patch.object(full_auto, "build_topic_qualification_queue", return_value=({
            "next_candidate": {"video_id": "04", "topic_status": "active_rebuild"}
        }, Path("queue.json"), Path("queue.md"))):
            self.assertEqual(full_auto.next_incomplete_video(), "04")
        with patch.object(full_auto, "build_topic_qualification_queue", return_value=({
            "next_candidate": {"video_id": "05", "topic_status": "research_queue"}
        }, Path("queue.json"), Path("queue.md"))):
            with self.assertRaises(SystemExit):
                full_auto.next_incomplete_video()

    def test_topic_queue_sends_generic_survey_to_research_not_production(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            slate = base / "content-slate.json"
            strategy = base / "strategy.json"
            slate.write_text(json.dumps({"topics": [{
                "video_id": "05",
                "working_title": "How Detroit Became the Motor City",
                "public_angle": "A timeline showing geography, factories, labor, roads, and entrepreneurs.",
                "artifact_type": "Motor City timeline map",
                "scores": {"search_trend_demand": 10},
            }]}), encoding="utf-8")
            strategy.write_text(json.dumps({
                "topic_score_threshold": 80,
                "topic_scoring_weights": {"search_trend_demand": 100},
            }), encoding="utf-8")
            operations = base / "operations"
            with (
                patch.object(topic_queue, "SLATE_PATH", slate),
                patch.object(topic_queue, "STRATEGY_PATH", strategy),
                patch.object(topic_queue, "OPERATIONS_ROOT", operations),
                patch.object(topic_queue, "output_root", lambda _: base / "output" / "video-05"),
            ):
                payload, _, _ = topic_queue.build_topic_qualification_queue()
            self.assertEqual(payload["selection_mode"], "research_only_no_production_eligible")
            self.assertIn("generic_survey_title", payload["rows"][0]["topic_blockers"])

    def test_topic_queue_never_reselects_prior_upload(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            slate = base / "content-slate.json"
            strategy = base / "strategy.json"
            slate.write_text(json.dumps({"topics": [{
                "video_id": "03",
                "working_title": "Detroit Didn't Just Decline. It Was Rewired.",
                "public_angle": "A source-backed map explains a single city system.",
                "artifact_type": "Detroit rewiring evidence map",
                "scores": {"search_trend_demand": 10},
            }]}), encoding="utf-8")
            strategy.write_text(json.dumps({"topic_score_threshold": 80, "topic_scoring_weights": {"search_trend_demand": 100}}), encoding="utf-8")
            root = base / "output" / "video-03"
            (root / "approval").mkdir(parents=True)
            (root / "approval" / "youtube-upload-report.json").write_text("{}", encoding="utf-8")
            (root / "source-packet" / "visual-rebuild").mkdir(parents=True)
            (root / "source-packet" / "visual-rebuild" / "visual-rebuild-manifest.json").write_text(json.dumps({
                "status": "ready",
                "historical_assets": [{"archive_or_platform": "Library of Congress"}] * 4,
                "modern_context_assets": [{"archive_or_platform": "Wikimedia Commons"}] * 4,
            }), encoding="utf-8")
            with (
                patch.object(topic_queue, "SLATE_PATH", slate),
                patch.object(topic_queue, "STRATEGY_PATH", strategy),
                patch.object(topic_queue, "OPERATIONS_ROOT", base / "operations"),
                patch.object(topic_queue, "output_root", lambda _: root),
            ):
                payload, _, _ = topic_queue.build_topic_qualification_queue()
            self.assertEqual(payload["rows"][0]["topic_status"], "archived_existing_package")
            self.assertIsNone(payload["next_candidate"])

    def test_factory_rejects_generic_topic_from_production_script_lane(self):
        self.assertFalse(daily_factory.production_script_available({"working_title": "How Detroit Became the Motor City"}))
        self.assertTrue(daily_factory.production_script_available({"working_title": "What Detroit Erased: Black Bottom"}))

    def test_factory_preserves_hash_bound_script_when_template_differs(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            launch = base / "launch" / "video-04"
            root = base / "output" / "video-04"
            launch.mkdir(parents=True)
            (root / "approval").mkdir(parents=True)
            approved = "Approved source-backed Detroit script."
            (launch / "final-script.md").write_text(approved, encoding="utf-8")
            approved_hash = daily_factory.sha256_text(approved)
            (root / "approval" / "paid-service-approval.json").write_text(
                json.dumps({"script_sha256": approved_hash, "operation": "upload_ready_narration"}), encoding="utf-8"
            )
            with patch.object(daily_factory, "BASE", base), patch.object(daily_factory, "output_root", lambda _: root):
                result = daily_factory.protect_locked_script(launch, root, "04", "A different generated template.")
            self.assertEqual(result, approved)
            report = json.loads((root / "approval" / "script-immutability-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "protected_reused_approved_script")
            self.assertTrue(report["candidate_write_blocked"])

    def test_factory_preserves_tracked_launch_script_lock_when_output_state_is_absent(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            launch = base / "launch" / "video-04"
            root = base / "output" / "video-04"
            launch.mkdir(parents=True)
            approved = "Approved source-backed Detroit script."
            (launch / "final-script.md").write_text(approved, encoding="utf-8")
            (launch / "script-lock.json").write_text(
                json.dumps({"script_sha256": daily_factory.sha256_text(approved), "operation": "owner_approved_script_lock"}),
                encoding="utf-8",
            )
            result = daily_factory.protect_locked_script(launch, root, "04", "A different generated template.")
            self.assertEqual(result, approved)
            report = json.loads((root / "approval" / "script-immutability-report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["status"], "protected_reused_approved_script")
            self.assertEqual(len(report["lock_files"]), 1)
            self.assertTrue(report["lock_files"][0].endswith("launch/video-04/script-lock.json"))

    def test_factory_blocks_conflicting_script_locks(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            launch = base / "launch" / "video-04"
            root = base / "output" / "video-04"
            launch.mkdir(parents=True)
            (root / "approval").mkdir(parents=True)
            (launch / "final-script.md").write_text("Approved script.", encoding="utf-8")
            (launch / "script-lock.json").write_text(
                json.dumps({"script_sha256": daily_factory.sha256_text("Approved script.")}), encoding="utf-8"
            )
            (root / "approval" / "paid-service-approval.json").write_text(
                json.dumps({"script_sha256": daily_factory.sha256_text("Different approved script.")}), encoding="utf-8"
            )
            with self.assertRaises(SystemExit):
                daily_factory.protect_locked_script(launch, root, "04", "A generated script.")

    def test_factory_blocks_when_current_script_differs_from_hash_bound_approval(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            launch = base / "launch" / "video-04"
            root = base / "output" / "video-04"
            launch.mkdir(parents=True)
            (root / "approval").mkdir(parents=True)
            (launch / "final-script.md").write_text("Unapproved script.", encoding="utf-8")
            (root / "approval" / "paid-service-approval.json").write_text(
                json.dumps({"script_sha256": daily_factory.sha256_text("Approved script."), "operation": "upload_ready_narration"}), encoding="utf-8"
            )
            with patch.object(daily_factory, "BASE", base), patch.object(daily_factory, "output_root", lambda _: root):
                with self.assertRaises(SystemExit):
                    daily_factory.protect_locked_script(launch, root, "04", "A generated script.")

    def test_environment_health_blocks_missing_production_capability(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "output" / "video-04"
            modules = {name: {"available": True} for name in environment_health.PYTHON_MODULES}
            modules["whisperx"] = {"available": False, "reason": "missing"}
            binaries = {name: {"available": True, "path": f"/{name}"} for name in environment_health.BINARY_NAMES}
            with patch.object(environment_health, "output_root", lambda _: root), patch.object(environment_health, "module_status", return_value=modules), patch.object(environment_health, "binary_status", return_value=binaries), patch.object(environment_health, "node_status", return_value={"available": True}), patch.object(environment_health, "read_manifest", return_value={"model_root_environment": "PATTERNLAB_MODEL_ROOT", "default_model_root": str(root / "models"), "models": {}}), patch.object(environment_health, "model_root", return_value=root / "models"), patch.object(environment_health, "inspect_models", return_value={}):
                payload, _, _ = environment_health.build_report("04")
            self.assertEqual(payload["status"], "blocked")
            self.assertIn("python_module_missing:whisperx", payload["blockers"])

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

    def test_runtime_watchdog_remains_inspection_only(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            policy = base / "policy.json"
            policy.write_text(json.dumps({"watchdog": {"minimum_free_disk_gb": 0}}), encoding="utf-8")
            auth = base / "auth.json"
            auth.write_text(json.dumps({"status": "configured", "token": {"present": True, "has_refresh_token": True, "missing_scopes": []}}), encoding="utf-8")
            queue = base / "queue.json"
            queue.write_text(json.dumps({"status": "pass"}), encoding="utf-8")
            with (
                patch.object(runtime_watchdog, "POLICY_PATH", policy),
                patch.object(runtime_watchdog, "OPERATIONS_ROOT", base / "operations"),
                patch.object(runtime_watchdog, "BASE", base),
            ):
                # The auth and queue report locations derive from BASE.
                (base / "local-output/video-04/approval").mkdir(parents=True)
                (base / "local-output/video-04/approval/youtube-auth-health-report.json").write_text(auth.read_text(), encoding="utf-8")
                (base / "operations").mkdir(parents=True)
                (base / "operations/topic-qualification-queue.json").write_text(queue.read_text(), encoding="utf-8")
                payload, _, _ = runtime_watchdog.build_report(runner=lambda *args, **kwargs: type("R", (), {"returncode": 0, "stdout": "{}", "stderr": ""})())
            self.assertEqual(payload["status"], "pass")
            self.assertFalse(payload["recovery"]["performed"])
            self.assertEqual(payload["youtube_mutation"], "not_performed")

    def test_topic_research_brief_has_no_production_side_effect(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            row = {"video_id": "05", "working_title": "How Detroit Became the Motor City", "topic_score": 90, "topic_blockers": ["generic_survey_title"], "source_pack_blockers": ["source_pack_not_built"]}
            with patch.object(topic_research, "OUTPUT_ROOT", root):
                json_path, _ = topic_research.write_brief(row)
            payload = json.loads(json_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "research_required")
            self.assertIn("YouTube mutation", payload["not_performed"])


if __name__ == "__main__":
    unittest.main()
