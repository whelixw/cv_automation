"""Workspace setup, diagnostics and explicit private backup/restore operations."""

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath, PureWindowsPath

import documents
from store import Store


def initialize(workspace, sources):
    private = workspace / "cv-private"
    (private / "jobs").mkdir(parents=True, exist_ok=True)
    for name in ("master_cv.yaml", "constraints.md", "cover_letter_constraints.md"):
        source = sources / "cv-workspace/templates" / name
        target = private / name
        if not target.exists():
            shutil.copyfile(source, target)
    if not (workspace / "AGENTS.md").exists() and (sources / "AGENTS.md").is_file():
        shutil.copyfile(sources / "AGENTS.md", workspace / "AGENTS.md")
    for name in (
        "schema.json",
        "docs/user_guide/yaml_input_structure/cv.md",
        "docs/user_guide/yaml_input_structure/design.md",
        "docs/user_guide/cli_reference.md",
        "cv-workspace/templates/cover_letter_template.tex",
    ):
        source = sources / name
        if source.is_file():
            target = workspace / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copyfile(source, target)


def diagnose(workspace):
    checks = []
    for module in ("rendercv", "pymupdf"):
        found = importlib.util.find_spec(module) is not None
        checks.append(
            {
                "name": module,
                "ok": found,
                "detail": importlib.metadata.version(module)
                if found
                else "Install the companion requirements.",
            }
        )
    checks.append(
        {
            "name": "Bundled LaTeX helper",
            "ok": documents.compiler_script() is not None,
            "detail": "Tectonic helper required; configure JOB_CAPTURE_LATEX_SCRIPT if detection fails. TeX packages may download on the first build.",
        }
    )
    for name in ("master_cv.yaml", "constraints.md", "cover_letter_constraints.md"):
        path = workspace / "cv-private" / name
        ready = path.is_file() and bool(path.read_text(encoding="utf-8").strip())
        if name == "master_cv.yaml" and ready:
            ready = "name: Your Name" not in path.read_text(encoding="utf-8")
        checks.append(
            {
                "name": name,
                "ok": ready,
                "detail": "Use verified personal facts and approved preferences; replace the starter profile.",
            }
        )
    return checks


def backup(workspace, destination):
    private = workspace / "cv-private"
    if private.resolve() in destination.resolve().parents or destination.exists():
        raise ValueError("Choose a new backup filename outside cv-private.")
    state = private / ".job-capture/workflow.sqlite3"
    inventory = {}
    created = False
    try:
        with tempfile.TemporaryDirectory(prefix="job-capture-backup-") as temporary:
            snapshot = Path(temporary) / "workflow.sqlite3"
            if state.exists():
                Store(state).backup(snapshot)
            with zipfile.ZipFile(destination, "x", zipfile.ZIP_DEFLATED) as archive:
                created = True
                files = list(private.rglob("*"))
                if (workspace / "AGENTS.md").is_file():
                    files.append(workspace / "AGENTS.md")
                for source in files:
                    if source.is_symlink():
                        raise ValueError("Backup does not follow symbolic links.")
                    if not source.is_file() or ".publishing-" in source.as_posix():
                        continue
                    relative = source.relative_to(workspace).as_posix()
                    if relative.startswith("cv-private/.job-capture/"):
                        continue  # Raw database/connection secrets are not copied.
                    content = source.read_bytes()
                    archive.writestr(relative, content)
                    inventory[relative] = hashlib.sha256(content).hexdigest()
                if snapshot.exists():
                    content = snapshot.read_bytes()
                    name = "cv-private/.job-capture/workflow.sqlite3"
                    archive.writestr(name, content)
                    inventory[name] = hashlib.sha256(content).hexdigest()
                archive.writestr(
                    "backup-manifest.json",
                    json.dumps({"schema_version": 1, "files": inventory}),
                )
    except Exception:
        if created and destination.exists():
            destination.unlink()
        raise


def restore(archive_path, workspace):
    if workspace.exists() and any(workspace.iterdir()):
        raise ValueError(
            "Restore requires a new or empty workspace; existing data is never overwritten."
        )
    with zipfile.ZipFile(archive_path) as archive:
        manifest = json.loads(archive.read("backup-manifest.json"))
        if manifest.get("schema_version") != 1 or not isinstance(
            manifest.get("files"), dict
        ):
            raise ValueError("Unsupported backup format")
        total = 0
        contents = {}
        for name, sha in manifest["files"].items():
            path = PurePosixPath(name)
            if (
                path.is_absolute()
                or ".." in path.parts
                or PureWindowsPath(name).drive
                or "\\" in name
                or ":" in name
            ):
                raise ValueError("Invalid backup path")
            if not (
                name.startswith("cv-private/") or name == "AGENTS.md"
            ) or name.endswith("connection.json"):
                raise ValueError("Unexpected backup file")
            info = archive.getinfo(name)
            total += info.file_size
            if info.file_size > 50_000_000 or total > 500_000_000:
                raise ValueError("Backup exceeds restore limits")
            content = archive.read(name)
            if hashlib.sha256(content).hexdigest() != sha:
                raise ValueError("Backup integrity check failed")
            contents[name] = content
    # Verify the complete archive before creating any files.
    workspace.mkdir(parents=True, exist_ok=True)
    for name, content in contents.items():
        target = workspace / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=("initialize", "diagnose", "backup", "restore")
    )
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--sources", type=Path)
    parser.add_argument("--file", type=Path)
    args = parser.parse_args()
    workspace = args.workspace.expanduser().resolve()
    if args.command == "initialize":
        initialize(workspace, args.sources.resolve())
    elif args.command == "diagnose":
        print(json.dumps(diagnose(workspace), indent=2))  # noqa: T201 -- CLI diagnostics
    elif args.command == "backup":
        backup(workspace, args.file.resolve())
    else:
        restore(args.file.resolve(), workspace)


if __name__ == "__main__":
    main()
