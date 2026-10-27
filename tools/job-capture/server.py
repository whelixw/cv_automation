"""Local bridge for capturing jobs and running the guarded application workflow."""

from __future__ import annotations

import argparse
import json
import logging
import mimetypes
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from contextlib import nullcontext
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import documents
from agent import AgentStopped, run_agent
from review import Review
from security import Pairing
from store import Store
from workflow import analysis_prompt, build_prompt, generation_prompt

PROJECT_ROOT = Path(__file__).resolve().parents[2]
JOBS_ROOT = PROJECT_ROOT / "cv-private" / "jobs"
DEFAULT_CODEX_HOME = PROJECT_ROOT.parents[2] / ".codex"
MAX_BODY_BYTES = 2_000_000
AUTOMATION_TIMEOUT_SECONDS = 20 * 60
PAIRING = None
LOGGER = logging.getLogger("job-capture")


def store():
    return Store(PROJECT_ROOT / "cv-private" / ".job-capture" / "workflow.sqlite3")


def slugify(value: str, fallback: str = "job") -> str:
    value = value.casefold().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")[:80] or fallback


def markdown_value(value: str) -> str:
    return value.strip().replace("\x00", "")


def unique_job_directory(company: str, title: str) -> Path:
    base = slugify(f"{company}-{title}")
    candidate = JOBS_ROOT / base
    if not candidate.exists():
        return candidate
    suffix = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    return JOBS_ROOT / f"{base}-{suffix}"


def resolve_job_directory(relative_directory: str) -> Path:
    candidate = (PROJECT_ROOT / relative_directory).resolve()
    jobs_root = JOBS_ROOT.resolve()
    if (
        candidate == jobs_root
        or jobs_root not in candidate.parents
        or not candidate.is_dir()
    ):
        raise ValueError("Invalid job directory")
    return candidate


def update_task(task_id: str, **changes: object) -> None:
    store().update(task_id, **changes)


def resolve_codex_executable() -> str | None:
    configured = os.environ.get("JOB_CAPTURE_CODEX_EXE", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file():
            return str(candidate)
        LOGGER.error("JOB_CAPTURE_CODEX_EXE does not point to a file: %s", candidate)
        return None
    return shutil.which("codex")


def run_automation(
    task_id: str, phase: str, relative_directory: str, answers: str
) -> None:
    def cancelled():
        return store().task(task_id)["status"] in ("cancelling", "cancelled")

    if cancelled():
        update_task(task_id, status="cancelled")
        return
    update_task(
        task_id,
        status="running",
        message="Analyzing"
        if phase == "analyze"
        else "Preparing isolated generation workspace",
    )
    codex = resolve_codex_executable()
    if not codex:
        update_task(
            task_id,
            status="failed",
            error="The Codex CLI was not found. Configure JOB_CAPTURE_CODEX_EXE or restart the companion from its launcher.",
        )
        return
    generating = phase in ("generate", "revise")
    job = None
    destination = None
    try:
        context = (
            tempfile.TemporaryDirectory(prefix="job-capture-")
            if generating
            else nullcontext(str(PROJECT_ROOT))
        )
        with context as work:
            workspace = Path(work)
            prompt = (
                analysis_prompt(relative_directory)
                if not generating
                else generation_prompt(relative_directory, answers)
            )
            if generating:
                destination = resolve_job_directory(relative_directory)
                job, protected, references = documents.prepare(
                    PROJECT_ROOT,
                    relative_directory,
                    workspace,
                    revision=phase == "revise",
                )
                prompt += "\nRead reference-library/index.json and the relevant copied references. Generate sources only; do not render or run compilers. The companion will validate and render them. Create requirements.json with an items list of objects containing category and text. Include all application requirements; use an empty list only if the posting has none. Record uncertainties in tailoring_notes.md.\n"
                if phase == "revise":
                    prompt += "Revise the existing sources according to the user notes while preserving verified facts.\n"
            command = [
                codex,
                "exec",
                "-c",
                'windows.sandbox="unelevated"',
                "-c",
                "mcp_servers.node_repl.enabled=false",
                "--cd",
                str(workspace),
                "--skip-git-repo-check",
                "--ephemeral",
                "--color",
                "never",
                "--sandbox",
                "workspace-write" if generating else "read-only",
                "-",
            ]
            env = os.environ.copy()
            env["CODEX_HOME"] = os.environ.get(
                "JOB_CAPTURE_CODEX_HOME", str(DEFAULT_CODEX_HOME)
            )
            result = run_agent(
                command,
                prompt,
                cwd=workspace,
                env=env,
                cancelled=cancelled,
                timeout=AUTOMATION_TIMEOUT_SECONDS,
            )
            if result.returncode:
                raise ValueError(
                    (
                        result.stderr.strip()
                        or result.stdout.strip()
                        or "Agent execution failed."
                    )[-6000:]
                )
            if cancelled():
                raise AgentStopped("Run cancelled; no version was published.")
            if generating:
                requirements = documents.validate_sources(job, protected)
                update_task(task_id, message="Rendering and checking PDFs")
                try:
                    documents.render(job, cancelled)
                except (ValueError, OSError, AgentStopped, subprocess.TimeoutExpired):
                    logs = destination / "runs" / task_id
                    logs.mkdir(parents=True, exist_ok=True)
                    for path in (job / "output/qa").glob("*.log"):
                        shutil.copyfile(
                            documents.contained(job, path), logs / path.name
                        )
                    raise
                if cancelled():
                    raise AgentStopped("Run cancelled; no version was published.")
                manifest = documents.publish(
                    job, destination, task_id, references, requirements
                )
                application = store().application(relative_directory)
                if application is None:
                    application = {
                        "directory": relative_directory,
                        "title": destination.name,
                        "company": "",
                        "versions": [],
                    }
                application.setdefault("versions", []).append(
                    {"id": task_id, "created": datetime.now().astimezone().isoformat()}
                )
                application.update(currentVersion=task_id, status="draft_ready")
                store().save_application(application)
                update_task(task_id, version=manifest["id"])
            update_task(
                task_id,
                status="complete",
                result=result.stdout.strip()
                or "Run complete. Review the generated documents before approval.",
            )
    except AgentStopped as error:
        update_task(task_id, status="cancelled", error=str(error))
    except subprocess.TimeoutExpired:
        update_task(
            task_id,
            status="failed",
            error="The agent or document renderer timed out. Previous versions are preserved.",
        )
    except (OSError, ValueError, RuntimeError, ImportError) as error:
        update_task(task_id, status="failed", error=str(error))


class CaptureHandler(BaseHTTPRequestHandler):
    server_version = "JobCapture/0.2"

    def _headers(self, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        origin = self.headers.get("Origin", "")
        if Pairing.valid_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Job-Capture-Token, X-Job-Capture-Extension",
        )
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _authorized(self):
        if PAIRING is None:
            return False
        host = self.headers.get("Host", "")
        return host == f"127.0.0.1:{self.server.server_port}" and PAIRING.authorize(
            self.headers.get("Origin", ""),
            self.headers.get("X-Job-Capture-Token", ""),
            self.headers.get("X-Job-Capture-Extension", ""),
        )

    def _json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        self._headers(status)
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _request_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request is empty or too large")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("Expected a JSON object")
        return value

    def do_OPTIONS(self) -> None:
        if Pairing.valid_origin(self.headers.get("Origin", "")):
            self._headers(HTTPStatus.NO_CONTENT)
        else:
            self._headers(HTTPStatus.FORBIDDEN)

    def do_GET(self) -> None:
        try:
            self._get()
        except (ValueError, OSError, TypeError, KeyError) as error:
            self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

    def _binary(self, data, mime, name):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'inline; filename="{name}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", ""))
        self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(data)

    def _get(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/setup" and PAIRING is not None:
            if (
                self.headers.get("Origin")
                or self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}"
            ):
                self._json(
                    {"error": "Open setup directly in a local browser tab."},
                    HTTPStatus.FORBIDDEN,
                )
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
            self.end_headers()
            self.wfile.write(
                (
                    "Job Capture: copy this connection code into the extension's Companion connection section.\n\n"
                    + PAIRING.config["token"]
                ).encode()
            )
            return
        if parsed.path != "/health" and not self._authorized():
            self._json(
                {"error": "Connect the extension to the local companion first."},
                HTTPStatus.UNAUTHORIZED,
            )
            return
        if parsed.path == "/health":
            codex = resolve_codex_executable()
            self._json({"ok": True, "codexAvailable": bool(codex)})
        elif parsed.path == "/applications":
            self._json({"ok": True, "applications": store().applications()})
        elif parsed.path in ("/application", "/artifact", "/compare", "/export"):
            query = parse_qs(parsed.query)
            directory = query.get("directory", [""])[0]
            version = query.get("version", [None])[0]
            review = Review(PROJECT_ROOT, store())
            if parsed.path == "/application":
                self._json({"ok": True, **review.details(directory, version)})
            elif parsed.path == "/artifact":
                path = review.artifact(directory, version, query.get("path", [""])[0])
                if path.suffix.lower() not in (
                    ".pdf",
                    ".png",
                    ".txt",
                    ".md",
                    ".yaml",
                    ".tex",
                    ".json",
                    ".log",
                ):
                    raise ValueError("Unsupported preview format")
                self._binary(
                    path.read_bytes(),
                    mimetypes.guess_type(path.name)[0] or "text/plain",
                    path.name,
                )
            elif parsed.path == "/export":
                self._binary(
                    review.export(directory, version),
                    "application/zip",
                    "application.zip",
                )
            else:
                self._json(
                    {
                        "ok": True,
                        "diff": review.compare(
                            directory,
                            query.get("left", [""])[0],
                            query.get("right", [""])[0],
                        ),
                    }
                )
        elif parsed.path == "/automation/status":
            task_id = parse_qs(parsed.query).get("id", [""])[0]
            payload = store().task(task_id)
            if payload:
                self._json(
                    {"ok": True, "task": payload, "events": store().events(task_id)}
                )
            else:
                self._json({"error": "Unknown automation task"}, HTTPStatus.NOT_FOUND)
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self.headers.get("Origin", "").startswith("chrome-extension://"):
            self._json(
                {"error": "Requests are accepted only from the Chrome extension."},
                HTTPStatus.FORBIDDEN,
            )
            return
        if urlparse(self.path).path == "/pair" and PAIRING is not None:
            if self.headers.get(
                "Host"
            ) == f"127.0.0.1:{self.server.server_port}" and PAIRING.pair(
                self.headers.get("Origin", ""),
                self.headers.get("X-Job-Capture-Token", ""),
            ):
                self._json({"ok": True})
            else:
                self._json(
                    {
                        "error": "Invalid connection code, or companion is paired with another extension."
                    },
                    HTTPStatus.FORBIDDEN,
                )
            return
        if not self._authorized():
            self._json(
                {"error": "Connect the extension to the local companion first."},
                HTTPStatus.UNAUTHORIZED,
            )
            return
        try:
            path = urlparse(self.path).path
            if path == "/capture":
                self._capture(self._request_json())
            elif path == "/automation/start":
                self._start_automation(self._request_json())
            elif path == "/automation/cancel":
                task = store().task(str(self._request_json().get("id", "")))
                if not task:
                    raise ValueError("Unknown automation task")
                if task["status"] in ("queued", "running"):
                    task = store().update(task["id"], status="cancelling")
                self._json({"ok": True, "task": task})
            elif path == "/application/approve":
                data = self._request_json()
                app = Review(PROJECT_ROOT, store()).approve(
                    str(data.get("directory", "")),
                    data.get("version"),
                    data.get("reviewed"),
                )
                self._json({"ok": True, "application": app})
            elif path == "/application/status":
                data = self._request_json()
                directory = str(data.get("directory", ""))
                Review(PROJECT_ROOT, store()).job(directory)
                status = data.get("status")
                if status not in (
                    "not_submitted",
                    "submitted",
                    "interview",
                    "offer",
                    "rejected",
                    "withdrawn",
                ):
                    raise ValueError("Unsupported application tracking status")
                app = store().application(directory)
                app["trackingStatus"] = status
                store().save_application(app)
                self._json({"ok": True, "application": app})
            else:
                self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except OSError as error:
            self._json(
                {"error": f"Local operation failed: {error}"},
                HTTPStatus.INTERNAL_SERVER_ERROR,
            )

    def _capture(self, data: dict) -> None:
        title = markdown_value(str(data.get("title", "")))
        company = markdown_value(str(data.get("company", "")))
        description = markdown_value(str(data.get("description", "")))
        url = markdown_value(str(data.get("url", "")))
        instructions = markdown_value(str(data.get("instructions", "")))
        if not description:
            raise ValueError(
                "No job description was found. Select the posting text and try again."
            )

        job_dir = unique_job_directory(
            company or "unknown-company", title or "unknown-role"
        )
        job_dir.mkdir(parents=True)
        relative = job_dir.relative_to(PROJECT_ROOT).as_posix()
        posting = f"""# Job posting

- **Title:** {title or "Unknown role"}
- **Company:** {company or "Unknown company"}
- **Source:** {url or "Unknown"}
- **Captured:** {datetime.now().astimezone().isoformat(timespec="seconds")}

## Description

{description}
"""
        prompt = build_prompt(relative, instructions)
        (job_dir / "job_posting.md").write_text(posting, encoding="utf-8")
        (job_dir / "prompt.md").write_text(prompt, encoding="utf-8")
        store().save_application(
            {
                "directory": relative,
                "title": title,
                "company": company,
                "url": url,
                "status": "captured",
                "created": datetime.now().astimezone().isoformat(),
                "versions": [],
            }
        )
        self._json({"ok": True, "directory": relative, "prompt": prompt})

    def _start_automation(self, data: dict) -> None:
        phase = str(data.get("phase", ""))
        if phase not in {"analyze", "generate", "revise"}:
            raise ValueError("Automation phase must be analyze or generate")
        relative_directory = markdown_value(str(data.get("directory", "")))
        resolve_job_directory(relative_directory)
        answers = markdown_value(str(data.get("answers", "")))
        task, created = store().start(
            relative_directory, phase, answers, data.get("requestId")
        )
        if created:
            threading.Thread(
                target=run_automation,
                args=(task["id"], phase, relative_directory, answers),
                daemon=True,
            ).start()
        self._json({"ok": True, "task": task}, HTTPStatus.ACCEPTED)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.info("[%s] %s", self.log_date_time_string(), format % args)


def main() -> None:
    global PAIRING  # noqa: PLW0603 -- one paired companion configuration per process
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    PAIRING = Pairing(PROJECT_ROOT / "cv-private" / ".job-capture" / "connection.json")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CaptureHandler)
    recovered = store().recover()
    if recovered:
        LOGGER.info(
            "Recovered %s interrupted runs; retry explicitly after review.", recovered
        )
    LOGGER.info("Job Capture server listening at http://127.0.0.1:%s", args.port)
    LOGGER.info("Saving applications under %s", JOBS_ROOT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping server.")


if __name__ == "__main__":
    main()
