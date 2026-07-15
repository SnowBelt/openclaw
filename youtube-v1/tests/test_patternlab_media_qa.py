import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import patternlab_audio_quality as audio_quality
import patternlab_rendered_media_quality as rendered_quality
import patternlab_shorts_first_frame_quality as first_frame_quality
import patternlab_shorts_pacing_quality as pacing_quality
import patternlab_thumbnail_pixel_quality as thumbnail_pixel
import patternlab_thumbnail_font_quality as thumbnail_font
import patternlab_visual_judge as visual_judge
import patternlab_local_visual_judge_runner as visual_judge_runner
import patternlab_render_quality as render_quality
import patternlab_long_form_sequence_quality as sequence_quality
import patternlab_local_sequence_judge as local_sequence_judge
import patternlab_long_form_media_qa as long_form_media_qa
import patternlab_media_qa as media_qa
import patternlab_images
import patternlab_source_asset_preparation as source_preparation
import patternlab_canonical_renderer as canonical_renderer
from patternlab.state import sha256_file


class PatternLabMediaQATests(unittest.TestCase):
    def test_render_quality_scene_floor_uses_unique_beats_not_sample_frames(self):
        beats = [{"beat_id": f"beat-{index}"} for index in range(107)]
        self.assertEqual(render_quality.minimum_scene_count(beats), 53)

    def test_render_quality_semantic_reconciliation_preserves_siglip_diagnostics(self):
        rows = render_quality.reconcile_claim_matches(
            [{"beat_id": "beat-1", "match": False, "expected_claim_score": 0.0}],
            semantic_judge_passed=True,
        )
        self.assertFalse(rows[0]["match"])
        self.assertFalse(rows[0]["siglip_match"])
        self.assertEqual(rows[0]["match_basis"], "siglip_top_claim")
        self.assertEqual(rows[0]["siglip_expected_claim_score"], 0.0)

    def test_source_label_ocr_tokens_use_real_provider_name(self):
        self.assertEqual(render_quality.source_label_tokens("Library of Congress"), ["congress"])

    def test_media_qa_no_rendered_mode_requires_current_hashes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            video = root / "video" / "pattern-lab-video-04-draft.mp4"
            short = root / "shorts" / "pattern-lab-video-04-short-01.mp4"
            approval.mkdir(parents=True)
            video.parent.mkdir(parents=True)
            short.parent.mkdir(parents=True)
            video.write_bytes(b"video")
            short.write_bytes(b"short")
            report = {
                "status": "pass",
                "blockers": [],
                "assets": [
                    {"path": str(video), "sha256": sha256_file(video), "status": "pass"},
                    {"path": str(short), "sha256": sha256_file(short), "status": "pass"},
                ],
            }
            (approval / "rendered-media-quality-report.json").write_text(json.dumps(report))
            payload, _ = media_qa.current_rendered_report(approval, root, "04")
            self.assertEqual(payload["status"], "pass")
            short.write_bytes(b"changed")
            payload, _ = media_qa.current_rendered_report(approval, root, "04")
            self.assertEqual(payload["status"], "blocked")

    def test_long_form_aggregate_rejects_stale_sequence_receipts(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            approval = root / "approval"
            video = root / "video" / "pattern-lab-video-04-draft.mp4"
            approval.mkdir(parents=True)
            video.parent.mkdir(parents=True)
            video.write_bytes(b"current-video")
            (approval / "long-form-sequence-quality-report.json").write_text(
                json.dumps({"status": "pass", "blockers": [], "video_sha256": "stale", "canonical_render_plan_sha256": "stale", "score": 100})
            )
            (approval / "local-sequence-judge-report.json").write_text(
                json.dumps({"status": "pass", "blockers": [], "video_sha256": "stale", "qa_contract_sha256": "stale", "sequence_quality_report_sha256": "stale", "judgments": []})
            )
            with patch.object(long_form_media_qa, "output_root", return_value=root):
                payload, _, _ = long_form_media_qa.build_report("04")
        self.assertIn("long_form_sequence_report_stale", payload["blockers"])
        self.assertIn("local_sequence_judge_render_stale", payload["blockers"])
        self.assertIn("local_sequence_judge_contract_stale", payload["blockers"])

    def test_youtube_standard_1280_thumbnail_dimensions_are_accepted(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            images = root / "images"
            images.mkdir()
            Image.new("RGB", (1280, 720), (240, 120, 20)).save(images / "thumbnail_candidate_a.png")
            status = patternlab_images.file_status(root, "thumbnail_candidate_a.png")
            self.assertTrue(status["valid"])

    def test_source_preparation_accepts_full_frame_as_non_destructive_default(self):
        self.assertIsNone(source_preparation.focus_box(None))
        self.assertEqual(source_preparation.focus_box([0, 0, 1, 1]), (0.0, 0.0, 1.0, 1.0))

    def test_visual_judge_has_no_caption_only_score_reconciliation(self):
        self.assertFalse(hasattr(visual_judge, "caption_only_reconciliation"))

    def test_horizontal_split_artifact_is_rejected(self):
        image = Image.new("RGB", (1280, 720), "white")
        for y in range(360, 720):
            for x in range(1280):
                image.putpixel((x, y), (0, 0, 0))
        metrics = sequence_quality.horizontal_artifact_metrics(image)
        self.assertTrue(metrics["horizontal_seam_detected"])

    def test_clean_vertical_gradient_has_no_horizontal_artifact(self):
        image = Image.new("RGB", (1280, 720))
        for y in range(720):
            value = round(255 * y / 719)
            for x in range(1280):
                image.putpixel((x, y), (value, value, value))
        metrics = sequence_quality.horizontal_artifact_metrics(image)
        self.assertFalse(metrics["horizontal_seam_detected"])
        self.assertFalse(metrics["top_bottom_wrap_detected"])

    def test_top_bottom_wrap_artifact_is_rejected(self):
        image = Image.new("RGB", (1280, 720), (32, 96, 160))
        for y in range(128):
            for x in range(1280):
                value = (x * 17 + y * 11) % 256
                pixel = (value, (value * 3) % 256, (value * 5) % 256)
                image.putpixel((x, y), pixel)
                image.putpixel((x, 720 - 128 + y), pixel)
        metrics = sequence_quality.horizontal_artifact_metrics(image)
        self.assertTrue(metrics["top_bottom_wrap_detected"])

    def test_same_asset_twice_on_one_contact_sheet_is_rejected_before_render(self):
        beats = [
            {"beat_id": f"visual-{index:03d}", "asset_id": f"asset-{index:03d}"}
            for index in range(1, 17)
        ]
        beats[-1]["asset_id"] = beats[0]["asset_id"]
        self.assertEqual(
            sequence_quality.contact_sheet_asset_repeats(
                beats,
                beats_per_sheet=16,
                maximum_uses=1,
            ),
            [
                {
                    "sheet_index": 1,
                    "asset_id": "asset-001",
                    "uses": 2,
                    "beat_ids": ["visual-001", "visual-016"],
                }
            ],
        )

    def test_same_asset_on_later_contact_sheet_is_not_a_local_repeat(self):
        beats = [
            {"beat_id": f"visual-{index:03d}", "asset_id": f"asset-{index:03d}"}
            for index in range(1, 33)
        ]
        beats[-1]["asset_id"] = beats[0]["asset_id"]
        self.assertEqual(
            sequence_quality.contact_sheet_asset_repeats(
                beats,
                beats_per_sheet=16,
                maximum_uses=1,
            ),
            [],
        )

    def test_canonical_renderer_blocks_contact_sheet_reuse_before_render(self):
        beats = [
            {"beat_id": f"visual-{index:03d}", "asset_id": f"asset-{index:03d}"}
            for index in range(1, 17)
        ]
        beats[-1]["asset_id"] = beats[0]["asset_id"]
        repeats, blockers = canonical_renderer.sequence_window_reuse_blockers(beats)
        self.assertEqual(repeats[0]["asset_id"], "asset-001")
        self.assertEqual(
            blockers,
            ["pre_render_asset_repeated_within_contact_sheet:1:asset-001:2"],
        )

    def setUp(self):
        self.policy = json.loads((Path(__file__).resolve().parents[1] / "resources" / "media-qa-policy.json").read_text())

    def test_policy_requires_per_asset_93_and_no_average(self):
        self.assertEqual(self.policy["minimum_asset_score"], 93)
        self.assertTrue(self.policy["no_average_pass"])
        self.assertTrue(self.policy["warnings_block_release"])

    def test_policy_hardens_long_form_variety_and_motion(self):
        policy = self.policy["long_form_sequence"]
        self.assertEqual(policy["minimum_unique_assets"], 52)
        self.assertEqual(policy["minimum_unique_asset_ratio"], 0.8)
        self.assertEqual(policy["maximum_uses_per_static_asset"], 1)
        self.assertEqual(policy["minimum_static_asset_reuse_gap_seconds"], 180.0)
        self.assertEqual(policy["maximum_map_document_share"], 0.2)
        self.assertEqual(policy["minimum_moving_image_share"], 0.2)
        self.assertEqual(self.policy["historical_motion"]["minimum_production_selected_assets"], 4)
        self.assertEqual(policy["maximum_asset_uses_per_contact_sheet"], 1)

    def test_dim_flat_thumbnail_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "dim.png"
            Image.new("RGB", (1280, 720), (16, 16, 18)).save(path)
            blockers = thumbnail_pixel.evaluate_metrics(thumbnail_pixel.image_metrics(path), self.policy["thumbnail"])
        self.assertIn("thumbnail_mean_luma_below_floor", blockers)
        self.assertIn("thumbnail_contrast_below_floor", blockers)
        self.assertIn("thumbnail_saturation_below_floor", blockers)

    def test_tampered_thumbnail_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "candidate.png"
            Image.new("RGB", (1280, 720), (240, 120, 30)).save(path)
            with patch.object(thumbnail_pixel, "ocr_measurement", return_value={"word_recall": 1.0, "unknown_large_tokens": [], "unsafe_large_text_boxes": []}):
                row = thumbnail_pixel.validate_candidate({"id": "candidate", "path": str(path), "sha256": "0" * 64, "public_text": []}, self.policy["thumbnail"])
        self.assertIn("thumbnail_manifest_sha256_mismatch", row["blockers"])
        self.assertLess(row["score"], 93)

    def test_generic_impact_font_is_rejected_even_if_metadata_claims_a_layout(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "font.png"
            preview_dir = Path(temp) / "previews"
            Image.new("RGB", (1280, 720), (240, 180, 20)).save(source)
            entry = {
                "file": source.name,
                "path": str(source),
                "city_name_present": True,
                "thumbnail_text": "DETROIT TEST",
                "font": {
                    "impact_fallback_used": True,
                    "city_anchor": {"family": "Impact", "stroke_width": 2, "min_size": 90},
                    "main_hook": {"family": "Impact", "stroke_width": 2, "min_size": 90},
                    "supporting_line": {"family": "Montserrat", "stroke_width": 0, "min_size": 40},
                },
            }
            row = thumbnail_font.validate_entry(entry, thumbnail_font.load_policy(), preview_dir)
        self.assertIn("generic_main_hook_font_blocked:Impact", row["blockers"])
        self.assertIn("generic_city_anchor_font_blocked:Impact", row["blockers"])

    def test_bad_audio_metrics_are_rejected(self):
        metrics = {
            "audio_stream_present": True,
            "sample_rate_hz": 22050,
            "channel_count": 2,
            "integrated_loudness_lufs": -25,
            "true_peak_dbtp": 0,
            "loudness_range_lu": 20,
            "format_duration_seconds": 30,
            "silence_intervals": [{"start": 5, "end": 8, "duration": 3}],
            "av_duration_delta_seconds": 1,
        }
        blockers = audio_quality.evaluate_audio_metrics(metrics, self.policy["audio"], kind="short")
        self.assertIn("audio_integrated_loudness_out_of_range", blockers)
        self.assertIn("audio_true_peak_above_ceiling", blockers)
        self.assertIn("audio_internal_silence_or_dropout_detected", blockers)
        self.assertIn("audio_video_duration_desynchronization", blockers)

    def test_known_good_audio_metrics_pass_without_warning(self):
        metrics = {
            "audio_stream_present": True,
            "sample_rate_hz": 48000,
            "channel_count": 2,
            "integrated_loudness_lufs": -16,
            "true_peak_dbtp": -1.5,
            "loudness_range_lu": 6,
            "format_duration_seconds": 30,
            "silence_intervals": [],
            "av_duration_delta_seconds": 0.05,
        }
        self.assertEqual(audio_quality.evaluate_audio_metrics(metrics, self.policy["audio"], kind="short"), [])

    def test_rendered_defects_are_rejected(self):
        metrics = {
            "black_segments": [{"start": 0, "end": 1, "duration": 1}],
            "freeze_segments": [{"start": 4, "end": 6, "duration": 2}],
            "sample_count": 5,
            "dim_sample_ratio": 0.8,
            "unsafe_text_box_count": 1,
            "persistent_unknown_large_tokens": ["random"],
            "maximum_unchanged_visual_gap_seconds": 5,
        }
        blockers = rendered_quality.evaluate_render_metrics(metrics, self.policy["rendered_media"], kind="short")
        self.assertIn("black_segment_detected", blockers)
        self.assertIn("freeze_segment_detected", blockers)
        self.assertIn("unexpected_large_text_or_random_box_detected", blockers)
        self.assertIn("visual_event_gap_above_policy", blockers)

    def test_known_good_render_metrics_pass(self):
        metrics = {
            "black_segments": [],
            "freeze_segments": [],
            "sample_count": 20,
            "dim_sample_ratio": 0.05,
            "unsafe_text_box_count": 0,
            "persistent_unknown_large_tokens": [],
            "maximum_unchanged_visual_gap_seconds": 2,
        }
        self.assertEqual(rendered_quality.evaluate_render_metrics(metrics, self.policy["rendered_media"], kind="short"), [])

    def test_unknown_overlay_persistence_requires_temporal_proximity(self):
        unrelated = [
            {"seconds": 159.0, "unknown_large_tokens": ["valley"]},
            {"seconds": 324.0, "unknown_large_tokens": ["valley"]},
        ]
        persistent = [
            {"seconds": 12.0, "unknown_large_tokens": ["random"]},
            {"seconds": 15.0, "unknown_large_tokens": ["random"]},
        ]
        self.assertEqual(
            rendered_quality.temporally_persistent_unknown_tokens(
                unrelated,
                minimum_samples=2,
                maximum_span_seconds=6.0,
            ),
            [],
        )
        self.assertEqual(
            rendered_quality.temporally_persistent_unknown_tokens(
                persistent,
                minimum_samples=2,
                maximum_span_seconds=6.0,
            ),
            ["random"],
        )

    def test_rendered_sample_timestamp_uses_interval_midpoint(self):
        self.assertEqual(rendered_quality.sample_center_seconds(0, 3.0), 1.5)
        self.assertEqual(rendered_quality.sample_center_seconds(108, 3.0), 325.5)

    def test_native_source_text_is_not_an_authored_overlay_margin_defect(self):
        source_box = {"text": "SOURCE", "left": 2, "top": 2, "width": 40, "height": 30}
        self.assertEqual(
            rendered_quality.authored_overlay_unsafe_boxes(
                [source_box],
                expected_tokens={"source", "pattern"},
                native_tokens={"source", "document"},
            ),
            [],
        )
        self.assertEqual(
            rendered_quality.authored_overlay_unsafe_boxes(
                [{**source_box, "text": "PATTERN"}],
                expected_tokens={"source", "pattern"},
                native_tokens={"source", "document"},
            ),
            [{**source_box, "text": "PATTERN"}],
        )

    def test_frame_judge_prompt_is_role_aware_for_honest_context(self):
        prompt = visual_judge_runner.final_prompt(
            "People walked past stores in a living business district.",
            {"role": "context_only", "claim_ids": ["district-life"]},
        )
        self.assertIn("does not need to prove a named place or statistic", prompt)
        self.assertIn("Do not penalize an honest context_only frame", prompt)
        self.assertIn("source_proof", prompt)

    def test_frame_judge_prompt_allows_requested_source_backed_name_callout(self):
        prompt = visual_judge_runner.final_prompt(
            "Now listen to the names that belong on screen: the Flame Show Bar.",
            {
                "role": "source_proof",
                "claim_ids": ["venue-network"],
                "editorial_callout": "FLAME SHOW BAR",
            },
        )
        self.assertIn("explicitly asks for names", prompt)
        self.assertIn("FLAME SHOW BAR", prompt)
        self.assertIn("cannot rescue an unrelated image", prompt)

    def test_short_planning_pass_does_not_self_certify_missing_final_overlay(self):
        package = {
            "status": "pass",
            "city": "Detroit",
            "shorts": [
                {"id": f"04-short-{index:02d}", "index": index, "title": "Map Proof", "score": 100, "first_frame_text": "DETROIT MAP PROOF", "hook": "Detroit map proof.", "proof_visual": "archive map proof"}
                for index in range(1, 4)
            ],
        }
        with tempfile.TemporaryDirectory() as temp, patch.object(first_frame_quality, "output_root", return_value=Path(temp)), patch.object(first_frame_quality, "script_package", return_value=package):
            payload, _, _ = first_frame_quality.build_first_frame_quality_report("04")
        self.assertEqual(payload["planning_status"], "pass")
        self.assertEqual(payload["status"], "blocked")
        self.assertEqual(payload["overlay_checks_status"], "blocked")

    def test_pacing_planning_pass_does_not_self_certify_missing_render_inspection(self):
        package = {
            "status": "pass",
            "shorts": [
                {
                    "id": f"04-short-{index:02d}", "index": index, "title": "Map Proof", "score": 100,
                    "duration_seconds": 30, "first_frame_text": "DETROIT MAP", "hook": "Hook.",
                    "script": "Evidence.", "proof_visual": "map", "payoff": "Payoff.", "bridge_to_long_form": "Full video.",
                }
                for index in range(1, 4)
            ],
        }
        with tempfile.TemporaryDirectory() as temp, patch.object(pacing_quality, "output_root", return_value=Path(temp)), patch.object(pacing_quality, "script_package", return_value=package):
            payload, _, _ = pacing_quality.build_pacing_quality_report("04")
        self.assertEqual(payload["planning_status"], "pass")
        self.assertEqual(payload["status"], "blocked")

    def test_visual_judge_rejects_92_and_requires_current_frame_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            root = base / "local-output" / "video-04"
            approval = root / "approval"
            video = root / "video" / "pattern-lab-video-04-draft.mp4"
            frame = root / "review" / "frame.jpg"
            approval.mkdir(parents=True)
            video.parent.mkdir(parents=True)
            frame.parent.mkdir(parents=True)
            video.write_bytes(b"video")
            frame.write_bytes(b"frame")
            (base / "resources").mkdir()
            (base / "resources" / "visual-quality-rubric.json").write_text(json.dumps({"pass_score": 93, "hard_fail_dimensions": []}))
            (approval / "local-visual-model-benchmark-report.json").write_text(json.dumps({"status": "pass", "model_id": "qwen3-vl-8b-instruct"}))
            receipt = {
                "video_id": "04", "judge_model": "qwen3-vl-8b-instruct", "judge_mode": "local",
                "video_render_sha256": sha256_file(video),
                "frames": [{
                    "beat_id": "beat-1", "path": str(frame), "sha256": sha256_file(frame), "timestamp_seconds": 0,
                    "score": 92, "hard_failures": [],
                    "dimension_scores": {name: 100 for name in self.policy["visual_judge"]["required_dimensions"]},
                }],
            }
            receipt_path = approval / "receipt.json"
            receipt_path.write_text(json.dumps(receipt))
            with patch.object(visual_judge, "output_root", return_value=root), patch.object(visual_judge, "BASE", base), patch.object(visual_judge, "load_media_qa_policy", return_value=self.policy), patch.object(visual_judge, "media_duration_seconds", return_value=1):
                payload, _, _ = visual_judge.build_report("04", receipt_path)
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("score_below_threshold:beat-1", payload["blockers"])

    def test_local_visual_judge_fixture_measurements_reject_dim_pixels(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "dim.png"
            Image.new("RGB", (1280, 720), (12, 12, 14)).save(path)
            blockers, measurements = visual_judge_runner.deterministic_fixture_checks({}, path)
        self.assertIn("dim_or_flat_image:mean_luma", blockers)
        self.assertLess(measurements["mean_luma"], 0.2)

    def test_local_visual_judge_timestamp_sampling_meets_coverage_contract(self):
        values = visual_judge_runner.sample_timestamps(73.0, 2.0, 5.0)
        first = [0.0, *[value for value in values if value <= 30], 30.0]
        rest = [30.0, *[value for value in values if value >= 30], 73.0]
        self.assertLessEqual(max(b - a for a, b in zip(first, first[1:])), 2.0)
        self.assertLessEqual(max(b - a for a, b in zip(rest, rest[1:])), 5.0)

    def test_local_visual_judge_json_parser_ignores_non_json_log_prefix(self):
        parsed = visual_judge_runner.parse_json_object('backend ready\n{"verdict":"reject","reason":"wrong city"}\n')
        self.assertEqual(parsed["verdict"], "reject")

    def test_sequence_judge_prompt_binds_each_cell_to_nearby_narration(self):
        sheet = {
            "cells": [
                {"cell": 1, "timestamp_seconds": 42.5, "asset_id": "hastings-map"},
            ]
        }
        captions = [{"start": 40.0, "end": 45.0, "text": "Hastings Street appears on the map."}]
        value = local_sequence_judge.prompt(sheet, captions)
        self.assertIn("asset hastings-map", value)
        self.assertIn("Hastings Street appears on the map", value)
        self.assertIn("Compare every cell's underlying image", value)


if __name__ == "__main__":
    unittest.main()
