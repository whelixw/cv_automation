"""Local HTTP bridge for the Job Application Capture Chrome extension."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
JOBS_ROOT = PROJECT_ROOT / "cv-private" / "jobs"
MAX_BODY_BYTES = 2_000_000


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


class CaptureHandler(BaseHTTPRequestHandler):
    server_version = "JobCapture/0.1"

    def _headers(self, status: HTTPStatus = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        self._headers(status)
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._headers(HTTPStatus.NO_CONTENT)

    def do_GET(self) -> None:  # noqa: N802
        if urlparse(self.path).path == "/health":
            self._json({"ok": True, "project": str(PROJECT_ROOT)})
        else:
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/capture":
            self._json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_BODY_BYTES:
                raise ValueError("Request is empty or too large")
            data = json.loads(self.rfile.read(length))
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
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self._json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except OSError as error:
            self._json({"error": f"Could not save the posting: {error}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    JOBS_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), CaptureHandler)
    print(f"Job Capture server listening at http://127.0.0.1:{args.port}")
    print(f"Saving applications under {JOBS_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")


if __name__ == "__main__":
    main()
