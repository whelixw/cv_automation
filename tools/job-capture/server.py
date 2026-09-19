"""Local bridge for capturing jobs and running the guarded application workflow."""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[2]
JOBS_ROOT = PROJECT_ROOT / "cv-private" / "jobs"
DEFAULT_CODEX_HOME = PROJECT_ROOT.parents[2] / ".codex"
MAX_BODY_BYTES = 2_000_000
AUTOMATION_TIMEOUT_SECONDS = 20 * 60
TASKS: dict[str, dict[str, object]] = {}
TASKS_LOCK = threading.Lock()
LOGGER = logging.getLogger("job-capture")


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
    suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
    return JOBS_ROOT / f"{base}-{suffix}"


def resolve_job_directory(relative_directory: str) -> Path:
    candidate = (PROJECT_ROOT / relative_directory).resolve()
    jobs_root = JOBS_ROOT.resolve()
    if candidate == jobs_root or jobs_root not in candidate.parents or not candidate.is_dir():
        raise ValueError("Invalid job directory")
    return candidate


def build_prompt(relative_directory: str, instructions: str) -> str:
    extra = instructions or "No additional one-off instructions."
    return f"""Create a tailored CV and cover letter for the job captured in `{relative_directory}`.

Follow `AGENTS.md`. Use `cv-private/master_cv.yaml` as the factual source, plus
`cv-private/constraints.md` and `cv-private/cover_letter_constraints.md`. Never invent facts.

One-off instructions:
{extra}

First summarize the proposed emphasis and ask only material questions. After I answer,
create the job-specific `cv.yaml`, `cover_letter.tex`, and `tailoring_notes.md`, render both
documents into the job's `output/` directory, and wait for my approval.
"""


def analysis_prompt(relative_directory: str) -> str:
    return f"""Analyze the captured application in `{relative_directory}`.

Follow AGENTS.md and read the job posting, master CV, CV constraints, and cover-letter
constraints. Do not edit or create any files. Return a concise proposed emphasis followed by
only genuinely material questions. If there are no material questions, say exactly that.
Never infer or invent facts missing from the master CV. Mention prompt-supplied facts that are
not in the master CV.
"""


def generation_prompt(relative_directory: str, answers: str) -> str:
    return f"""The user has reviewed the proposed tailoring for `{relative_directory}` and now
authorizes generation.

User answers or approval notes:
{answers or 'No additional answers; proceed using only verified facts in the master CV.'}

Follow AGENTS.md. Read the captured posting and prompt, master CV, CV constraints, and
cover-letter constraints. Never invent facts. Create or update `cv.yaml`, `cover_letter.tex`,
and `tailoring_notes.md` inside the job directory. Render the tailored CV and cover letter into
that job's `output/` directory. Validate the outputs and finish with a concise summary listing
the generated files and any remaining caveats. Do not modify the master CV.
"""


def update_task(task_id: str, **changes: object) -> None:
    with TASKS_LOCK:
        TASKS[task_id].update(changes)


def run_automation(task_id: str, phase: str, relative_directory: str, answers: str) -> None:
    update_task(task_id, status="running")
    prompt = analysis_prompt(relative_directory) if phase == "analyze" else generation_prompt(relative_directory, answers)
    codex = shutil.which("codex")
    if not codex:
        update_task(task_id, status="failed", error="The Codex CLI was not found on PATH.")
        return

    env = os.environ.copy()
    env["CODEX_HOME"] = os.environ.get("JOB_CAPTURE_CODEX_HOME", str(DEFAULT_CODEX_HOME))
    command = [
        codex,
        "exec",
        "--cd",
        str(PROJECT_ROOT),
        "--skip-git-repo-check",
        "--ephemeral",
        "--color",
        "never",
    ]
    if phase == "generate":
        command.append("--approve-for-me")
    else:
        command.extend(["--sandbox", "read-only"])
    command.append("-")
    try:
        result = subprocess.run(
            command,
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            cwd=PROJECT_ROOT,
            env=env,
            timeout=AUTOMATION_TIMEOUT_SECONDS,
            check=False,
        )
        output = result.stdout.strip()
        if result.returncode != 0:
            error = result.stderr.strip() or output or f"Codex exited with code {result.returncode}."
            if "attempt to write a readonly database" in error or "Access is denied" in error:
                error = (
                    "Codex cannot write to its local state directory. Restart the Job Capture "
                    "server from a normal Windows terminal under your user account."
                )
            update_task(task_id, status="failed", error=error[-6000:])
            return
        update_task(task_id, status="complete", result=output or "Codex completed without a final message.")
    except subprocess.TimeoutExpired:
        update_task(task_id, status="failed", error="Codex timed out after 20 minutes.")
    except OSError as error:
        update_task(task_id, status="failed", error=f"Could not start Codex: {error}")


class CaptureHandler(BaseHTTPRequestHandler):
    server_version = "JobCapture/0.2"

    def _headers(self, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = self.headers.get("Origin", "")
        if origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

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
        if self.headers.get("Origin", "").startswith("chrome-extension://"):
            self._headers(HTTPStatus.NO_CONTENT)
        else:
            self._headers(HTTPStatus.FORBIDDEN)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            codex = shutil.which("codex")
            self._json({"ok": True, "project": str(PROJECT_ROOT), "codexAvailable": bool(codex)})
        elif parsed.path == "/automation/status":
            task_id = parse_qs(parsed.query).get("id", [""])[0]
            with TASKS_LOCK:
                task = TASKS.get(task_id)
                payload = dict(task) if task else None
            if payload:
                self._json({"ok": True, "task": payload})
            else:
                self._json({"error": "Unknown automation task"}, HTTPStatus.NOT_FOUND)
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self.headers.get("Origin", "").startswith("chrome-extension://"):
            self._json({"error": "Requests are accepted only from the Chrome extension."}, HTTPStatus.FORBIDDEN)
            return
        try:
            path = urlparse(self.path).path
            if path == "/capture":
                self._capture(self._request_json())
            elif path == "/automation/start":
                self._start_automation(self._request_json())
            else:
                self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except OSError as error:
            self._json({"error": f"Local operation failed: {error}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def _capture(self, data: dict) -> None:
        title = markdown_value(str(data.get("title", "")))
        company = markdown_value(str(data.get("company", "")))
        description = markdown_value(str(data.get("description", "")))
        url = markdown_value(str(data.get("url", "")))
        instructions = markdown_value(str(data.get("instructions", "")))
        if not description:
            raise ValueError("No job description was found. Select the posting text and try again.")

        job_dir = unique_job_directory(company or "unknown-company", title or "unknown-role")
        job_dir.mkdir(parents=True)
        relative = job_dir.relative_to(PROJECT_ROOT).as_posix()
        posting = f"""# Job posting

- **Title:** {title or 'Unknown role'}
- **Company:** {company or 'Unknown company'}
- **Source:** {url or 'Unknown'}
- **Captured:** {datetime.now().astimezone().isoformat(timespec='seconds')}

## Description

{description}
"""
        prompt = build_prompt(relative, instructions)
        (job_dir / "job_posting.md").write_text(posting, encoding="utf-8")
        (job_dir / "prompt.md").write_text(prompt, encoding="utf-8")
        self._json({"ok": True, "directory": relative, "prompt": prompt})

    def _start_automation(self, data: dict) -> None:
        phase = str(data.get("phase", ""))
        if phase not in {"analyze", "generate"}:
            raise ValueError("Automation phase must be analyze or generate")
        relative_directory = markdown_value(str(data.get("directory", "")))
        resolve_job_directory(relative_directory)
        answers = markdown_value(str(data.get("answers", "")))
        task_id = uuid.uuid4().hex
        task = {
            "id": task_id,
            "phase": phase,
            "directory": relative_directory,
            "status": "queued",
            "result": "",
            "error": "",
        }
        with TASKS_LOCK:
            TASKS[task_id] = task
        threading.Thread(
            target=run_automation,
            args=(task_id, phase, relative_directory, answers),
            daemon=True,
        ).start()
        self._json({"ok": True, "task": task}, HTTPStatus.ACCEPTED)

    def log_message(self, format: str, *args: object) -> None:
        LOGGER.info("[%s] %s", self.log_date_time_string(), format % args)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CaptureHandler)
    LOGGER.info("Job Capture server listening at http://127.0.0.1:%s", args.port)
    LOGGER.info("Saving applications under %s", JOBS_ROOT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("Stopping server.")


if __name__ == "__main__":
    main()
