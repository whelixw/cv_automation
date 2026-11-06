"""Isolated source generation, curated references and controlled document builds."""

import hashlib
import importlib.metadata
import json
import os
import re
import shutil
import sys
from pathlib import Path

from agent import run_agent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def contained(root, path):
    resolved = path.resolve()
    if root.resolve() not in resolved.parents or path.is_symlink():
        raise ValueError("Document path leaves its workspace or uses a symbolic link.")
    return resolved


def compiler_script():
    configured = os.environ.get("JOB_CAPTURE_LATEX_SCRIPT")
    if configured:
        path = Path(configured).expanduser()
        return path if path.is_file() else None
    candidates = sorted(
        (Path.home() / ".codex/plugins/cache/openai-bundled/latex").glob(
            "*/scripts/compile_latex.py"
        )
    )
    return candidates[-1] if candidates else None


def reference_index(project):
    entries = []
    paths = [
        "schema.json",
        "docs/user_guide/yaml_input_structure/cv.md",
        "docs/user_guide/yaml_input_structure/design.md",
        "docs/user_guide/cli_reference.md",
        "cv-workspace/templates/cover_letter_template.tex",
    ]
    user_index = project / "cv-private/references/index.json"
    if user_index.exists():
        items = json.loads(user_index.read_bytes())
        if not isinstance(items, list) or len(items) > 32:
            raise ValueError("Reference index must contain at most 32 entries.")
        for item in items:
            path = contained(project, project / item["path"])
            if (project / "cv-private/references").resolve() not in path.parents:
                raise ValueError(
                    "User references must live under cv-private/references."
                )
            paths.append(item["path"])
    for relative in paths:
        path = contained(project, project / relative)
        if not path.is_file():
            continue
        if path.stat().st_size > 5_000_000 or path.suffix.lower() not in (
            ".md",
            ".json",
            ".yaml",
            ".tex",
            ".pdf",
            ".txt",
        ):
            raise ValueError("Unsupported or oversized reference file.")
        entries.append(
            {
                "source": relative,
                "title": path.name,
                "sha256": digest(path),
                "use": "Technical/style reference only; not evidence of personal qualifications.",
            }
        )
    return entries


def prepare(project, relative, workspace, revision=False, version=None):
    protected = {}
    (workspace / "cv-private").mkdir(parents=True)
    for name in (
        "master_cv.yaml",
        "constraints.md",
        "cover_letter_constraints.md",
        "personal_flair.md",
    ):
        source = contained(project, project / "cv-private" / name)
        if not source.exists():
            if name == "personal_flair.md":
                continue
            msg = f"Set up cv-private/{name} before generation."
            raise ValueError(msg)
        target = workspace / "cv-private" / name
        if name == "master_cv.yaml" and re.search(
            r"(?m)^\s*name:\s*Your Name\s*$", source.read_text(encoding="utf-8")
        ):
            raise ValueError(
                "Replace the starter master CV with verified personal information before analysis or generation."
            )
        shutil.copyfile(source, target)
        protected[target] = digest(target)
    if (project / "AGENTS.md").exists():
        shutil.copyfile(project / "AGENTS.md", workspace / "AGENTS.md")
        protected[workspace / "AGENTS.md"] = digest(workspace / "AGENTS.md")
    job = workspace / relative
    job.mkdir(parents=True)
    originals = ("job_posting.md", "prompt.md") + (
        ("cv.yaml", "cover_letter.tex", "tailoring_notes.md", "requirements.json")
        if revision
        else ()
    )
    for name in originals:
        base = project / relative
        if revision and version and name not in ("job_posting.md", "prompt.md"):
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", version):
                raise ValueError("Invalid revision base version")
            base = base / "versions" / version
        source = contained(project, base / name)
        if source.exists():
            shutil.copyfile(source, job / name)
    references = reference_index(project)
    for index, item in enumerate(references):
        target = (
            workspace / "reference-library" / str(index) / Path(item["source"]).name
        )
        target.parent.mkdir(parents=True)
        shutil.copyfile(project / item["source"], target)
        item["path"] = target.relative_to(workspace).as_posix()
        protected[target] = digest(target)
    (workspace / "reference-library").mkdir(exist_ok=True)
    (workspace / "reference-library/index.json").write_text(
        json.dumps(references, indent=2), encoding="utf-8"
    )
    return job, protected, references


def validate_sources(job, protected):
    for path, sha in protected.items():
        if not path.is_file() or digest(path) != sha:
            raise ValueError(
                "The agent changed a protected profile, instruction or reference copy. Nothing was published."
            )
    for name in (
        "cv.yaml",
        "cover_letter.tex",
        "tailoring_notes.md",
        "requirements.json",
    ):
        path = contained(job, job / name)
        if not path.is_file() or not path.read_text(encoding="utf-8").strip():
            msg = f"Generation did not produce {name}."
            raise ValueError(msg)
    requirements = json.loads((job / "requirements.json").read_bytes())
    if re.search(
        r"!TEX\s+root",
        (job / "cover_letter.tex").read_text(encoding="utf-8"),
        re.IGNORECASE,
    ):
        raise ValueError(
            "Cover letters must compile their own source, not a redirected TeX root."
        )
    if not isinstance(requirements, dict) or not isinstance(
        requirements.get("items"), list
    ):
        raise ValueError("requirements.json must contain an items list.")
    for item in requirements["items"]:
        if not isinstance(item, dict) or not all(
            isinstance(item.get(key), str) for key in ("category", "text")
        ):
            raise ValueError("Each application requirement needs a category and text.")
    return requirements


def render(job, cancelled):
    script = compiler_script()
    if script is None:
        raise ValueError(
            "Bundled LaTeX compiler helper is missing. Configure JOB_CAPTURE_LATEX_SCRIPT."
        )
    cv = job / "output/cv"
    letter = job / "output/cover-letter"
    qa = job / "output/qa"
    for directory in (cv, letter, qa):
        contained(job, directory)
        directory.mkdir(parents=True, exist_ok=True)
    commands = [
        [
            sys.executable,
            "-m",
            "rendercv",
            "render",
            str(job / "cv.yaml"),
            "--output-folder",
            str(cv),
            "--pdf-path",
            str(cv / "cv.pdf"),
            "--typst-path",
            str(cv / "cv.typ"),
            "--markdown-path",
            str(cv / "cv.md"),
            "--dont-generate-html",
            "--dont-generate-png",
        ],
        [
            sys.executable,
            str(script),
            str(job / "cover_letter.tex"),
            "--compiler",
            "tectonic",
            "--output-directory",
            str(letter),
            "--json",
        ],
    ]
    environment = dict(
        os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8", NO_COLOR="1", TERM="dumb"
    )
    for index, command in enumerate(commands):
        result = run_agent(
            command, "", cwd=job, env=environment, cancelled=cancelled, timeout=300
        )
        (qa / f"build-{index}.log").write_text(
            result.stdout + "\n" + result.stderr, encoding="utf-8"
        )
        if result.returncode:
            msg = f"{'CV' if index == 0 else 'Cover-letter'} rendering failed. Review the private build log."
            raise ValueError(msg)
    pymupdf = importlib.import_module("pymupdf")

    for kind, pdf in (
        ("cv", cv / "cv.pdf"),
        ("cover-letter", letter / "cover_letter.pdf"),
    ):
        contained(job, pdf)
        if not pdf.is_file():
            msg = f"The {kind} PDF was not produced."
            raise ValueError(msg)
        with pymupdf.open(pdf) as document:
            text = "\n".join(page.get_text() for page in document)
            if not document.page_count or not text.strip():
                msg = f"The {kind} PDF has no readable text."
                raise ValueError(msg)
            (qa / f"{kind}.txt").write_text(text, encoding="utf-8")
            for number, page in enumerate(document):
                page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(
                    qa / f"{kind}-{number + 1}.png"
                )


def publish(job, destination, run_id, references, requirements):
    version = destination / "versions" / run_id
    contained(destination, version)
    if version.exists():
        raise ValueError("This document version already exists.")
    version.parent.mkdir(exist_ok=True)
    temporary = version.with_name(".publishing-" + run_id)
    temporary.mkdir()
    names = ["cv.yaml", "cover_letter.tex", "tailoring_notes.md", "requirements.json"]
    names += [
        path.relative_to(job).as_posix()
        for path in (job / "output").rglob("*")
        if path.is_file()
    ]
    artifacts = []
    for name in names:
        source = contained(job, job / name)
        target = temporary / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        artifacts.append(
            {"path": name, "sha256": digest(target), "size": target.stat().st_size}
        )
    manifest = {
        "schema_version": 1,
        "id": run_id,
        "rendercv_version": importlib.metadata.version("rendercv"),
        "latex_compiler": "tectonic",
        "references": references,
        "requirements": requirements,
        "artifacts": artifacts,
    }
    (temporary / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    temporary.rename(version)
    # Compatibility copies are convenient; the immutable version is the review source.
    for artifact in artifacts:
        target = destination / artifact["path"]
        contained(destination, target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(version / artifact["path"], target)
    return manifest
