import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(YOUTUBE_ROOT))
sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

from patternlab.production import ContractError, ProductionRunner, load_contract
import patternlab_owner_rejection_gate as rejection_gate
import patternlab_rendered_media_quality as rendered_media_quality
import patternlab_skill_deployment as skill_deployment
import patternlab_runtime_source_deploy as runtime_deploy
import patternlab_workflow_integrity as workflow_integrity
import patternlab_production as production_entrypoint


def write_contract(path: Path, stages: list[dict], *, requires_lock: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "contract_id": "fixture",
                "minimum_automated_score": 93,
                "profiles": {
                    "fixture": {
                        "description": "fixture",
                        "requires_production_lock": requires_lock,
                        "stages": stages,
                    }
                },
            }
        ),
        encoding="utf-8",
    )


class PatternLabProductionContractTests(unittest.TestCase):
    def test_next_scheduled_without_compatible_lock_is_a_safe_idle_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            youtube_root = Path(temp) / "youtube-v1"
            with (
                patch.object(production_entrypoint, "YOUTUBE_ROOT", youtube_root),
                patch.object(
                    sys,
                    "argv",
                    ["patternlab_production.py", "--next-scheduled", "--profile", "full_package", "--dry-run"],
                ),
                patch(
                    "patternlab_full_auto_production.next_incomplete_video",
                    side_effect=__import__("patternlab_full_auto_production").NoProductionCandidate(
                        profile="full_package",
                        candidates=[
                            {
                                "video_id": "04",
                                "topic_status": "active_rebuild",
                                "production_lock_profile": "long_form_rebuild",
                            }
                        ],
                    ),
                ),
            ):
                production_entrypoint.main()
            payload = json.loads(
                (youtube_root / "local-output" / "operations" / "canonical-production-idle.json").read_text(
                    encoding="utf-8"
                )
            )
        self.assertEqual(payload["status"], "idle_waiting_for_profile_compatible_approval")
        self.assertEqual(payload["youtube_mutation"], "not_performed")

    def test_current_workflow_integrity_enforces_future_addition_standard(self):
        payload, _report = workflow_integrity.build_report()
        self.assertEqual(payload["status"], "pass", payload["blockers"])
        self.assertFalse(
            [item for item in payload["blockers"] if item.startswith("future_addition_standard_missing:")]
        )

    def test_runtime_source_deployment_backs_up_and_hash_verifies_without_media(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            target = Path(temp) / "runtime"
            (source / "scripts").mkdir(parents=True)
            (source / "local-output").mkdir()
            (source / "scripts" / "worker.py").write_text("print('new')\n", encoding="utf-8")
            (source / "README.md").write_text("canonical\n", encoding="utf-8")
            (source / "local-output" / "media.mp4").write_bytes(b"do-not-copy")
            (target / "scripts").mkdir(parents=True)
            (target / "scripts" / "worker.py").write_text("print('old')\n", encoding="utf-8")
            paths = runtime_deploy.selected_paths(source)
            self.assertNotIn(source / "local-output" / "media.mp4", paths)
            files = runtime_deploy.source_manifest(source, paths)
            backup = runtime_deploy.deploy(source, target, files)
            self.assertTrue(backup.is_file())
            missing, mismatched = runtime_deploy.compare_target(target, files)
            self.assertEqual((missing, mismatched), ([], []))
            self.assertFalse((target / "local-output" / "media.mp4").exists())

    def test_runtime_source_selection_preserves_mutable_operational_state(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            slate = source / "state" / "monetization" / "content-slate.json"
            mutable = source / "state" / "monetization" / "ypp-progress.json"
            slate.parent.mkdir(parents=True)
            slate.write_text("{}\n", encoding="utf-8")
            mutable.write_text('{"subscribers": 123}\n', encoding="utf-8")
            paths = runtime_deploy.selected_paths(source)
            self.assertIn(slate, paths)
            self.assertNotIn(mutable, paths)

    def test_runtime_source_selection_includes_renderer_source_without_dependencies(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            renderer = source / "render"
            contract = renderer / "src" / "contract.mjs"
            dependency = renderer / "node_modules" / "generated.mjs"
            contract.parent.mkdir(parents=True)
            dependency.parent.mkdir(parents=True)
            (renderer / "package.json").write_text('{"private": true}\n', encoding="utf-8")
            contract.write_text("export const ready = true;\n", encoding="utf-8")
            dependency.write_text("export const generated = true;\n", encoding="utf-8")
            paths = runtime_deploy.selected_paths(source)
            self.assertIn(renderer / "package.json", paths)
            self.assertIn(contract, paths)
            self.assertNotIn(dependency, paths)

    def test_runtime_source_selection_includes_current_verification_tests(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            current_test = source / "tests" / "test_current_contract.py"
            stale_cache = source / "tests" / "__pycache__" / "test_current_contract.pyc"
            current_test.parent.mkdir(parents=True)
            stale_cache.parent.mkdir(parents=True)
            current_test.write_text("def test_current_contract(): pass\n", encoding="utf-8")
            stale_cache.write_bytes(b"stale")
            paths = runtime_deploy.selected_paths(source)
            self.assertIn(current_test, paths)
            self.assertNotIn(stale_cache, paths)

    def test_runtime_source_verify_uses_manifest_and_allows_mutable_launch_extras(self):
        deployed = {"scripts/worker.py": "a" * 64}
        current = {
            **deployed,
            "launch/video-05/package.json": "b" * 64,
            "launch/video-05/research-brief.md": "c" * 64,
        }
        files, ignored, blockers = runtime_deploy.verification_files(
            Path("/runtime"),
            Path("/runtime"),
            current,
            {"files": deployed},
        )
        self.assertEqual(files, deployed)
        self.assertEqual(
            ignored,
            ["launch/video-05/package.json", "launch/video-05/research-brief.md"],
        )
        self.assertEqual(blockers, [])

    def test_runtime_source_verify_rejects_unmanaged_source_file(self):
        deployed = {"scripts/worker.py": "a" * 64}
        files, ignored, blockers = runtime_deploy.verification_files(
            Path("/runtime"),
            Path("/runtime"),
            {**deployed, "scripts/unmanaged.py": "b" * 64},
            {"files": deployed},
        )
        self.assertEqual(files, deployed)
        self.assertEqual(ignored, [])
        self.assertEqual(blockers, ["runtime_source_unmanaged_file:scripts/unmanaged.py"])

    def test_runtime_source_rollback_restores_old_files_and_removes_new_files(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            target = Path(temp) / "runtime"
            (source / "scripts").mkdir(parents=True)
            (target / "scripts").mkdir(parents=True)
            (source / "scripts" / "worker.py").write_text("new\n", encoding="utf-8")
            (source / "scripts" / "added.py").write_text("added\n", encoding="utf-8")
            (target / "scripts" / "worker.py").write_text("old\n", encoding="utf-8")
            (target / runtime_deploy.MANIFEST_NAME).write_text('{"old": true}\n', encoding="utf-8")
            files = runtime_deploy.source_manifest(source, runtime_deploy.selected_paths(source))
            backup = runtime_deploy.deploy(source, target, files)
            self.assertEqual(runtime_deploy.restore_backup(target, backup), [])
            self.assertEqual((target / "scripts" / "worker.py").read_text(encoding="utf-8"), "old\n")
            self.assertFalse((target / "scripts" / "added.py").exists())
            self.assertEqual(
                (target / runtime_deploy.MANIFEST_NAME).read_text(encoding="utf-8"),
                '{"old": true}\n',
            )

    def test_runtime_source_deploy_removes_only_manifest_owned_stale_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            target = Path(temp) / "runtime"
            (source / "scripts").mkdir(parents=True)
            (target / "scripts").mkdir(parents=True)
            mutable = target / "state" / "monetization" / "ypp-progress.json"
            mutable.parent.mkdir(parents=True)
            (source / "scripts" / "worker.py").write_text("current\n", encoding="utf-8")
            stale = target / "scripts" / "obsolete.py"
            stale.write_text("obsolete\n", encoding="utf-8")
            mutable.write_text('{"subscribers": 123}\n', encoding="utf-8")
            (target / runtime_deploy.MANIFEST_NAME).write_text(
                json.dumps(
                    {
                        "files": {
                            "scripts/obsolete.py": "old",
                            "state/monetization/ypp-progress.json": "mutable",
                        }
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            files = runtime_deploy.source_manifest(source, runtime_deploy.selected_paths(source))
            runtime_deploy.deploy(source, target, files)
            self.assertFalse(stale.exists())
            self.assertEqual(mutable.read_text(encoding="utf-8"), '{"subscribers": 123}\n')

    def test_runtime_source_selection_allows_credential_code_but_blocks_secret_data(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source"
            (source / "scripts").mkdir(parents=True)
            safe_module = source / "scripts" / "patternlab_youtube_credentials.py"
            secret_data = source / "scripts" / "oauth-token.json"
            safe_module.write_text("def resolve(): return None\n", encoding="utf-8")
            secret_data.write_text("{}\n", encoding="utf-8")
            blockers = runtime_deploy.validate_selection(
                source,
                (safe_module, secret_data),
            )
            self.assertNotIn(
                "runtime_source_forbidden_secret_filename:scripts/patternlab_youtube_credentials.py",
                blockers,
            )
            self.assertIn(
                "runtime_source_forbidden_secret_filename:scripts/oauth-token.json",
                blockers,
            )

    def test_skill_deployment_copies_and_hash_verifies_exact_source_files(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source-skill"
            target = Path(temp) / "active" / "source-skill"
            (source / "agents").mkdir(parents=True)
            (source / "SKILL.md").write_text("canonical\n", encoding="utf-8")
            (source / "agents" / "openai.yaml").write_text("name: canonical\n", encoding="utf-8")
            before = skill_deployment.compare_skill(source, target)
            self.assertEqual(before["status"], "blocked")
            skill_deployment.deploy_skill(source, target)
            after = skill_deployment.compare_skill(source, target)
            self.assertEqual(after["status"], "pass")
            (target / "SKILL.md").write_text("stale\n", encoding="utf-8")
            stale = skill_deployment.compare_skill(source, target)
            self.assertEqual(stale["mismatched_files"], ["SKILL.md"])

    def test_rendered_text_gate_allows_current_beat_ocr_noise_but_not_narration(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "video-04"
            approval = root / "approval"
            approval.mkdir(parents=True)
            (approval / "canonical-render-plan.json").write_text(
                json.dumps(
                    {
                        "beats": [
                            {
                                "start_seconds": 0,
                                "end_seconds": 5,
                                "editorial_callout": "A LIVED COMMUNITY",
                                "context_disclosure": "Present-day Detroit context",
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            rendered_media_quality._render_plan.cache_clear()
            approved = rendered_media_quality.approved_overlay_tokens(root, 2.0, "04")
            self.assertIn("context", approved)
            self.assertNotIn("freeway", approved)
            self.assertEqual(
                rendered_media_quality.remove_ocr_matches({"conta", "freeway"}, approved),
                {"freeway"},
            )

    def test_real_long_form_profile_is_complete_and_excludes_other_assets(self):
        contract = load_contract(YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json", "long_form_rebuild")
        commands = "\n".join(" ".join(stage.command).lower() for stage in contract.stages)
        self.assertGreaterEqual(contract.minimum_automated_score, 93)
        self.assertIn("long_form_aggregate_qa", {stage.stage_id for stage in contract.stages})
        self.assertIn("discord_owner_review", {stage.stage_id for stage in contract.stages})
        self.assertNotIn("short", commands)
        self.assertNotIn("thumbnail", commands)

    def test_contract_rejects_youtube_mutation_command(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "contract.json"
            write_contract(
                path,
                [
                    {
                        "id": "bad",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "youtube-v1/scripts/upload_approved_package.py"],
                        "outputs": [{"path": "output:approval/result.json"}],
                    }
                ],
            )
            with self.assertRaisesRegex(ContractError, "youtube_mutation_command_forbidden"):
                load_contract(path, "fixture")

    def test_real_patternlab_contract_requires_governance_and_bootstrap_gates(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "contract.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "contract_id": "patternlab-production-fixture",
                        "minimum_automated_score": 93,
                        "change_governance": {
                            "required_surfaces": ["youtube-v1/AGENTS.md"],
                            "required_skills": ["patternlab-production-director"],
                            "legacy_entrypoints_requiring_canonical_context": [
                                "youtube-v1/scripts/legacy.py"
                            ],
                        },
                        "profiles": {
                            "fixture": {
                                "description": "fixture",
                                "requires_production_lock": True,
                                "stages": [
                                    {
                                        "id": "unmanaged",
                                        "phase": "prepare",
                                        "side_effect": "local_write",
                                        "command": ["{python}", "stage.py"],
                                        "outputs": [{"path": "output:approval/result.json"}],
                                    }
                                ],
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ContractError, "production_profile_bootstrap_gates_missing"):
                load_contract(path, "fixture")

    def test_runner_is_fail_fast_resumable_and_invalidates_changed_implementation(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp) / "repo"
            youtube = repo / "youtube-v1"
            output = Path(temp) / "media" / "video-04"
            script = repo / "stage.py"
            script.parent.mkdir(parents=True)
            script.write_text(
                "import json, pathlib, sys\n"
                "path=pathlib.Path(sys.argv[1]); path.parent.mkdir(parents=True, exist_ok=True); "
                "path.write_text(json.dumps({'status':'pass'}))\n",
                encoding="utf-8",
            )
            shared = youtube / "patternlab" / "shared.py"
            shared.parent.mkdir(parents=True)
            shared.write_text("SHARED_VERSION = 1\n", encoding="utf-8")
            contract_path = youtube / "resources" / "contract.json"
            write_contract(
                contract_path,
                [
                    {
                        "id": "one",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "stage.py", "{output_root}/approval/result.json"],
                        "outputs": [{"path": "output:approval/result.json", "json_status": ["pass"]}],
                    }
                ],
            )
            contract = load_contract(contract_path, "fixture")

            def execute() -> dict:
                return ProductionRunner(
                    repo_root=repo,
                    youtube_root=youtube,
                    output_root=output,
                    contract=contract,
                    video_id="04",
                    production_lock={},
                    render=False,
                    send_review=False,
                    dry_run=False,
                ).execute()

            first = execute()
            self.assertEqual(first["status"], "pass")
            self.assertEqual(first["stages"][0]["status"], "pass")
            self.assertEqual(first["first_pass_stage_success_rate"], 1.0)
            self.assertEqual(first["executed_stage_count"], 1)
            second = execute()
            self.assertEqual(second["stages"][0]["status"], "reused")
            self.assertEqual(second["reused_stage_count"], 1)
            script.write_text(script.read_text(encoding="utf-8") + "# changed\n", encoding="utf-8")
            third = execute()
            self.assertEqual(third["status"], "pass")
            self.assertEqual(third["stages"][0]["status"], "pass")
            self.assertNotEqual(first["run_fingerprint"], third["run_fingerprint"])
            shared.write_text("SHARED_VERSION = 2\n", encoding="utf-8")
            fourth = execute()
            self.assertEqual(fourth["status"], "pass")
            self.assertEqual(fourth["stages"][0]["status"], "pass")
            self.assertNotEqual(third["run_fingerprint"], fourth["run_fingerprint"])
            history = (output / "approval" / "canonical-production-history.jsonl").read_text(
                encoding="utf-8"
            )
            self.assertEqual(len([line for line in history.splitlines() if line]), 4)

    def test_required_failure_skips_downstream_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp) / "repo"
            youtube = repo / "youtube-v1"
            output = Path(temp) / "media" / "video-04"
            fail = repo / "fail.py"
            succeed = repo / "succeed.py"
            fail.parent.mkdir(parents=True)
            fail.write_text("raise SystemExit(7)\n", encoding="utf-8")
            succeed.write_text("raise SystemExit('must not run')\n", encoding="utf-8")
            contract_path = youtube / "resources" / "contract.json"
            write_contract(
                contract_path,
                [
                    {
                        "id": "fail",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "fail.py"],
                        "outputs": [{"path": "output:approval/fail.json"}],
                    },
                    {
                        "id": "later",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "succeed.py"],
                        "outputs": [{"path": "output:approval/later.json"}],
                    },
                ],
            )
            payload = ProductionRunner(
                repo_root=repo,
                youtube_root=youtube,
                output_root=output,
                contract=load_contract(contract_path, "fixture"),
                video_id="04",
                production_lock={},
                render=False,
                send_review=False,
                dry_run=False,
            ).execute()
            self.assertEqual(payload["status"], "blocked")
            self.assertEqual(payload["stages"][0]["status"], "blocked")
            self.assertEqual(payload["stages"][1]["status"], "skipped")
            self.assertEqual(payload["stages"][1]["blocked_by"], "fail")

    def test_downstream_qa_change_reuses_unaffected_upstream_stage(self):
        with tempfile.TemporaryDirectory() as temp:
            repo = Path(temp) / "repo"
            youtube = repo / "youtube-v1"
            output = Path(temp) / "media" / "video-04"
            first_script = repo / "first.py"
            second_script = repo / "second.py"
            first_script.parent.mkdir(parents=True)
            program = (
                "import json, pathlib, sys\n"
                "path=pathlib.Path(sys.argv[1]); path.parent.mkdir(parents=True, exist_ok=True); "
                "path.write_text(json.dumps({'status':'pass'}))\n"
            )
            first_script.write_text(program, encoding="utf-8")
            second_script.write_text(program, encoding="utf-8")
            contract_path = youtube / "resources" / "contract.json"
            write_contract(
                contract_path,
                [
                    {
                        "id": "render",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "first.py", "{output_root}/approval/first.json"],
                        "outputs": [
                            {"path": "output:approval/first.json", "json_status": ["pass"]}
                        ],
                    },
                    {
                        "id": "qa",
                        "phase": "prepare",
                        "side_effect": "local_write",
                        "command": ["{python}", "second.py", "{output_root}/approval/second.json"],
                        "outputs": [
                            {"path": "output:approval/second.json", "json_status": ["pass"]}
                        ],
                    },
                ],
            )
            contract = load_contract(contract_path, "fixture")

            def execute() -> dict:
                return ProductionRunner(
                    repo_root=repo,
                    youtube_root=youtube,
                    output_root=output,
                    contract=contract,
                    video_id="04",
                    production_lock={},
                    render=False,
                    send_review=False,
                    dry_run=False,
                ).execute()

            first = execute()
            self.assertEqual([row["status"] for row in first["stages"]], ["pass", "pass"])
            second_script.write_text(program + "# qa-only change\n", encoding="utf-8")
            second = execute()
            self.assertEqual(second["stages"][0]["status"], "reused")
            self.assertEqual(second["stages"][1]["status"], "pass")

    def test_owner_rejection_gate_requires_new_hash_and_current_qa(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "video-04"
            approval = root / "approval"
            video_dir = root / "video"
            rejected = video_dir / "rejected"
            approval.mkdir(parents=True)
            rejected.mkdir(parents=True)
            current = video_dir / "pattern-lab-video-04-draft.mp4"
            old = rejected / "pattern-lab-video-04-owner-rejected-old.mp4"
            current.write_bytes(b"new-render")
            old.write_bytes(b"old-render")
            (approval / "owner-feedback.jsonl").write_text(
                json.dumps({"asset_type": "video", "sentiment": "negative", "reason": "visuals_mismatch"}) + "\n",
                encoding="utf-8",
            )
            from patternlab.state import sha256_file

            (approval / "long-form-media-qa-report.json").write_text(
                json.dumps({"status": "pass", "video_sha256": sha256_file(current)}),
                encoding="utf-8",
            )
            with patch.object(rejection_gate, "output_root", lambda _: root):
                payload, _ = rejection_gate.build_report("04")
            self.assertEqual(payload["status"], "pass")
            self.assertEqual(payload["repair_queue_resolution"], "pending_owner_approval_of_replacement")


if __name__ == "__main__":
    unittest.main()
