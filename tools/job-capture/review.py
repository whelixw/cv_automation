"""Read immutable versions, approve exact artifacts, and export reviewed PDFs."""

import difflib
import io
import json
import re
import zipfile
from pathlib import Path

from documents import contained, digest


class Review:
    def __init__(self, project, store):
        self.project = project
        self.store = store

    def job(self, directory):
        path = contained(self.project / "cv-private/jobs", self.project / directory)
        if not path.is_dir() or self.store.application(directory) is None:
            raise ValueError("Unknown application")
        return path

    def manifest(self, directory, version):
        if not isinstance(version, str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{1,80}", version
        ):
            raise ValueError("Invalid version")
        job = self.job(directory)
        folder = contained(job, job / "versions" / version)
        path = contained(folder, folder / "manifest.json")
        manifest = json.loads(path.read_bytes())
        if manifest.get("id") != version or manifest.get("schema_version") != 1:
            raise ValueError("Invalid document manifest")
        return folder, manifest

    def artifact(self, directory, version, name):
        folder, manifest = self.manifest(directory, version)
        entry = next(
            (item for item in manifest["artifacts"] if item["path"] == name), None
        )
        if entry is None:
            raise ValueError("File is not part of this document version")
        path = contained(folder, folder / name)
        if path.stat().st_size > 50_000_000 or digest(path) != entry["sha256"]:
            raise ValueError(
                "Artifact changed after rendering or is too large; regenerate before review."
            )
        return path

    def details(self, directory, version=None):
        self.job(directory)
        app = self.store.application(directory)
        version = version or app.get("currentVersion")
        manifest = self.manifest(directory, version)[1] if version else None
        return {
            "application": app,
            "runs": self.store.runs(directory),
            "manifest": manifest,
        }

    def approve(self, directory, version, reviewed):
        app = self.store.application(directory)
        if not app or app.get("currentVersion") != version or reviewed is not True:
            raise ValueError(
                "Review the current version's documents and requirements before approval."
            )
        runs = self.store.runs(directory)
        if any(run["status"] in ("queued", "running", "cancelling") for run in runs):
            raise ValueError("Wait for the current run to finish before approval.")
        if not any(
            run["id"] == version and run["status"] == "complete" for run in runs
        ):
            raise ValueError("Only a successfully generated version can be approved.")
        _, manifest = self.manifest(directory, version)
        for item in manifest["artifacts"]:
            self.artifact(directory, version, item["path"])
        return self.store.approve(
            directory,
            version,
            digest(self.job(directory) / "versions" / version / "manifest.json"),
        )

    def export(self, directory, version):
        app = self.store.application(directory)
        if not app or app.get("approvedVersion") != version:
            raise ValueError(
                "Approve this version before exporting a final application."
            )
        approval = next(
            (
                item
                for item in reversed(app.get("approvals", []))
                if item["version"] == version
            ),
            None,
        )
        manifest_path = self.job(directory) / "versions" / version / "manifest.json"
        if not approval or digest(manifest_path) != approval["manifestHash"]:
            raise ValueError(
                "The manifest changed after approval. Review and approve the version again."
            )
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in (
                "output/cv/cv.pdf",
                "output/cover-letter/cover_letter.pdf",
                "requirements.json",
                "tailoring_notes.md",
            ):
                archive.write(
                    self.artifact(directory, version, name), arcname=Path(name).name
                )
        return buffer.getvalue()

    def compare(self, directory, left, right):
        changes = []
        for name in ("cv.yaml", "cover_letter.tex", "tailoring_notes.md"):
            before = (
                self.artifact(directory, left, name)
                .read_text(encoding="utf-8")
                .splitlines()
            )
            after = (
                self.artifact(directory, right, name)
                .read_text(encoding="utf-8")
                .splitlines()
            )
            changes.extend(
                difflib.unified_diff(
                    before,
                    after,
                    fromfile=f"{left}/{name}",
                    tofile=f"{right}/{name}",
                    lineterm="",
                )
            )
        return "\n".join(changes) or "No source changes."
