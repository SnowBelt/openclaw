import plistlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

YOUTUBE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(YOUTUBE_ROOT))
sys.path.insert(0, str(YOUTUBE_ROOT / "scripts"))

import patternlab_launchd_install as launchd_install
import patternlab_preflight as preflight
from patternlab.production import load_contract


class FakeLaunchctl:
    def __init__(self) -> None:
        self.loaded: dict[str, list[str]] = {}

    def __call__(self, command, **_kwargs):
        if command[:2] == ["launchctl", "bootout"]:
            self.loaded.pop(command[-1].rsplit("/", 1)[-1], None)
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[:2] == ["launchctl", "bootstrap"]:
            path = Path(command[-1])
            with path.open("rb") as handle:
                payload = plistlib.load(handle)
            self.loaded[payload["Label"]] = payload["ProgramArguments"]
            return subprocess.CompletedProcess(command, 0, "", "")
        if command[:2] == ["launchctl", "print"]:
            label = command[-1].rsplit("/", 1)[-1]
            arguments = self.loaded.get(label)
            if arguments is None:
                return subprocess.CompletedProcess(command, 113, "", "service not found")
            return subprocess.CompletedProcess(command, 0, "\n".join(arguments), "")
        raise AssertionError(command)


class PatternLabLaunchdInstallTests(unittest.TestCase):
    def test_apply_backs_up_malformed_files_and_installs_only_canonical_agents(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            launch_agents = root / "LaunchAgents"
            launch_agents.mkdir()
            malformed = launch_agents / "com.openclaw.patternlab-v2..plist"
            malformed.write_bytes(b"")
            legacy = launch_agents / "com.openclaw.pattern-lab.daily-review.plist"
            legacy.write_text('["not", "a", "plist"]', encoding="utf-8")
            runner = FakeLaunchctl()
            payload, _report = launchd_install.build_report(
                apply=True,
                launch_agents_dir=launch_agents,
                uid=502,
                automation_root=YOUTUBE_ROOT / "automation",
                runner=runner,
            )
            self.assertEqual(payload["status"], "pass", payload["blockers"])
            self.assertFalse(payload["rollback_performed"])
            backup = Path(payload["backup"])
            self.assertTrue((backup / malformed.name).is_file())
            self.assertTrue((backup / legacy.name).is_file())
            self.assertFalse(malformed.exists())
            self.assertFalse(legacy.exists())
            for label in launchd_install.CANONICAL_LABELS:
                destination = launch_agents / f"{label}.plist"
                self.assertTrue(destination.is_file())
                self.assertEqual(launchd_install.read_plist(destination)["Label"], label)
            verified, _report = launchd_install.build_report(
                apply=False,
                launch_agents_dir=launch_agents,
                uid=502,
                automation_root=YOUTUBE_ROOT / "automation",
                runner=runner,
            )
            self.assertEqual(verified["status"], "pass", verified["blockers"])
            self.assertEqual(verified["backup"], str(backup))

    def test_verify_rejects_missing_and_obsolete_launchagents(self):
        with tempfile.TemporaryDirectory() as temp:
            launch_agents = Path(temp)
            (launch_agents / "com.openclaw.pattern-lab.dashboard.plist").write_bytes(b"")
            _rows, blockers = launchd_install.verify_installation(
                launch_agents,
                502,
                automation_root=YOUTUBE_ROOT / "automation",
                runner=FakeLaunchctl(),
            )
            self.assertTrue(any(item.startswith("installed_launchagent_missing_or_invalid:") for item in blockers))
            self.assertIn(
                "obsolete_or_malformed_launchagent_file:com.openclaw.pattern-lab.dashboard.plist",
                blockers,
            )

    def test_apply_rolls_back_files_when_bootstrap_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            launch_agents = Path(temp)
            legacy = launch_agents / "com.openclaw.pattern-lab.dashboard.plist"
            legacy.write_text('["legacy"]', encoding="utf-8")

            def failing_runner(command, **_kwargs):
                code = 1 if command[:2] == ["launchctl", "bootstrap"] else 0
                return subprocess.CompletedProcess(command, code, "", "failed" if code else "")

            payload, _report = launchd_install.build_report(
                apply=True,
                launch_agents_dir=launch_agents,
                uid=502,
                automation_root=YOUTUBE_ROOT / "automation",
                runner=failing_runner,
            )
            self.assertEqual(payload["status"], "blocked")
            self.assertTrue(payload["rollback_performed"])
            self.assertEqual(legacy.read_text(encoding="utf-8"), '["legacy"]')

    def test_preflight_targets_canonical_label_with_current_uid(self):
        checks = []
        canonical = {
            "Label": preflight.DAILY_LAUNCHAGENT_LABEL,
            "ProgramArguments": [
                "/python",
                "/runtime/patternlab_daily_loop.py",
                "--target",
                preflight.EXPECTED_DISCORD_TARGET,
            ],
            "StartCalendarInterval": {"Hour": 4, "Minute": 25},
        }
        with tempfile.TemporaryDirectory() as temp:
            plist = Path(temp) / "daily.plist"
            with plist.open("wb") as handle:
                plistlib.dump(canonical, handle)
            with patch.object(preflight, "REPO_DAILY_PLIST", plist), patch.object(
                preflight, "INSTALLED_DAILY_PLIST", plist
            ), patch.object(preflight.os, "getuid", return_value=777), patch.object(
                preflight,
                "command_text",
                return_value=("/runtime/patternlab_daily_loop.py", "", 0),
            ) as command:
                preflight.validate_launchd(checks)
            command.assert_called_once_with(
                ["launchctl", "print", f"gui/777/{preflight.DAILY_LAUNCHAGENT_LABEL}"]
            )
            self.assertFalse([item for item in checks if item["status"] == "fail"])

    def test_all_production_profiles_require_launchd_integrity(self):
        for profile in ("long_form_rebuild", "full_package"):
            contract = load_contract(
                YOUTUBE_ROOT / "resources" / "patternlab-production-contract.json",
                profile,
            )
            stage_ids = [stage.stage_id for stage in contract.stages]
            self.assertIn("launchd_integrity", stage_ids)
            self.assertLess(stage_ids.index("runtime_source_integrity"), stage_ids.index("launchd_integrity"))
            self.assertLess(stage_ids.index("launchd_integrity"), stage_ids.index("city_portability"))


if __name__ == "__main__":
    unittest.main()
