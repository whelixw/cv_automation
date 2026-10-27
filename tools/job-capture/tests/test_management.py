"""Workspace preservation, portable backups and clean release payloads."""
# ruff: noqa: PT009, PT027

import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1]), *sys.path]):
    import manage
    import release
    from store import Store


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_initialize_preserves_existing_profile(self):
        sources = self.root / "sources"
        templates = sources / "cv-workspace/templates"
        templates.mkdir(parents=True)
        for name in ("master_cv.yaml", "constraints.md", "cover_letter_constraints.md"):
            (templates / name).write_text("Starter", encoding="utf-8")
        workspace = self.root / "workspace"
        manage.initialize(workspace, sources)
        profile = workspace / "cv-private/master_cv.yaml"
        profile.write_text("Verified facts", encoding="utf-8")
        manage.initialize(workspace, sources)
        self.assertEqual(profile.read_text(), "Verified facts")

    def test_backup_restore_preserves_data_but_excludes_connection_secret(self):
        workspace = self.root / "workspace"
        private = workspace / "cv-private"
        state = private / ".job-capture"
        state.mkdir(parents=True)
        (private / "master_cv.yaml").write_text(
            "Fictional verified facts", encoding="utf-8"
        )
        (state / "connection.json").write_text('"not-for-backup"', encoding="utf-8")
        store = Store(state / "workflow.sqlite3")
        task, _ = store.start("cv-private/jobs/example", "analyze")
        backup = self.root / "private-backup.zip"
        manage.backup(workspace, backup)
        restored = self.root / "restored"
        manage.restore(backup, restored)
        self.assertEqual(
            (restored / "cv-private/master_cv.yaml").read_text(),
            "Fictional verified facts",
        )
        self.assertFalse(
            (restored / "cv-private/.job-capture/connection.json").exists()
        )
        self.assertEqual(
            Store(restored / "cv-private/.job-capture/workflow.sqlite3").task(
                task["id"]
            )["status"],
            "queued",
        )
        with self.assertRaises(ValueError):
            manage.restore(backup, restored)

    def test_restore_rejects_path_escape_before_writing(self):
        archive = self.root / "bad.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("../outside", "bad")
            output.writestr(
                "backup-manifest.json",
                json.dumps(
                    {
                        "schema_version": 1,
                        "files": {"../outside": hashlib.sha256(b"bad").hexdigest()},
                    }
                ),
            )
        with self.assertRaises(ValueError):
            manage.restore(archive, self.root / "restored")
        self.assertFalse((self.root / "outside").exists())
        self.assertFalse((self.root / "restored").exists())

    def test_release_payload_uses_allowlist_and_matching_hash_inventory(self):
        project = Path(__file__).resolve().parents[3]
        bundle = release.build(project, self.root / "release")
        with zipfile.ZipFile(bundle) as archive:
            self.assertFalse(
                any(
                    name.startswith("cv-private/")
                    or "connection.json" in name
                    or name.endswith(".log")
                    for name in archive.namelist()
                )
            )
            manifest = json.loads(archive.read("release-manifest.json"))
            for name, sha in manifest["files"].items():
                self.assertEqual(hashlib.sha256(archive.read(name)).hexdigest(), sha)
            self.assertIn("Install.cmd", archive.namelist())
            self.assertIn("extension/manifest.json", archive.namelist())
