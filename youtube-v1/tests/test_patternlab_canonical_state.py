import tempfile
import unittest
from pathlib import Path
import sys
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from patternlab.models import Approval, ApprovalScope, Artifact, EpisodeState
from patternlab.release import create_release_candidate
from patternlab.state import PatternLabState, StateError, utc_now

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import source_visual_rebuild_assets as source_rebuild


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

    def test_source_rebuild_requires_explicit_claim_queries(self):
        root = Path(self.temp.name) / "video-04"
        with self.assertRaises(SystemExit):
            source_rebuild.load_evidence_queries(root, "04")

    def test_source_rebuild_query_contract_rejects_empty_entities(self):
        root = Path(self.temp.name) / "video-04"
        path = root / "source-packet" / "rebuild-v2" / "evidence-queries.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps({"historical_queries": ["Black Bottom Detroit"]}), encoding="utf-8")
        with self.assertRaises(SystemExit):
            source_rebuild.load_evidence_queries(root, "04")

    def test_source_rebuild_entity_match_rejects_generic_city_image(self):
        self.assertFalse(source_rebuild.entity_relevant("Detroit skyline downtown", ["black bottom", "hastings street"]))
        self.assertTrue(source_rebuild.entity_relevant("Hastings Street in Black Bottom", ["black bottom", "hastings street"]))
