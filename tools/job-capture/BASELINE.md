# Prototype baseline

Recorded 20 October 2026. This is a reproducible check procedure, not a claim that
live browser capture, agent execution or PDF generation was run during phase 0.

## Automated boundary checks

From the repository root, using its Python environment:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tools/job-capture/tests -v
```

The suite checks the existing HTTP capture/start/status flow with a fake agent,
temporary job storage, blocked web origins, path containment and failure reporting.
It also validates proposed contracts. No real application or private data is used.

## Manual end-to-end release baseline

Use a disposable private workspace with a fictional factual profile, constraints,
and approved template. Do not substitute a real person's data into public fixtures.
Use the existing README startup and unpacked-extension instructions.

1. Capture a LinkedIn posting, a page with JobPosting metadata, and selected text
   on an unfamiliar domain. Record browser/extension/agent/renderer versions.
2. Compare role/company and complete description against the visible posting;
   confirm headings, links, requirements and lists survive without sidebar noise.
3. Close/reopen the panel and check the URL-specific draft. Navigate to a different
   posting and use Read current page; confirm the correct job is captured.
4. Analyze. Confirm proposed emphasis and material questions appear without
   generating documents. Answer and explicitly approve generation.
5. Check `cv.yaml`, `cover_letter.tex`, `tailoring_notes.md`, and both PDFs in the
   documented output folders. Inspect every page and extracted text. Confirm no
   invented facts, all extra submission requirements are surfaced, and optional
   flair is omitted or recorded under the current policy.
6. Confirm master CV and reference files are unchanged. Reject or revise the draft
   if needed; do not confuse successful generation with final approval.
7. Stop the companion and confirm the UI offers an actionable error/manual fallback.

Known limitations: task state is in memory and does not survive service restart;
PDF validation depends on agent behavior; there is no integrated revision history,
picker, recipe library, paired authentication or installable distribution yet.

## Baseline evidence

Automated results belong in commit/review notes. For manual runs, save a private
record of versions, capture sources, outcomes and artifact paths. Never commit raw
postings, personal profiles, credentials or agent transcripts as baseline evidence.
