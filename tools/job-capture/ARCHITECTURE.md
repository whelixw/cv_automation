# Phase 0 architecture decisions

Accepted for implementation: 20 October 2026. These decisions guide subsequent phases;
they do not imply the prototype already implements them.

## Boundaries and first supported configuration

Support Windows, Chrome, the existing installed Codex CLI, RenderCV YAML for CVs,
and LaTeX for cover letters. Keep the Python companion. The extension owns page
selection and review UI; the companion owns private storage, orchestration and
rendering. Agent adapters produce sources and structured events. Render adapters
validate and build artifacts independently of the agent's final response.

AGENTS.md remains authoritative for application policy. Facts come from the master
CV and explicit user answers; references describe formatting and tool usage.
Preserve analysis approval and final document approval as separate decisions.

## ADR 1: authenticated loopback transport

Evolve the existing HTTP bridge rather than implementing native messaging now.
This preserves the current extension/service boundary and permits independent
diagnostics. Native messaging offers browser-managed process launch, but adds a
separate host-registration and packaging path before the picker is proven.

Before installable release, pair the extension with a per-install secret through
an explicit local setup flow. Require authentication and an exact paired extension
origin on private reads and writes, validate Host, and bind only to loopback.
Store the secret in user-scoped companion configuration and extension local storage;
never put it in URLs, recipes, captured documents or logs. Pairing must not accept
arbitrary web origins. The current prefix-only origin check is not sufficient.
Keep the present protocol unchanged during baseline work. Design/test pairing and
token rotation before enabling new private artifact endpoints.

## ADR 2: SQLite for workflow state, files for documents

Use Python's bundled SQLite support for applications, runs, ordered events,
idempotency keys and approval/version references. Documents remain in job folders.
The database is authoritative for workflow status; artifact manifests identify files
and their hashes, rather than duplicating editable source content in the database.

Introduce schema migrations and backup before first use. Existing folders remain
valid: explicit import assigns IDs and records existing sources as unreviewed;
never infer approval or rewrite files during discovery. Use a single companion
writer, transactions for state changes, and atomic file replacement for manifests.
On startup, mark orphaned active runs interrupted and offer retry, never auto-run.
File/database operations are not jointly atomic: write to run-specific staging,
verify artifacts, then publish their manifest transactionally; recover or quarantine
unpublished files after a crash. Do not overwrite approved versions.

## ADR 3: versioned contracts before runtime migration

`contracts.py` defines proposed version-1 boundary objects. These are intentionally
separate from the legacy `/capture` and `/automation/*` payloads. Keep legacy
clients working until an explicit translation layer is tested. A contract version
is not the extension version or database migration version.

Capture carries provenance and user-confirmed Markdown; recipe rules describe
selection, not executable code. Application and run status are separate. Events
are ordered within a run. Artifacts use workspace-relative paths and hashes.
Unknown fields/versions fail validation rather than silently changing meaning.

## ADR 4: controlled renderers and curated references

Use the installed RenderCV 2.8 baseline initially; record actual versions in run
manifests. Keep its YAML/schema/Typst pipeline. Compile cover-letter LaTeX with
the bundled compiler explicitly via `compile_latex.py --compiler tectonic`.
Do not substitute local TeX installations. Renderer availability is diagnosed
before generation; packaging a distributable runtime is phase 5.

Begin with a local reference index: schema, selected RenderCV documentation,
approved CV example, cover-letter template, and LaTeX guidance. Record hashes
and applicable versions. No vector database or automated web reference refresh.
Upgrades need a schema/template/build compatibility check and an explicit reference
revision. References and examples never confer personal qualifications.

## Baseline and rollout

Run `python -m unittest discover -s tools/job-capture/tests -v` from the repository
root. Tests use temporary folders and fake agent responses; no login, private CV,
network, or real generation is involved. Sanitized fixtures represent different
capture sources. These tests characterize the companion boundary, not browser DOM
extraction or real rendering. See `BASELINE.md` for the manual integration check.

Subsequent implementation: picker -> recipes -> durable orchestration/reference
library -> document review -> distribution. Introduce adapters one boundary at a
time. Do not switch persistence or transport in the same change as the picker.
Future prompt refactoring must preserve AGENTS.md rules and the baseline tests;
centralize duplicated policy then, without committing unrelated current changes.
