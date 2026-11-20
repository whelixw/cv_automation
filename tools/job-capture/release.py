"""Build a private-data-free developer distribution and browser-store ZIP."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

VERSION = "0.5.0"


def build(project, output):
    output.mkdir(parents=True, exist_ok=True)
    tool = project / "tools/job-capture"
    with tempfile.TemporaryDirectory(prefix="job-capture-release-") as temporary:
        package = Path(temporary)
        companion = package / "companion"
        companion.mkdir()
        for name in (
            "server.py",
            "agent.py",
            "documents.py",
            "review.py",
            "security.py",
            "store.py",
            "workflow.py",
            "manage.py",
            "requirements.txt",
        ):
            shutil.copyfile(tool / name, companion / name)
        for name in ("Install.ps1", "Install.cmd", "Uninstall.ps1"):
            shutil.copyfile(tool / "installer" / name, package / name)
        sources = package / "references"
        public = [
            "AGENTS.md",
            "schema.json",
            "docs/user_guide/yaml_input_structure/cv.md",
            "docs/user_guide/yaml_input_structure/design.md",
            "docs/user_guide/cli_reference.md",
        ]
        public += [
            "cv-workspace/templates/" + name
            for name in (
                "master_cv.yaml",
                "constraints.md",
                "cover_letter_constraints.md",
                "cover_letter_template.tex",
            )
        ]
        # Use tracked source content for policy/templates so unrelated working edits
        # and all cv-private files stay out of distribution artifacts.
        for name in public:
            source = project / name
            target = sources / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if (project / ".git").exists():
                target.write_bytes(
                    subprocess.check_output(
                        [
                            "git",
                            "-c",
                            "safe.directory=" + project.as_posix(),
                            "-C",
                            str(project),
                            "show",
                            "HEAD:" + name,
                        ]
                    )
                )
            else:
                shutil.copyfile(source, target)
        for name in (
            "DURABLE_WORKFLOW.md",
            "GENERATION.md",
            "REVIEW.md",
            "INSTALLATION.md",
            "PICKER.md",
            "PRIVACY.md",
        ):
            shutil.copyfile(tool / name, package / name)
        with zipfile.ZipFile(
            output / f"JobCapture-extension-{VERSION}.zip", "w", zipfile.ZIP_DEFLATED
        ) as extension_zip:
            for source in sorted((tool / "extension").iterdir()):
                if source.suffix in (".js", ".json", ".html", ".css"):
                    target = package / "extension" / source.name
                    target.parent.mkdir(exist_ok=True)
                    shutil.copyfile(source, target)
                    extension_zip.write(source, source.name)
        manifest = {
            "version": VERSION,
            "files": {
                path.relative_to(package).as_posix(): hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
                for path in sorted(package.rglob("*"))
                if path.is_file()
            },
        }
        (package / "release-manifest.json").write_text(
            json.dumps(manifest, indent=2), encoding="utf-8"
        )
        bundle = output / f"JobCapture-developer-{VERSION}.zip"
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(package.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(package).as_posix())
    return bundle


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(build(Path(__file__).resolve().parents[2], args.output.resolve()))  # noqa: T201 -- CLI result path
