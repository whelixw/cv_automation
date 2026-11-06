"""Exercise orchestration through publication with a deterministic fake agent."""
# ruff: noqa: PT009

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1]), *sys.path]):
    import server


class GenerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.relative = "cv-private/jobs/example"
        self.job = self.root / self.relative
        self.job.mkdir(parents=True)
        for name in ("master_cv.yaml", "constraints.md", "cover_letter_constraints.md"):
            (self.root / "cv-private" / name).write_text(
                "Verified fictional facts", encoding="utf-8"
            )
        for name in ("job_posting.md", "prompt.md"):
            (self.job / name).write_text("Fictional posting", encoding="utf-8")
        for name, value in (
            ("PROJECT_ROOT", self.root),
            ("JOBS_ROOT", self.root / "cv-private/jobs"),
        ):
            patcher = patch.object(server, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        analysis, _ = server.store().start(self.relative, "analyze")
        server.store().update(analysis["id"], status="complete")
        self.run, _ = server.store().start(self.relative, "generate")
        server.store().save_application(
            {"directory": self.relative, "title": "Fictional analyst", "versions": []}
        )

    def fake_agent(self, command, prompt, cwd, **kwargs):
        self.assertIn("requirements.json", prompt)
        self.assertNotEqual(cwd, self.root)
        self.assertIn("workspace-write", command)
        self.assertNotIn("--approve-for-me", command)
        job = cwd / self.relative
        for name in ("cv.yaml", "cover_letter.tex", "tailoring_notes.md"):
            (job / name).write_text("Fictional sources", encoding="utf-8")
        (job / "requirements.json").write_text(
            json.dumps({"items": []}), encoding="utf-8"
        )
        return SimpleNamespace(returncode=0, stdout="Draft prepared", stderr="")

    @staticmethod
    def fake_render(job, cancelled):
        if cancelled():
            raise RuntimeError("Unexpected cancellation in successful-run fixture")
        for name in ("output/cv/cv.pdf", "output/cover-letter/cover_letter.pdf"):
            target = job / name
            target.parent.mkdir(parents=True)
            target.write_bytes(b"Test artifact; real renderers are checked separately")

    def test_successful_generation_publishes_version_and_preserves_profile(self):
        with (
            patch.object(server, "resolve_codex_executable", return_value="fake"),
            patch.object(server, "run_agent", side_effect=self.fake_agent),
            patch.object(server.documents, "render", side_effect=self.fake_render),
        ):
            server.run_automation(self.run["id"], "generate", self.relative, "Approved")
        self.assertEqual(server.store().task(self.run["id"])["status"], "complete")
        self.assertEqual(
            server.store().application(self.relative)["currentVersion"], self.run["id"]
        )
        self.assertTrue(
            (self.job / "versions" / self.run["id"] / "manifest.json").is_file()
        )
        self.assertEqual(
            (self.root / "cv-private/master_cv.yaml").read_text(),
            "Verified fictional facts",
        )

    def test_cancelled_run_cannot_publish(self):
        server.store().update(self.run["id"], status="cancelling")
        publish = Mock()
        self.assertFalse(
            server.store().publish_generation(self.run["id"], publish, "Draft")
        )
        publish.assert_not_called()

    def test_build_failure_is_repaired_before_publication(self):
        attempts = []

        def render(job, cancelled):
            attempts.append(1)
            if len(attempts) == 1:
                raise ValueError("A layout override is missing its design section")
            self.fake_render(job, cancelled)

        with (
            patch.object(server, "resolve_codex_executable", return_value="fake"),
            patch.object(server, "run_agent", side_effect=self.fake_agent) as agent,
            patch.object(server.documents, "render", side_effect=render),
        ):
            server.run_automation(self.run["id"], "generate", self.relative, "Approved")
        self.assertEqual(agent.call_count, 2)
        self.assertEqual(server.store().task(self.run["id"])["status"], "complete")
        self.assertTrue(
            (self.job / "runs" / self.run["id"] / "attempt-0-sources/cv.yaml").exists()
        )

    def test_persistent_build_failure_stops_after_two_repairs(self):
        with (
            patch.object(server, "resolve_codex_executable", return_value="fake"),
            patch.object(server, "run_agent", side_effect=self.fake_agent) as agent,
            patch.object(
                server.documents,
                "render",
                side_effect=ValueError("Invalid document source"),
            ),
        ):
            server.run_automation(self.run["id"], "generate", self.relative, "Approved")
        self.assertEqual(agent.call_count, 3)
        self.assertEqual(server.store().task(self.run["id"])["status"], "failed")
        self.assertFalse((self.job / "versions").exists())
