"""Approval, export and live loopback authentication regression tests."""
# ruff: noqa: PT009, PT027

import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from unittest.mock import patch

with patch.object(sys, "path", [str(Path(__file__).resolve().parents[1]), *sys.path]):
    import documents
    import server
    from review import Review
    from security import Pairing
    from store import Store


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.relative = "cv-private/jobs/example"
        self.job = self.root / self.relative
        self.job.mkdir(parents=True)
        self.store = Store(self.root / "state.sqlite3")
        analysis, _ = self.store.start(self.relative, "analyze")
        self.store.update(analysis["id"], status="complete")
        generation, _ = self.store.start(self.relative, "generate")
        self.version = generation["id"]
        source = self.root / "source"
        source.mkdir()
        for name in (
            "cv.yaml",
            "cover_letter.tex",
            "tailoring_notes.md",
            "requirements.json",
        ):
            (source / name).write_text("Fictional source", encoding="utf-8")
        for name in ("output/cv/cv.pdf", "output/cover-letter/cover_letter.pdf"):
            path = source / name
            path.parent.mkdir(parents=True)
            path.write_bytes(b"Fictional PDF bytes for manifest tests")
        documents.publish(source, self.job, self.version, [], {"items": []})
        self.store.update(self.version, status="complete")
        self.store.save_application(
            {
                "directory": self.relative,
                "currentVersion": self.version,
                "versions": [{"id": self.version}],
            }
        )
        self.review = Review(self.root, self.store)

    def test_approval_is_explicit_versioned_and_export_contains_only_application_files(
        self,
    ):
        with self.assertRaises(ValueError):
            self.review.export(self.relative, self.version)
        with self.assertRaises(ValueError):
            self.review.approve(self.relative, self.version, False)
        self.review.approve(self.relative, self.version, True)
        with zipfile.ZipFile(
            io.BytesIO(self.review.export(self.relative, self.version))
        ) as archive:
            self.assertEqual(
                set(archive.namelist()),
                {
                    "cv.pdf",
                    "cover_letter.pdf",
                    "requirements.json",
                    "tailoring_notes.md",
                },
            )
        self.assertEqual(
            self.store.application(self.relative)["approvals"][0]["version"],
            self.version,
        )

    def test_changed_files_and_arbitrary_paths_are_rejected(self):
        with self.assertRaises(ValueError):
            self.review.artifact(self.relative, self.version, "../../master_cv.yaml")
        (self.job / "versions" / self.version / "cv.yaml").write_text(
            "Changed after rendering", encoding="utf-8"
        )
        with self.assertRaises(ValueError):
            self.review.approve(self.relative, self.version, True)

    def test_private_http_requires_pairing_and_exact_host_origin(self):
        pairing = Pairing(self.root / "connection.json")
        with (
            patch.object(server, "PROJECT_ROOT", self.root),
            patch.object(server, "PAIRING", pairing),
        ):
            http = server.ThreadingHTTPServer(("127.0.0.1", 0), server.CaptureHandler)
            thread = threading.Thread(target=http.serve_forever, daemon=True)
            thread.start()
            try:
                base = f"http://127.0.0.1:{http.server_port}"
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(base + "/applications")
                self.assertEqual(error.exception.code, 401)
                headers = {
                    "Origin": "chrome-extension://" + "a" * 32,
                    "X-Job-Capture-Token": pairing.config["token"],
                }
                request = urllib.request.Request(
                    base + "/pair", method="POST", headers=headers
                )
                with urllib.request.urlopen(request) as response:
                    self.assertTrue(json.load(response)["ok"])
                request = urllib.request.Request(
                    base + "/applications", headers=headers
                )
                with urllib.request.urlopen(request) as response:
                    self.assertIn("applications", json.load(response))
                request = urllib.request.Request(
                    base + "/applications", headers=headers | {"Host": "example.test"}
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 401)
            finally:
                http.shutdown()
                http.server_close()
                thread.join()
