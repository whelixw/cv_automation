"""Offline characterization of legacy companion behavior and future contracts."""

# Keep this suite runnable with the standard-library unittest runner.
# ruff: noqa: PT009, PT027

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
contract_spec = importlib.util.spec_from_file_location(
    "capture_contracts", ROOT / "contracts.py"
)
contracts = importlib.util.module_from_spec(contract_spec)
contract_spec.loader.exec_module(contracts)

spec = importlib.util.spec_from_file_location(
    "capture_server_baseline", ROOT / "server.py"
)
server = importlib.util.module_from_spec(spec)
with patch.object(sys, "path", [str(ROOT), *sys.path]):
    spec.loader.exec_module(server)


class BaselineTests(unittest.TestCase):
    def test_all_prompt_paths_preserve_shared_rules(self):
        for prompt in (
            server.build_prompt("cv-private/jobs/example", "Emphasize analysis"),
            server.analysis_prompt("cv-private/jobs/example"),
            server.generation_prompt("cv-private/jobs/example", "Approved"),
        ):
            with self.subTest(prompt=prompt[:40]):
                self.assertIn("master_cv.yaml", prompt)
                self.assertIn("personal_flair.md", prompt)
                self.assertIn("compile_latex.py --compiler tectonic", prompt)
                self.assertIn("untrusted job information", prompt)
                self.assertIn("eligibility", prompt)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.jobs = self.root / "cv-private" / "jobs"
        self.jobs.mkdir(parents=True)
        for name, value in (
            ("PROJECT_ROOT", self.root),
            ("JOBS_ROOT", self.jobs),
            ("TASKS", {}),
        ):
            patcher = patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        # Exercise handlers without binding ports or launching an agent.
        self.handler = object.__new__(server.CaptureHandler)
        self.responses = []
        self.handler._json = lambda payload, status=200: self.responses.append(
            (payload, status)
        )

    def test_sanitized_captures_preserve_description_and_manual_prompt(self):
        fixtures = json.loads((ROOT / "tests/fixtures/captures.json").read_text())
        for capture in fixtures:
            with self.subTest(source=capture["method"]):
                contracts.Capture.model_validate(capture)
                self.handler._capture(capture)
                payload, status = self.responses[-1]
                self.assertEqual(status, 200)
                directory = self.root / payload["directory"]
                self.assertIn(
                    capture["description"], (directory / "job_posting.md").read_text()
                )
                self.assertEqual(
                    payload["prompt"], (directory / "prompt.md").read_text()
                )
                self.assertIn("master_cv.yaml", payload["prompt"])
                self.assertFalse((directory / "cv.yaml").exists())

    def test_empty_capture_creates_no_job(self):
        with self.assertRaises(ValueError):
            self.handler._capture({"description": "   "})
        self.assertEqual(list(self.jobs.iterdir()), [])

    def test_job_path_cannot_escape_or_select_jobs_root(self):
        for path in ("../outside", "cv-private/jobs", str(self.root)):
            with self.subTest(path=path), self.assertRaises(ValueError):
                server.resolve_job_directory(path)

    def test_untrusted_web_origin_is_rejected(self):
        self.handler.headers = {"Origin": "https://example.test"}
        self.handler.do_POST()
        self.assertEqual(self.responses[-1][1], 403)

    def test_start_and_status_do_not_launch_real_agent(self):
        directory = self.jobs / "example-role"
        directory.mkdir()
        with patch.object(server.threading, "Thread") as thread:
            self.handler._start_automation(
                {"phase": "analyze", "directory": "cv-private/jobs/example-role"}
            )
        thread.return_value.start.assert_called_once()
        payload, status = self.responses[-1]
        self.assertEqual(status, 202)
        self.handler.path = "/automation/status?id=" + payload["task"]["id"]
        self.handler.do_GET()
        self.assertEqual(self.responses[-1][0]["task"]["status"], "queued")

    def test_fake_agent_success_and_failure(self):
        for returncode, expected in ((0, "complete"), (1, "failed")):
            with self.subTest(returncode=returncode):
                server.TASKS["fake"] = {}
                with (
                    patch.dict(os.environ, {"JOB_CAPTURE_CODEX_EXE": ""}),
                    patch.object(server.shutil, "which", return_value="fake-agent"),
                    patch.object(
                        server.subprocess,
                        "run",
                        return_value=SimpleNamespace(
                            returncode=returncode,
                            stdout="Proposed emphasis",
                            stderr="" if returncode == 0 else "Agent failed",
                        ),
                    ) as run,
                ):
                    server.run_automation(
                        "fake", "analyze", "cv-private/jobs/example", ""
                    )
                self.assertEqual(server.TASKS["fake"]["status"], expected)
                self.assertIn("read-only", run.call_args.args[0])


class ContractTests(unittest.TestCase):
    def test_contracts_export_json_schema(self):
        for contract in contracts.CONTRACTS:
            self.assertIn("schema_version", contract.model_json_schema()["properties"])

    def test_unknown_versions_fields_and_blank_capture_rejected(self):
        fixture = json.loads((ROOT / "tests/fixtures/captures.json").read_text())[0]
        for changes in (
            {"schema_version": 2},
            {"unexpected": True},
            {"description": " "},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                contracts.Capture.model_validate(fixture | changes)

    def test_artifact_paths_cannot_escape_workspace(self):
        for path in (
            "../private",
            "/absolute",
            "C:/private",
            "C:private",
            "a\\..\\private",
            "file:stream",
            ".",
        ):
            with self.subTest(path=path), self.assertRaises(ValueError):
                contracts.Artifact(path=path, kind="cv_pdf", sha256="0" * 64)
        artifact = contracts.Artifact(
            path="output/cv/cv.pdf", kind="cv_pdf", sha256="0" * 64
        )
        self.assertEqual(artifact.path, "output/cv/cv.pdf")


if __name__ == "__main__":
    unittest.main()
