# RenderCV Job Capture 0.5 (developer build)

Capture job postings across sites, work with a signed-in agent, and review tailored
RenderCV CVs and LaTeX cover letters. This is an unpublished developer build.

## Start from this repository

```powershell
.venv\Scripts\python.exe tools\job-capture\server.py
```

On Windows, `start-job-capture.bat` uses the local virtual environment and discovers
the desktop app's Codex CLI. Codex must be installed and signed in. The companion
uses the current user's Codex home unless `JOB_CAPTURE_CODEX_HOME` is configured.
Set `JOB_CAPTURE_CODEX_EXE` to override CLI discovery.

For a separate private workspace, pass `--workspace C:\PrivateWorkspace`. Existing
workspace files are preserved. The default port is 8765 and binds only to loopback.

## Connect and capture

1. Load or reload `tools/job-capture/extension` through Chrome's developer extension UI.
2. Open the side panel. Expand **Companion connection**, open local setup, and copy
   its code into the panel. Connect once and use **Check setup** for diagnostics.
3. Open a job posting and click **Read current page**. Grant access for that site.
4. Review automatic extraction or click **Select description on page**. Click sections
   to include, Alt+click to exclude, and press Enter to finish. Arrow keys select
   enclosing/child elements. Esc cancels. Pick role/company with the field selector.
5. Correct the preview or paste text. Confirm role/company/description before capture.
6. Optionally save page selections under **Saved site rules** for matching postings.
   Changed or ambiguous selectors require repair; they do not silently capture the page.
7. Click **Capture and analyze**. Review the proposed emphasis/questions, answer them,
   and explicitly approve generation. Relevant content goes to the signed-in agent.
8. The companion validates sources and builds both PDFs. Review page previews,
   requirements and notes under **Application history and document review**. Compare
   versions, request revisions, and approve the final version before ZIP export.

See [picker instructions](PICKER.md), [durable workflow/pairing](DURABLE_WORKFLOW.md),
[generation/references](GENERATION.md), [review](REVIEW.md), and [data handling](PRIVACY.md).
The manual prompt remains available if automated agent execution is unavailable.

## Private data and outputs

Career facts/preferences live under the ignored `cv-private/` workspace. The master
CV is the factual source. Optional `personal_flair.md` supplies approved snippets,
with at most one relevant snippet across both documents under the shared policy.
Generation uses copied inputs in a temporary workspace and preserves original sources.

Applications contain `job_posting.md`, `prompt.md`, document sources, requirements,
notes and compatibility outputs under `output/cv`, `output/cover-letter`, `output/qa`.
Preserved versions and their hash manifests live under `versions/<run-id>`; approval
is tied to a specific version. Runtime state is stored in the private SQLite database.

Restarting marks orphaned runs interrupted for deliberate retry. Cancel active runs
before stopping the companion. **Stop companion for an update** is available in
connection settings when no runs remain active. Restart from the launcher afterward.

## Development and distribution

Run Python checks from the repository root:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tools/job-capture/tests -v
```

Browser fixture checks use the development-only Playwright dependency in this
folder's package.json; see PICKER.md. The roadmap is in [ROADMAP.md](ROADMAP.md).

See [installation and release gates](INSTALLATION.md) for the developer installer,
release ZIP builder, private backup/restore, and outstanding public-release work.
No store publication or signed installer release has been performed.
