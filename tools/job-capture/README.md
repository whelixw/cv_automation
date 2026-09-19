# RenderCV Job Capture prototype

This Chrome extension captures the current job posting, saves it under
`cv-private/jobs/<company-role>/`, and uses the locally installed Codex CLI to run the
repository's CV and cover-letter workflow. It does not require an API key.

## Start the local service

From the repository root, run:

```powershell
.venv\Scripts\python.exe tools\job-capture\server.py
```

The service listens only on `127.0.0.1:8765`, accepts job descriptions up to 2 MB, and accepts
state-changing browser requests only from a Chrome extension origin. Codex must be installed and
logged in. Set `JOB_CAPTURE_CODEX_HOME` before starting the server only if your Codex data is not
stored in the default `C:\Users\<you>\.codex` directory.

## Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** (or click the extension's reload button after an update).
4. Select `tools/job-capture/extension`.

## Use it

1. Open a job posting. LinkedIn is supported, and pages with Schema.org `JobPosting`
   metadata should also work.
2. Optionally select the job description on the page. Selected text takes precedence and
   is the most reliable fallback for unsupported sites.
3. Click the extension. It opens in Chrome's side panel, so it remains available while you
   navigate. Check the automatically detected role and company, then add optional instructions.
   Your draft is saved per job URL and restored if the panel or browser is closed.
   If you navigate to another posting while the panel is open, click **Read current page**.
   LinkedIn access is included. On another job site, Chrome asks for access to that site the
   first time you click **Read current page**; the extension does not request blanket access.
4. Click **Capture and analyze**. Codex returns a proposed emphasis and any material questions.
5. Review the analysis, answer its questions if needed, then click
   **Approve, generate, and render**.
6. Inspect the generated files in the displayed `cv-private/jobs/<company-role>/` folder.

The manual prompt remains available as a fallback. Analysis runs with a read-only sandbox;
generation uses a workspace-write sandbox and still follows the review-first workflow in
`AGENTS.md`.
