import tempfile
import unittest
from pathlib import Path
import sys
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from patternlab.models import Approval, ApprovalScope, Artifact, EpisodeState
from patternlab.approvals import approval_binding, record_approval, resolve_artifact
from patternlab.release import create_release_candidate
from patternlab.review import owner_review_gate_statuses, owner_review_status
from patternlab.state import PatternLabState, StateError, utc_now
from patternlab.schemas import EpisodeManifest
from patternlab.timeline import timeline_from_manifest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import source_visual_rebuild_assets as source_rebuild
import patternlab_elevenlabs_credit_health as credit_health
import patternlab_canonical_preflight as canonical_preflight
import patternlab_evidence_manifest_builder as evidence_builder
from patternlab_discord_feedback import callback_value, parse_callback


class CanonicalStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = PatternLabState(Path(self.temp.name) / "patternlab.sqlite3")
        self.store.migrate()
        self.store.ensure_episode("04")

    def tearDown(self):
        self.temp.cleanup()

    def candidate(self, artifact_hash="a" * 64):
        return create_release_candidate("04", [Artifact("script", "script", "launch/video-04/final-script.md", artifact_hash)])

    def test_illegal_transition_fails_closed(self):
        with self.assertRaises(StateError):
            self.store.transition("04", EpisodeState.PUBLISHED)

    def test_replacement_release_supersedes_prior_approval(self):
        first = self.candidate()
        self.store.register_release(first)
        self.store.add_approval(Approval("one", "04", first.release_candidate_id, "script", "a" * 64, ApprovalScope.ASSET, "approve", utc_now(), "test"))
        self.store.register_release(self.candidate("b" * 64))
        self.assertEqual(self.store.active_approvals("04", ApprovalScope.ASSET), [])

    def test_approval_rejects_wrong_artifact_hash(self):
        candidate = self.candidate()
        self.store.register_release(candidate)
        with self.assertRaises(StateError):
            self.store.add_approval(Approval("one", "04", candidate.release_candidate_id, "script", "b" * 64, ApprovalScope.ASSET, "approve", utc_now(), "test"))

    def test_superseded_release_cannot_receive_approval(self):
        first = self.candidate()
        self.store.register_release(first)
        self.store.register_release(self.candidate("b" * 64))
        with self.assertRaises(StateError):
            self.store.add_approval(Approval("one", "04", first.release_candidate_id, "script", "a" * 64, ApprovalScope.ASSET, "approve", utc_now(), "test"))

    def test_bound_approval_records_current_release_and_artifact_hash(self):
        candidate = self.candidate()
        self.store.register_release(candidate)
        receipt = record_approval(
            self.store,
            episode_id="04",
            scope=ApprovalScope.ASSET,
            action="approve",
            source="discord",
            artifact_id="script",
        )
        self.assertEqual(receipt["release_candidate_id"], candidate.release_candidate_id)
        self.assertEqual(receipt["artifact_sha256"], "a" * 64)

    def test_bound_approval_rejects_asset_absent_from_current_release(self):
        self.store.register_release(self.candidate())
        with self.assertRaises(StateError):
            record_approval(
                self.store,
                episode_id="04",
                scope=ApprovalScope.ASSET,
                action="approve",
                source="discord",
                artifact_id="not-present",
            )

    def test_bound_approval_preview_does_not_write_state(self):
        candidate = self.candidate()
        self.store.register_release(candidate)
        receipt = approval_binding(self.store, episode_id="04", artifact_id="script")
        self.assertEqual(receipt["artifact_sha256"], "a" * 64)
        self.assertEqual(self.store.active_approvals("04", ApprovalScope.ASSET), [])

    def test_bound_approval_can_resolve_human_asset_id_by_immutable_filename(self):
        candidate = create_release_candidate(
            "04",
            [Artifact("package-shorts-short-01", "package_asset", "youtube-v1/local-output/video-04/shorts/pattern-lab-video-04-short-01.mp4", "a" * 64)],
        )
        self.store.register_release(candidate)
        release = self.store.snapshot("04")["release"]
        artifact = resolve_artifact(
            release,
            artifact_id="video-04-short-01",
            filename="shorts/pattern-lab-video-04-short-01.mp4",
        )
        self.assertEqual(artifact["artifact_id"], "package-shorts-short-01")

    def test_owner_review_requires_canonical_package_and_render_quality(self):
        gates = owner_review_gate_statuses(
            package_hash="blocked",
            canonical_preflight="pass",
            canonical_release="pass",
            long_form_quality="pass",
            shorts_quality="pass",
            thumbnail_quality="pass",
            episode_standard="pass",
            voice_visual_match="pass",
            finished_watchdown="pass",
        )
        self.assertEqual(owner_review_status(gates), "blocked-before-owner-review")
        self.assertEqual(gates["visual_release_quality"], "missing")

    def test_discord_callback_rejects_missing_hash_binding(self):
        with self.assertRaises(ValueError):
            parse_callback('patternlab:{"action":"approve","videoId":"04","assetType":"short","assetId":"video-04-short-01","reason":"strong_short_loop"}')

    def test_discord_callback_preserves_hash_binding(self):
        raw = callback_value(
            "approve",
            "short",
            "04",
            asset_id="video-04-short-01",
            filename="shorts/pattern-lab-video-04-short-01.mp4",
            reason="strong_short_loop",
            release_candidate_id="rc-04-test",
            release_candidate_sha256="a" * 64,
            artifact_sha256="b" * 64,
        )
        parsed = parse_callback(raw)
        self.assertEqual(parsed["release_candidate_id"], "rc-04-test")
        self.assertEqual(parsed["artifact_sha256"], "b" * 64)

    def test_manifest_rejects_reused_visual_without_new_evidence_reason(self):
        payload = {
            "episode_id": "04",
            "title": "Black Bottom source proof",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "source.jpg", "sha256": "a" * 64}],
            "visual_beats": [
                {"beat_id": "proof-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3},
                {"beat_id": "proof-2", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "archive_evidence", "start_seconds": 3, "end_seconds": 6},
            ],
        }
        with self.assertRaises(ValueError):
            EpisodeManifest.model_validate(payload)

    def test_source_rebuild_requires_explicit_claim_queries(self):
        root = Path(self.temp.name) / "video-04"
        with patch.object(source_rebuild, "launch_root", lambda _: Path(self.temp.name) / "missing-launch"):
            with self.assertRaises(SystemExit):
                source_rebuild.load_evidence_queries(root, "04")

    def test_source_rebuild_query_contract_rejects_empty_entities(self):
        root = Path(self.temp.name) / "video-04"
        path = root / "source-packet" / "rebuild-v2" / "evidence-queries.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"historical_queries": ["Black Bottom Detroit"]}), encoding="utf-8")
        with patch.object(source_rebuild, "launch_root", lambda _: Path(self.temp.name) / "missing-launch"):
            with self.assertRaises(SystemExit):
                source_rebuild.load_evidence_queries(root, "04")

    def test_source_rebuild_prefers_versioned_launch_query_contract(self):
        root = Path(self.temp.name) / "output" / "video-04"
        launch = Path(self.temp.name) / "launch" / "video-04"
        launch.mkdir(parents=True)
        (launch / "evidence-queries.json").write_text(json.dumps({
            "historical_queries": ["Black Bottom Detroit"],
            "required_entity_terms": ["black bottom"],
            "required_city_terms": ["detroit"],
        }), encoding="utf-8")
        with patch.object(source_rebuild, "launch_root", lambda _: launch):
            loaded = source_rebuild.load_evidence_queries(root, "04")
        self.assertEqual(loaded["path"], launch / "evidence-queries.json")

    def test_source_rebuild_entity_match_rejects_generic_city_image(self):
        self.assertFalse(source_rebuild.entity_relevant("Detroit skyline downtown", ["black bottom", "hastings street"]))
        self.assertTrue(source_rebuild.entity_relevant("Hastings Street in Black Bottom", ["black bottom", "hastings street"]))

    def test_source_rebuild_requires_each_result_to_match_its_own_query_entity(self):
        query_terms = source_rebuild.query_entity_terms("I-375 Detroit construction Black Bottom", ["black bottom", "i-375"])
        self.assertEqual(query_terms, ["black bottom", "i-375"])
        self.assertFalse(source_rebuild.entity_relevant("Detroit skyline near I-375", ["black bottom"]))

    def test_source_rebuild_flattens_list_metadata_from_library_of_congress(self):
        self.assertEqual(
            source_rebuild.flatten_metadata(["Black Bottom", ["Detroit", None], 1940]),
            "Black Bottom Detroit 1940",
        )

    def test_source_rebuild_rejects_modern_caption_as_historical_proof(self):
        self.assertFalse(source_rebuild.historical_date_eligible({"date": "2019"}, 1965))
        self.assertTrue(source_rebuild.historical_date_eligible({"date": ["1940", "1941"]}, 1965))

    def test_source_rebuild_stops_cleanly_when_library_of_congress_rate_limits(self):
        root = Path(self.temp.name) / "video-04"
        queries = {"historical": ["Black Bottom Detroit"], "entities": ["black bottom"], "city_terms": ["detroit"], "historical_max_year": 1965}
        with patch.object(source_rebuild, "loc_search", side_effect=source_rebuild.ProviderRateLimited("provider_rate_limited:library_of_congress")):
            assets = source_rebuild.source_loc_assets(root, "04", root / "source-packet" / "visual-rebuild", queries)
        self.assertEqual(assets, [])

    def test_source_rebuild_falls_back_after_library_of_congress_is_unavailable(self):
        root = Path(self.temp.name) / "video-04"
        queries = {"historical": ["Black Bottom Detroit"], "entities": ["black bottom"], "city_terms": ["detroit"], "historical_max_year": 1965}
        with patch.object(source_rebuild, "loc_search", side_effect=source_rebuild.ProviderUnavailable("provider_unavailable:library_of_congress")):
            assets = source_rebuild.source_loc_assets(root, "04", root / "source-packet" / "visual-rebuild", queries)
        self.assertEqual(assets, [])

    def test_commons_historical_fallback_requires_date_license_and_entity_match(self):
        root = Path(self.temp.name) / "video-04"
        queries = {
            "historical": ["Black Bottom Detroit"],
            "entities": ["black bottom", "hastings street"],
            "city_terms": ["detroit"],
            "historical_max_year": 1965,
        }

        def fake_download(_url, target):
            Path(target).write_bytes(b"historical-proof")

        historical_info = {
            "mime": "image/jpeg",
            "thumburl": "https://upload.wikimedia.org/example.jpg",
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:Black_Bottom.jpg",
            "extmetadata": {
                "LicenseShortName": {"value": "CC BY 4.0"},
                "DateTimeOriginal": {"value": "1941"},
                "ImageDescription": {"value": "Black Bottom Detroit street scene"},
                "Artist": {"value": "Detroit archive"},
            },
        }
        with (
            patch.object(source_rebuild, "commons_search_titles", return_value=["File:Black Bottom Detroit.jpg"]),
            patch.object(source_rebuild, "commons_info", return_value=historical_info),
            patch.object(source_rebuild, "download", side_effect=fake_download),
        ):
            assets = source_rebuild.source_commons_historical_assets(
                root, "04", root / "source-packet" / "visual-rebuild", queries
            )
        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0]["source_class"], "historical_evidence")
        self.assertIn("Black Bottom", assets[0]["source_title"])

    def test_commons_historical_fallback_rejects_black_bottom_dance_without_detroit(self):
        root = Path(self.temp.name) / "video-04"
        queries = {
            "historical": ["Black Bottom Detroit"],
            "entities": ["black bottom"],
            "city_terms": ["detroit"],
            "historical_max_year": 1965,
        }
        historical_info = {
            "mime": "image/jpeg",
            "thumburl": "https://upload.wikimedia.org/example.jpg",
            "extmetadata": {
                "LicenseShortName": {"value": "CC BY 4.0"},
                "DateTimeOriginal": {"value": "1926"},
                "ImageDescription": {"value": "Singer performing the Black Bottom dance in London"},
            },
        }
        with (
            patch.object(source_rebuild, "commons_search_titles", return_value=["File:Black Bottom dance.jpg"]),
            patch.object(source_rebuild, "commons_info", return_value=historical_info),
        ):
            assets = source_rebuild.source_commons_historical_assets(
                root, "04", root / "source-packet" / "visual-rebuild", queries
            )
        self.assertEqual(assets, [])

    def test_source_rebuild_names_rate_limited_provider_from_url(self):
        self.assertEqual(source_rebuild.provider_label("https://www.loc.gov/photos/?q=x"), "library_of_congress")
        self.assertEqual(source_rebuild.provider_label("https://commons.wikimedia.org/w/api.php"), "wikimedia_commons")

    def test_elevenlabs_credit_health_warns_before_two_episodes(self):
        payload = credit_health.evaluate_subscription({"character_count": 18_000, "character_limit": 30_000}, 8_000)
        self.assertEqual(payload["status"], "warn")
        self.assertTrue(payload["warn_under_two_episodes"])
        self.assertFalse(payload["block_under_one_episode_with_margin"])

    def test_elevenlabs_credit_health_blocks_before_one_episode(self):
        payload = credit_health.evaluate_subscription({"character_count": 23_000, "character_limit": 30_000}, 8_000)
        self.assertEqual(payload["status"], "blocked")
        self.assertTrue(payload["block_under_one_episode_with_margin"])

    def test_episode_manifest_requires_direct_visual_proof_for_verified_claim(self):
        payload = {
            "episode_id": "04", "title": "The Neighborhood Detroit Erased",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a living Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "evidence.jpg", "sha256": "a" * 64}],
            "visual_beats": [{"beat_id": "beat-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3}],
        }
        manifest = EpisodeManifest.model_validate(payload)
        timeline = timeline_from_manifest(manifest)
        self.assertEqual(len(timeline.tracks[0]), 1)

    def test_episode_manifest_rejects_context_only_proof_for_verified_claim(self):
        payload = {
            "episode_id": "04", "title": "The Neighborhood Detroit Erased",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a living Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "modern_context", "rights_status": "approved", "evidence_fit": "context_only", "visual_fit": "approved", "relative_path": "skyline.jpg", "sha256": "a" * 64}],
            "visual_beats": [{"beat_id": "beat-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3}],
        }
        with self.assertRaises(ValueError):
            EpisodeManifest.model_validate(payload)

    def test_canonical_preflight_writes_otio_only_for_hash_verified_evidence(self):
        root = Path(self.temp.name) / "local-output" / "video-04"
        evidence = root / "evidence" / "black-bottom-map.jpg"
        evidence.parent.mkdir(parents=True)
        evidence.write_bytes(b"historical-map")
        manifest = {
            "episode_id": "04", "title": "The Neighborhood Detroit Erased",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a living Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "evidence/black-bottom-map.jpg", "sha256": __import__("hashlib").sha256(evidence.read_bytes()).hexdigest()}],
            "visual_beats": [{"beat_id": "beat-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3}],
        }
        manifest_path = root / "approval" / "evidence-manifest.json"
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        binding = {
            "status": "pass", "video_id": "04",
            "manifest_sha256": __import__("hashlib").sha256(manifest_path.read_bytes()).hexdigest(),
            "script_sha256": "approved-script",
        }
        (root / "approval" / "evidence-manifest-binding.json").write_text(json.dumps(binding), encoding="utf-8")
        script = Path(self.temp.name) / "launch" / "video-04" / "final-script.md"
        script.parent.mkdir(parents=True)
        script.write_text("approved script", encoding="utf-8")
        with patch.object(canonical_preflight, "output_root", lambda _: root):
            with patch.object(canonical_preflight, "launch_root", lambda _: script.parent):
                binding["script_sha256"] = __import__("hashlib").sha256(script.read_bytes()).hexdigest()
                (root / "approval" / "evidence-manifest-binding.json").write_text(json.dumps(binding), encoding="utf-8")
                payload, _, _ = canonical_preflight.build_report("04")
        self.assertEqual(payload["status"], "pass", payload["blockers"])
        self.assertTrue((root / "video" / "pattern-lab-video-04.otio").exists())

    def test_canonical_preflight_rejects_hash_mismatch(self):
        root = Path(self.temp.name) / "local-output" / "video-04"
        evidence = root / "evidence" / "black-bottom-map.jpg"
        evidence.parent.mkdir(parents=True)
        evidence.write_bytes(b"historical-map")
        manifest = {
            "episode_id": "04", "title": "The Neighborhood Detroit Erased",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a living Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "evidence/black-bottom-map.jpg", "sha256": "a" * 64}],
            "visual_beats": [{"beat_id": "beat-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3}],
        }
        manifest_path = root / "approval" / "evidence-manifest.json"
        manifest_path.parent.mkdir(parents=True)
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        with patch.object(canonical_preflight, "output_root", lambda _: root):
            payload, _, _ = canonical_preflight.build_report("04")
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["blockers"], ["evidence_asset_hash_mismatch:asset-1"])

    def test_evidence_builder_blocks_missing_human_accepted_direct_asset(self):
        root = Path(self.temp.name) / "output" / "video-04"
        launch = Path(self.temp.name) / "launch" / "video-04"
        launch.mkdir(parents=True)
        (launch / "final-script.md").write_text("approved script", encoding="utf-8")
        intake = root / "source-packet" / "evidence-intake.json"
        intake.parent.mkdir(parents=True)
        intake.write_text(json.dumps({"video_id": "04", "assets": []}), encoding="utf-8")
        with patch.object(evidence_builder, "output_root", lambda _: root), patch.object(evidence_builder, "launch_root", lambda _: launch):
            payload, _, _ = evidence_builder.build_manifest("04")
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("evidence_intake_assets_missing", payload["blockers"])

    def test_evidence_builder_writes_hash_bound_manifest_from_explicit_intake(self):
        root = Path(self.temp.name) / "output" / "video-04"
        launch = Path(self.temp.name) / "launch" / "video-04"
        launch.mkdir(parents=True)
        (launch / "final-script.md").write_text("approved script", encoding="utf-8")
        assets = []
        for claim in evidence_builder.planned_claims("04"):
            asset_id = f"asset-{claim['claim_id']}"
            local = root / "evidence" / f"{asset_id}.jpg"
            local.parent.mkdir(parents=True, exist_ok=True)
            local.write_bytes(asset_id.encode("utf-8"))
            assets.append({
                "asset_id": asset_id, "source_id": f"source-{asset_id}", "relative_path": str(local.relative_to(root)),
                "source_url": "https://example.test/archive", "source_title": " ".join(claim["entities"]),
                "creator": "Detroit archive", "rights_basis": "public domain", "human_accepted": True,
                "commercial_use_ok": True, "modification_ok": True, "source_class": "historical_evidence",
                "evidence_fit": "direct", "entity_terms": claim["entities"], "claim_ids": [claim["claim_id"]],
            })
        intake = root / "source-packet" / "evidence-intake.json"
        intake.parent.mkdir(parents=True)
        intake.write_text(json.dumps({"video_id": "04", "assets": assets}), encoding="utf-8")
        with patch.object(evidence_builder, "output_root", lambda _: root), patch.object(evidence_builder, "launch_root", lambda _: launch):
            payload, _, manifest_path = evidence_builder.build_manifest("04")
        self.assertEqual(payload["status"], "pass", payload["blockers"])
        self.assertTrue(manifest_path.exists())
        self.assertTrue((root / "approval" / "evidence-manifest-binding.json").exists())
