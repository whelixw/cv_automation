# RenderCV Job Capture prototype

This Chrome extension captures the current job posting, saves it under
`cv-private/jobs/<company-role>/`, and creates a prompt for the repository's existing
Codex-assisted CV and cover-letter workflow. It does not call an AI API itself yet.

## Start the local service

From the repository root, run:

```powershell
.venv\Scripts\python.exe tools\job-capture\server.py
```

The service listens only on `127.0.0.1:8765` and accepts job descriptions up to 2 MB.

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
4. Click **Capture and prepare prompt**, then **Copy prompt**.
5. Paste the prompt into a Codex task opened at this repository.

The service creates `job_posting.md` and `prompt.md`; it deliberately leaves CV and letter
generation to the review-first workflow described by `AGENTS.md`.
