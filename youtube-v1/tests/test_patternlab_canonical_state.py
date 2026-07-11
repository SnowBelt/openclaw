import tempfile
import unittest
from pathlib import Path
import sys
import json
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from patternlab.models import Approval, ApprovalScope, Artifact, EpisodeState
from patternlab.approvals import approval_binding, record_approval
from patternlab.release import create_release_candidate
from patternlab.state import PatternLabState, StateError, utc_now
from patternlab.schemas import EpisodeManifest
from patternlab.timeline import timeline_from_manifest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import source_visual_rebuild_assets as source_rebuild
import patternlab_elevenlabs_credit_health as credit_health
import patternlab_canonical_preflight as canonical_preflight


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
        queries = {"historical": ["Black Bottom Detroit"], "entities": ["black bottom"], "historical_max_year": 1965}
        with patch.object(source_rebuild, "loc_search", side_effect=source_rebuild.ProviderRateLimited("provider_rate_limited:library_of_congress")):
            assets = source_rebuild.source_loc_assets(root, "04", root / "source-packet" / "visual-rebuild", queries)
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
        with patch.object(canonical_preflight, "output_root", lambda _: root):
            payload, _, _ = canonical_preflight.build_report("04")
        self.assertEqual(payload["status"], "pass")
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
