"""Private durable workflow state. Document files remain in application folders."""

import json
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path


def now():
    return datetime.now(UTC).isoformat(timespec="seconds")


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise ValueError(
                    "Unsupported workflow database version; restore a backup or upgrade the companion."
                )
            db.executescript("""
                CREATE TABLE IF NOT EXISTS applications (
                    directory TEXT PRIMARY KEY, payload TEXT NOT NULL, updated TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, directory TEXT NOT NULL, phase TEXT NOT NULL,
                    status TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
                    payload TEXT NOT NULL, updated TEXT NOT NULL
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON runs(directory)
                    WHERE status IN ('queued', 'running', 'cancelling');
                CREATE TABLE IF NOT EXISTS events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
                    payload TEXT NOT NULL
                );
                PRAGMA user_version=1;
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def application(self, directory):
        with self.connection() as db:
            row = db.execute(
                "SELECT payload FROM applications WHERE directory=?", (directory,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def save_application(self, application):
        with self.connection() as db:
            db.execute(
                "INSERT INTO applications VALUES (?,?,?) ON CONFLICT(directory) DO UPDATE SET payload=excluded.payload,updated=excluded.updated",
                (application["directory"], json.dumps(application), now()),
            )

    def applications(self):
        with self.connection() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT payload FROM applications ORDER BY updated DESC"
                )
            ]

    def task(self, task_id):
        with self.connection() as db:
            row = db.execute(
                "SELECT payload FROM runs WHERE id=?", (task_id,)
            ).fetchone()
            return json.loads(row[0]) if row else None

    def runs(self, directory):
        with self.connection() as db:
            return [
                json.loads(row[0])
                for row in db.execute(
                    "SELECT payload FROM runs WHERE directory=? ORDER BY updated DESC, rowid DESC",
                    (directory,),
                )
            ]

    def start(self, directory, phase, answers="", request_id=None):
        request_id = request_id or uuid.uuid4().hex
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            old = db.execute(
                "SELECT payload FROM runs WHERE request_id=?", (request_id,)
            ).fetchone()
            if old:
                value = json.loads(old[0])
                if (value["directory"], value["phase"], value["answers"]) != (
                    directory,
                    phase,
                    answers,
                ):
                    raise ValueError(
                        "A request ID cannot be reused with different inputs."
                    )
                return value, False
            active = db.execute(
                "SELECT payload FROM runs WHERE directory=? AND status IN ('queued','running','cancelling')",
                (directory,),
            ).fetchone()
            if active:
                value = json.loads(active[0])
                if (value["phase"], value["answers"]) != (phase, answers):
                    raise ValueError(
                        "This application already has an active run. Wait or cancel it first."
                    )
                return value, False
            if phase in ("generate", "revise"):
                needed = ("analyze",) if phase == "generate" else ("generate", "revise")
                rows = db.execute(
                    "SELECT phase,status FROM runs WHERE directory=?", (directory,)
                ).fetchall()
                if not any(
                    row["phase"] in needed and row["status"] == "complete"
                    for row in rows
                ):
                    raise ValueError(
                        "Review a completed analysis before generation, or a generated draft before revision."
                    )
            task = {
                "id": uuid.uuid4().hex,
                "directory": directory,
                "phase": phase,
                "status": "queued",
                "result": "",
                "error": "",
                "answers": answers,
                "requestId": request_id,
                "created": now(),
            }
            db.execute(
                "INSERT INTO runs VALUES (?,?,?,?,?,?,?)",
                (
                    task["id"],
                    directory,
                    phase,
                    "queued",
                    request_id,
                    json.dumps(task),
                    now(),
                ),
            )
            self._event(db, task)
            return task, True

    @staticmethod
    def _event(db, task):
        db.execute(
            "INSERT INTO events(run_id,payload) VALUES (?,?)",
            (
                task["id"],
                json.dumps(
                    {
                        "status": task["status"],
                        "message": task.get("message", ""),
                        "time": now(),
                    }
                ),
            ),
        )

    def update(self, task_id, **changes):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT payload FROM runs WHERE id=?", (task_id,)
            ).fetchone()
            if not row:
                raise ValueError("Unknown automation task")
            task = json.loads(row[0])
            if task["status"] in ("cancelled", "interrupted"):
                return task
            if task["status"] == "cancelling" and changes.get("status") == "running":
                return task
            if task["status"] == "cancelling" and changes.get("status") == "complete":
                changes["status"] = "cancelled"
            task.update(changes)
            db.execute(
                "UPDATE runs SET status=?,payload=?,updated=? WHERE id=?",
                (task["status"], json.dumps(task), now(), task_id),
            )
            self._event(db, task)
            return task

    def events(self, task_id):
        with self.connection() as db:
            return [
                dict(sequence=row[0], **json.loads(row[1]))
                for row in db.execute(
                    "SELECT sequence,payload FROM events WHERE run_id=? ORDER BY sequence",
                    (task_id,),
                )
            ]

    def recover(self):
        with self.connection() as db:
            ids = [
                row[0]
                for row in db.execute(
                    "SELECT id FROM runs WHERE status IN ('queued','running','cancelling')"
                )
            ]
        for task_id in ids:
            self.update(
                task_id,
                status="interrupted",
                error="The companion stopped during this run. Review existing files and retry explicitly.",
            )
        return len(ids)

    def backup(self, destination: Path):
        with self.connection() as db, closing(sqlite3.connect(destination)) as target:
            db.backup(target)

    def approve(self, directory, version, manifest_hash):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            app = json.loads(
                db.execute(
                    "SELECT payload FROM applications WHERE directory=?", (directory,)
                ).fetchone()[0]
            )
            runs = db.execute(
                "SELECT id,status FROM runs WHERE directory=?", (directory,)
            ).fetchall()
            if app.get("currentVersion") != version or any(
                row["status"] in ("queued", "running", "cancelling") for row in runs
            ):
                raise ValueError(
                    "The application changed during review; refresh before approval."
                )
            if not any(
                row["id"] == version and row["status"] == "complete" for row in runs
            ):
                raise ValueError("Only completed document versions can be approved.")
            app.setdefault("approvals", []).append(
                {"version": version, "time": now(), "manifestHash": manifest_hash}
            )
            app.update(approvedVersion=version, status="approved")
            db.execute(
                "UPDATE applications SET payload=?,updated=? WHERE directory=?",
                (json.dumps(app), now(), directory),
            )
            return app
