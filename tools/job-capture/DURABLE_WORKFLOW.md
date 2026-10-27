# Durable companion workflow

Restart the companion after upgrading. Before using capture or automation, expand
**Companion connection** in the extension, open its local setup link, and copy the
connection code into the panel. Connect once. The code is stored in extension local
storage and must not be included in screenshots, job postings, recipes, or logs.

The companion binds only to 127.0.0.1. Private API requests require the connection
code, the exact paired extension origin and the expected Host. New private APIs
must use the same check. Public health exposes availability only. Setup is a direct
local browser navigation with no cross-origin read support and no framing.

Application and run state live in `cv-private/.job-capture/workflow.sqlite3`.
The pairing secret lives beside it in `connection.json`. Both inherit the private
workspace's filesystem permissions. To deliberately pair a different extension,
stop the service and rename `connection.json` to a private backup, restart, and
connect with the new code. Existing application documents remain untouched.

Each run has a persistent ID, input answers and ordered status events. Duplicate
active requests reuse a run; requests with different inputs cannot run concurrently
for the same application. Request IDs are bound to their original inputs.
Generation requires a completed analysis. A companion restart marks orphaned runs
interrupted; it never starts generation automatically. Existing pre-database folders
are left untouched rather than implicitly imported or approved.

Use **Cancel current run** to request cancellation. The adapter checks cancellation
while waiting and stops the launched process tree on Windows. Completed/failed run
records are retained. Cancellation does not claim to roll back files already written;
document version isolation is implemented in the subsequent rendering/review step.

The database uses schema version 1. Unknown newer versions are rejected. The Store
backup operation uses SQLite's backup API and closes both connections explicitly.
Back up the private documents alongside the database; database backup alone does not
include PDFs. Pairing secrets should only be copied into trusted private backups.
