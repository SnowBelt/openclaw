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


if __name__ == "__main__":
    unittest.main()
