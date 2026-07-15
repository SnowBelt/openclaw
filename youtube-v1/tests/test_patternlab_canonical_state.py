import tempfile
import unittest
import math
from collections import Counter
from pathlib import Path
import sys
import json
from unittest.mock import patch

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(YOUTUBE_ROOT))

from patternlab.models import Approval, ApprovalScope, Artifact, EpisodeState
from patternlab.approvals import approval_binding, record_approval, resolve_artifact
from patternlab.release import create_release_candidate
from patternlab.review import owner_review_gate_statuses, owner_review_status
from patternlab.state import PatternLabState, StateError, utc_now
from patternlab.schemas import EpisodeManifest
from patternlab.timeline import timeline_from_manifest

sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))
import source_visual_rebuild_assets as source_rebuild
import patternlab_elevenlabs_credit_health as credit_health
import patternlab_canonical_preflight as canonical_preflight
import patternlab_evidence_manifest_builder as evidence_builder
import patternlab_video04_long_form_source_pool as long_form_source_pool
import patternlab_video04_visual_route as video04_visual_route
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

    def write_builder_fixture(
        self,
        root: Path,
        launch: Path,
        *,
        add_context_to_first_claim: bool = False,
        omit_first_claim_direct_proof: bool = False,
    ) -> list[dict]:
        """Write a complete city-owned fixture with one unique visual per event."""
        launch.mkdir(parents=True, exist_ok=True)
        (launch / "final-script.md").write_text("approved script", encoding="utf-8")
        (launch / "package.json").write_text(json.dumps({
            "video_id": "04",
            "city": "Detroit",
            "hidden_history_question": "What did Detroit erase in Black Bottom?",
            "proof_object": "A source-backed neighborhood map and clearance record",
            "visual_payoff": "The old street grid and replacement footprint shown together",
            "working_title": "The Neighborhood Detroit Erased",
        }), encoding="utf-8")
        (launch / "evidence-queries.json").write_text(json.dumps({
            "required_city_terms": ["Detroit"],
        }), encoding="utf-8")
        claims = evidence_builder.planned_claims("04")
        assets: list[dict] = []
        segments: list[dict] = []
        for claim_index, claim in enumerate(claims):
            duration = 2.5 if float(claim["start"]) < 30 else 5.0
            event_count = max(1, math.ceil((float(claim["end"]) - float(claim["start"])) / duration))
            entries: list[dict] = []
            for event_index in range(event_count):
                asset_id = f"fixture-{claim['claim_id']}-{event_index + 1:03d}"
                local = root / "evidence" / f"{asset_id}.jpg"
                local.parent.mkdir(parents=True, exist_ok=True)
                local.write_bytes(asset_id.encode("utf-8"))
                direct = not (omit_first_claim_direct_proof and claim_index == 0)
                kind = "photo"
                if direct and event_index == 0 and claim["role"] in {"map_system", "then_now"}:
                    kind = "map"
                elif direct and event_index == 0 and claim["role"] == "document_detail":
                    kind = "document"
                assets.append({
                    "asset_id": asset_id,
                    "source_id": f"source-{asset_id}",
                    "relative_path": str(local.relative_to(root)),
                    "source_url": f"https://example.test/archive/{asset_id}",
                    "source_title": " ".join(claim["entities"]),
                    "creator": "Detroit archive",
                    "rights_basis": "public domain",
                    "human_accepted": True,
                    "commercial_use_ok": True,
                    "modification_ok": True,
                    "source_class": "historical_evidence",
                    "evidence_fit": "direct" if direct else "supporting",
                    "entity_terms": claim["entities"],
                    "claim_ids": [claim["claim_id"]],
                    "asset_kind": kind,
                    "editorial_role": "proof" if direct else "context_only",
                    "geographic_scope": "city_specific",
                })
                role = claim["role"] if direct and event_index == 0 else "archive_evidence" if direct else "context_only"
                entries.append({"asset_id": asset_id, "role": role})
            if add_context_to_first_claim and claim_index == 0:
                context_id = "fixture-generic-foot-traffic"
                context = root / "context" / f"{context_id}.mp4"
                context.parent.mkdir(parents=True, exist_ok=True)
                context.write_bytes(b"generic context")
                assets.append({
                    "asset_id": context_id,
                    "source_id": "source-generic-context",
                    "relative_path": str(context.relative_to(root)),
                    "source_url": "https://example.test/stock/foot-traffic",
                    "source_title": "Generic urban foot traffic",
                    "creator": "Example stock creator",
                    "rights_basis": "commercial stock license",
                    "human_accepted": True,
                    "commercial_use_ok": True,
                    "modification_ok": True,
                    "source_class": "modern_context",
                    "evidence_fit": "context_only",
                    "entity_terms": [],
                    "claim_ids": [claim["claim_id"]],
                    "asset_kind": "modern_video",
                    "editorial_role": "context_only",
                    "geographic_scope": "generic",
                    "may_imply_named_city": False,
                    "context_action": "foot_traffic",
                    "context_emotion": "street-level economic life",
                })
                entries.insert(1, {"asset_id": context_id, "role": "context_only"})
            segments.append({
                "start": claim["start"],
                "end": claim["end"],
                "claim_id": claim["claim_id"],
                "entries": entries,
            })
        route = {
            "version": 1,
            "video_id": "04",
            "city": "Detroit",
            "claims": [
                {
                    "claim_id": claim["claim_id"],
                    "text": claim["text"],
                    "required_entity_terms": claim["entities"],
                    "role": claim["role"],
                    "start": claim["start"],
                    "end": claim["end"],
                }
                for claim in claims
            ],
            "chapter_labels": [{"start": 0, "end": claims[-1]["end"], "label": "SOURCE TRAIL"}],
            "requirements": {
                "minimum_unique_assets": len({entry["asset_id"] for segment in segments for entry in segment["entries"]}),
                "minimum_unique_asset_ratio": 1.0,
                "maximum_uses_per_asset": 1,
                "maximum_uses_per_static_asset": 1,
                "minimum_static_asset_reuse_gap_seconds": 180.0,
                "maximum_runtime_share_per_asset": 1.0,
                "maximum_map_document_share": 1.0,
                "minimum_moving_image_share": 0.0,
                "maximum_same_source_family_run": 999,
                "ai_visuals_allowed": False,
            },
            "segments": segments,
        }
        (launch / "long-form-visual-routing.json").write_text(json.dumps(route), encoding="utf-8")
        return assets

    def test_video_04_source_pool_has_production_diversity_floors(self):
        self.assertEqual(long_form_source_pool.MINIMUM_ASSETS, 60)
        self.assertEqual(long_form_source_pool.MINIMUM_HISTORICAL_ASSETS, 40)
        self.assertEqual(long_form_source_pool.MINIMUM_MOVING_IMAGE_ASSETS, 10)
        self.assertEqual(long_form_source_pool.MINIMUM_MODERN_VIDEO_ASSETS, 7)
        self.assertEqual(long_form_source_pool.MINIMUM_DISTINCT_SOURCE_URLS, 52)

    def test_video_04_federal_acts_card_is_deterministic_and_officially_sourced(self):
        additions = json.loads(
            (YOUTUBE_ROOT / "launch" / "video-04" / "long-form-source-additions.json").read_text(
                encoding="utf-8"
            )
        )
        source = next(
            row
            for row in additions["assets"]
            if row["asset_id"] == long_form_source_pool.FEDERAL_ACTS_CARD_ASSET_ID
        )
        self.assertEqual(
            source["source_urls"],
            [
                "https://www.govinfo.gov/app/details/COMPS-10349",
                "https://www.senate.gov/artandhistory/history/minute/Federal_Highway_Act.htm",
            ],
        )
        self.assertEqual(source["editorial_role"], "proof")
        self.assertEqual(source["geographic_scope"], "not_applicable")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "video-04"
            first = long_form_source_pool.render_federal_acts_source_card(root)
            first_sha = long_form_source_pool.sha256_file(first)
            second = long_form_source_pool.render_federal_acts_source_card(root)
            self.assertEqual(long_form_source_pool.sha256_file(second), first_sha)
            self.assertEqual(first_sha, source["sha256"])

    def test_video_04_federal_law_beat_uses_source_card_before_local_consequence(self):
        route = video04_visual_route.build_route()
        beat = next(segment for segment in route["segments"] if segment["start"] == 250)
        self.assertEqual(
            [entry["asset_id"] for entry in beat["entries"]],
            [
                long_form_source_pool.FEDERAL_ACTS_CARD_ASSET_ID,
                "fhwa-detroit-chrysler-freeway-1964",
            ],
        )
        self.assertEqual(beat["entries"][0]["role"], "source_proof")
        self.assertIn("two federal laws", beat["entries"][0]["narration_fit"])

    def test_video_04_route_has_no_asset_repeat_inside_review_sheet_window(self):
        route = video04_visual_route.build_route()
        entries = [entry for segment in route["segments"] for entry in segment["entries"]]
        repeats = []
        for offset in range(0, len(entries), 16):
            counts = Counter(entry["asset_id"] for entry in entries[offset : offset + 16])
            repeats.extend(
                (offset // 16 + 1, asset_id, count)
                for asset_id, count in counts.items()
                if count > 1
            )
        self.assertEqual(repeats, [])

    def test_video_04_route_excludes_sequence_judge_rejection_assets(self):
        route = video04_visual_route.build_route()
        by_start = {segment["start"]: segment for segment in route["segments"]}
        self.assertEqual(by_start[20]["entries"][3]["asset_id"], "ia-detroit-home-movies-1955")
        self.assertEqual(by_start[30]["entries"][0]["asset_id"], "ia-detroit-news-1917")
        self.assertEqual(by_start[30]["entries"][1]["asset_id"], "sanborn-1950-sheet-17")
        self.assertEqual(by_start[90]["entries"][1]["asset_id"], "video-04-visual-rebuild-loc-2017813226")
        self.assertEqual(by_start[100]["entries"][0]["asset_id"], "loc-detroit-family-sojourner-truth-1942")
        self.assertEqual(by_start[110]["entries"][0]["asset_id"], "video-04-visual-rebuild-loc-2017858657")
        self.assertEqual(
            by_start[120]["entries"][1]["asset_id"],
            "loc-sojourner-truth-multiple-unit-1942",
        )
        self.assertEqual(by_start[130]["entries"][1]["asset_id"], "loc-sojourner-truth-homes-1942")
        self.assertEqual(by_start[230]["entries"][1]["asset_id"], "video-04-visual-rebuild-loc-2017813174")
        self.assertEqual(by_start[490]["entries"][0]["asset_id"], "ia-detroit-home-movies-1955")
        self.assertNotIn(
            "video-04-visual-rebuild-loc-2017844243",
            [entry["asset_id"] for segment in route["segments"] for entry in segment["entries"]],
        )

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

    def test_owner_review_requires_strict_media_qa_even_when_other_gates_pass(self):
        values = {
            "package_hash": "pass",
            "canonical_preflight": "pass",
            "canonical_release": "pass",
            "canonical_render": "pass",
            "render_quality": "pass",
            "visual_release_quality": "pass",
            "long_form_quality": "pass",
            "shorts_quality": "pass",
            "thumbnail_quality": "pass",
            "episode_standard": "pass",
            "visual_contract": "pass",
            "context_media_library": "pass",
            "voice_visual_match": "pass",
            "finished_watchdown": "pass",
        }
        self.assertEqual(owner_review_status(owner_review_gate_statuses(**values)), "blocked-before-owner-review")
        values["media_qa"] = "pass"
        self.assertEqual(owner_review_status(owner_review_gate_statuses(**values)), "ready-for-owner-review")

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

    def test_manifest_rejects_reused_visual_with_same_presentation_variant(self):
        payload = {
            "episode_id": "04",
            "title": "Black Bottom source proof",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "source.jpg", "sha256": "a" * 64}],
            "visual_beats": [
                {"beat_id": "proof-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3, "presentation_variant": "same-crop"},
                {"beat_id": "proof-2", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "archive_evidence", "start_seconds": 3, "end_seconds": 6, "reuse_reason": "new detail", "presentation_variant": "same-crop"},
            ],
        }
        with self.assertRaisesRegex(ValueError, "new presentation_variant"):
            EpisodeManifest.model_validate(payload)

    def test_manifest_accepts_reused_visual_with_distinct_presentation_variant(self):
        payload = {
            "episode_id": "04",
            "title": "Black Bottom source proof",
            "claims": [{"claim_id": "claim-1", "text": "Black Bottom was a Detroit neighborhood.", "fact_checker_status": "verified", "source_ids": ["source-1"]}],
            "assets": [{"asset_id": "asset-1", "source_id": "source-1", "source_class": "historical_evidence", "rights_status": "approved", "evidence_fit": "direct", "visual_fit": "approved", "relative_path": "source.jpg", "sha256": "a" * 64}],
            "visual_beats": [
                {"beat_id": "proof-1", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "source_proof", "start_seconds": 0, "end_seconds": 3, "presentation_variant": "wide-map"},
                {"beat_id": "proof-2", "claim_ids": ["claim-1"], "asset_ids": ["asset-1"], "role": "archive_evidence", "start_seconds": 183, "end_seconds": 186, "reuse_reason": "new labeled detail", "presentation_variant": "hastings-closeup"},
            ],
        }
        self.assertEqual(len(EpisodeManifest.model_validate(payload).visual_beats), 2)

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

    def test_source_rebuild_rejects_black_bottom_dance_as_geographic_evidence(self):
        self.assertFalse(
            source_rebuild.geographically_specific_historical_record(
                "Singer performing the Black Bottom dance in Detroit", ["black bottom"], ["detroit"]
            )
        )
        self.assertTrue(
            source_rebuild.geographically_specific_historical_record(
                "Black Bottom Detroit neighborhood street map", ["black bottom"], ["detroit"]
            )
        )

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
        self.write_builder_fixture(root, launch)
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
        assets = self.write_builder_fixture(root, launch)
        intake = root / "source-packet" / "evidence-intake.json"
        intake.parent.mkdir(parents=True)
        intake.write_text(json.dumps({"video_id": "04", "assets": assets}), encoding="utf-8")
        with patch.object(evidence_builder, "output_root", lambda _: root), patch.object(evidence_builder, "launch_root", lambda _: launch):
            payload, _, manifest_path = evidence_builder.build_manifest("04")
        self.assertEqual(payload["status"], "pass", payload["blockers"])
        self.assertTrue(manifest_path.exists())
        self.assertTrue((root / "approval" / "evidence-manifest-binding.json").exists())

    def test_video_04_visual_plan_covers_full_retained_narration(self):
        claims = evidence_builder.planned_claims("04")
        self.assertEqual(claims[0]["start"], 0)
        self.assertAlmostEqual(claims[-1]["end"], 499.322, places=3)
        for previous, current in zip(claims, claims[1:]):
            self.assertEqual(previous["end"], current["start"])

    def test_explicit_visual_route_rejects_unsupported_claim_instead_of_reassigning(self):
        claims = evidence_builder.planned_claims("04")
        claims_by_id = {claim["claim_id"]: claim for claim in claims}
        assets = {
            "black-bottom-only": {
                "asset_id": "black-bottom-only",
                "claim_ids": ["black-bottom-neighborhood"],
                "source_class": "historical_evidence",
                "evidence_fit": "supporting",
                "asset_kind": "photo",
                "source_url": "https://example.test/black-bottom",
                "source_id": "source-black-bottom",
                "geographic_scope": "city_specific",
            }
        }
        route = {
            "segments": [
                {
                    "start": 0,
                    "end": 499.322,
                    "claim_id": "housing-restrictions",
                    "entries": [{"asset_id": "black-bottom-only", "role": "context_only"}],
                }
            ]
        }
        blockers: list[str] = []
        beats, _ = evidence_builder.explicit_route_beats(route, assets, claims_by_id, blockers)
        self.assertEqual(beats, [])
        self.assertIn(
            "long_form_visual_route_claim_not_supported:black-bottom-only:housing-restrictions:black-bottom-neighborhood",
            blockers,
        )

    def test_explicit_visual_route_requires_rationale_for_cross_claim_foreshadowing(self):
        claims = evidence_builder.planned_claims("04")
        claims_by_id = {claim["claim_id"]: claim for claim in claims}
        assets = {
            "business-proof": {
                "asset_id": "business-proof",
                "claim_ids": ["black-bottom-neighborhood", "paradise-valley-businesses"],
                "source_class": "historical_evidence",
                "evidence_fit": "supporting",
                "asset_kind": "photo",
                "source_url": "https://example.test/business",
                "source_id": "source-business",
                "geographic_scope": "city_specific",
            }
        }
        route = {
            "segments": [
                {
                    "start": 0,
                    "end": 499.322,
                    "claim_id": "black-bottom-neighborhood",
                    "entries": [
                        {
                            "asset_id": "business-proof",
                            "claim_id": "paradise-valley-businesses",
                            "role": "context_only",
                        }
                    ],
                }
            ]
        }
        blockers: list[str] = []
        beats, _ = evidence_builder.explicit_route_beats(route, assets, claims_by_id, blockers)
        self.assertEqual(beats, [])
        self.assertIn(
            "long_form_visual_route_cross_claim_rationale_missing:business-proof:"
            "black-bottom-neighborhood:paradise-valley-businesses",
            blockers,
        )

    def test_evidence_builder_mixes_context_only_after_direct_proof(self):
        root = Path(self.temp.name) / "context-output" / "video-04"
        launch = Path(self.temp.name) / "context-launch" / "video-04"
        assets = self.write_builder_fixture(root, launch, add_context_to_first_claim=True)
        intake = root / "source-packet" / "evidence-intake.json"
        intake.parent.mkdir(parents=True)
        intake.write_text(json.dumps({"video_id": "04", "assets": assets}), encoding="utf-8")
        with patch.object(evidence_builder, "output_root", lambda _: root), patch.object(evidence_builder, "launch_root", lambda _: launch):
            payload, _, manifest_path = evidence_builder.build_manifest("04")
        self.assertEqual(payload["status"], "pass", payload["blockers"])
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        first_claim_beats = [beat for beat in manifest["visual_beats"] if "black-bottom-neighborhood" in beat["claim_ids"]]
        self.assertEqual(first_claim_beats[0]["role"], "source_proof")
        self.assertTrue(any(beat["role"] == "context_only" for beat in first_claim_beats[1:]))

    def test_evidence_builder_rejects_context_without_direct_proof(self):
        root = Path(self.temp.name) / "context-only-output" / "video-04"
        launch = Path(self.temp.name) / "context-only-launch" / "video-04"
        assets = self.write_builder_fixture(root, launch, omit_first_claim_direct_proof=True)
        intake = root / "source-packet" / "evidence-intake.json"
        intake.parent.mkdir(parents=True)
        intake.write_text(json.dumps({"video_id": "04", "assets": assets}), encoding="utf-8")
        with patch.object(evidence_builder, "output_root", lambda _: root), patch.object(evidence_builder, "launch_root", lambda _: launch):
            payload, _, _ = evidence_builder.build_manifest("04")
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("claim_missing_accepted_direct_visual:black-bottom-neighborhood", payload["blockers"])
