"""Source protection and publication checks, independent of an agent account."""
# ruff: noqa: PT009, PT027

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1]), *sys.path]):
    import documents


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / "project"
        self.private = self.project / "cv-private"
        self.private.mkdir(parents=True)
        for name in ("master_cv.yaml", "constraints.md", "cover_letter_constraints.md"):
            (self.private / name).write_text(
                "Fictional verified facts", encoding="utf-8"
            )
        self.relative = "cv-private/jobs/example"
        self.destination = self.project / self.relative
        self.destination.mkdir(parents=True)
        for name in ("job_posting.md", "prompt.md"):
            (self.destination / name).write_text("Fictional job", encoding="utf-8")
        self.workspace = self.root / "isolated"
        self.workspace.mkdir()

    def prepare(self):
        job, protected, refs = documents.prepare(
            self.project, self.relative, self.workspace
        )
        for name in ("cv.yaml", "cover_letter.tex", "tailoring_notes.md"):
            (job / name).write_text("Fictional generated content", encoding="utf-8")
        (job / "requirements.json").write_text(
            json.dumps({"items": [{"category": "attachment", "text": "Include CV"}]}),
            encoding="utf-8",
        )
        return job, protected, refs

    def test_profile_copy_is_protected_and_original_unchanged(self):
        job, protected, _ = self.prepare()
        self.assertEqual(len(documents.validate_sources(job, protected)["items"]), 1)
        (self.workspace / "cv-private/master_cv.yaml").write_text(
            "Invented claim", encoding="utf-8"
        )
        with self.assertRaisesRegex(ValueError, "protected"):
            documents.validate_sources(job, protected)
        self.assertEqual(
            (self.private / "master_cv.yaml").read_text(), "Fictional verified facts"
        )

    def test_incomplete_requirements_and_path_escape_are_rejected(self):
        job, protected, _ = self.prepare()
        (job / "requirements.json").write_text('{"items":[{}]}', encoding="utf-8")
        with self.assertRaises(ValueError):
            documents.validate_sources(job, protected)
        with self.assertRaises(ValueError):
            documents.contained(job, job / "../outside")

    def test_versions_are_preserved_and_hashes_match(self):
        job, protected, refs = self.prepare()
        (job / "output/cv").mkdir(parents=True)
        (job / "output/cv/cv.pdf").write_bytes(b"fictional test artifact")
        requirements = documents.validate_sources(job, protected)
        first = documents.publish(
            job, self.destination, "version-one", refs, requirements
        )
        (job / "cv.yaml").write_text("Revision", encoding="utf-8")
        documents.publish(job, self.destination, "version-two", refs, requirements)
        self.assertEqual(
            (self.destination / "versions/version-one/cv.yaml").read_text(),
            "Fictional generated content",
        )
        for item in first["artifacts"]:
            self.assertEqual(
                documents.digest(
                    self.destination / "versions/version-one" / item["path"]
                ),
                item["sha256"],
            )
        with self.assertRaises(ValueError):
            documents.publish(job, self.destination, "version-one", refs, requirements)
