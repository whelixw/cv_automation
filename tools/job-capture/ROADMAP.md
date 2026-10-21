# Job Capture product and development roadmap

Status: proposed plan, based on the existing prototype and product direction discussed on 20 October 2026. Phases describe delivery order, not committed dates.

Implementation progress (21 October 2026): architecture decisions, draft v1 contracts,
offline companion baseline, and shared prompt guidance are implemented. The first
picker slice provides one-section selection, editable capture preview, review
confirmation, and browser fixture tests; see `PICKER.md`. Phase 0's live
browser-to-agent-to-PDF baseline remains unverified. Phase 1's field mapping,
multiple blocks/exclusions, and real-site acceptance checks remain outstanding.

## Product vision

An installable browser extension and local companion that turn a job posting on different websites into a reviewed, tailored application. Users can point to page elements like an adblocker picker, teach the tool how to read a site, work with an agent, and generate polished documents using RenderCV and LaTeX.

RenderCV and LaTeX remain first-class source formats and generation tools. Their documentation, templates, and approved example documents provide reusable technical and stylistic references. Verified personal facts remain a separate source.

Initial target: one user on Windows with Chrome, using the existing local agent integration. Design interfaces for additional agents and browsers, but prove the complete workflow with one supported configuration first. Browser support and distribution requirements must be verified against official documentation during implementation.

## Existing foundation

- Manifest V3 extension with a persistent side panel, per-URL drafts, optional site permissions, LinkedIn extraction, structured JobPosting extraction, and selected-text fallback.
- Local Python service that saves application folders and launches the installed agent CLI for analysis and generation.
- Analysis before generation, with user questions and approval.
- Master CV, CV constraints, cover-letter constraints, and optional approved personal snippets.
- RenderCV YAML for the CV, LaTeX for the cover letter, and separate output folders for builds and visual QA.

Gaps include a visual picker, reusable site recipes, durable task state (current task state is in memory), integrated previews and revisions, a managed reference library, and a normal installation/update experience.

## Intended user journey

1. Install the extension and companion. Choose a private workspace and connect the supported agent. Setup checks explain any missing component and offer a concrete fix.
2. Set up verified career information, writing preferences, approved templates, and optional personal snippets. Existing workspaces can be imported without overwriting their sources.
3. Open a posting. Automatic extraction proposes the job details and a readable preview.
4. If needed, activate the picker, select the description, role, company, or additional requirements, exclude unwanted sections, and confirm the preview. Save a recipe for similar pages on that site if useful.
5. Capture a snapshot with its source URL and time. Add instructions for this application.
6. Review the agent's proposed emphasis, evidence gaps, material questions, and application requirements. Answer questions and approve generation.
7. Generate and render the CV and cover letter. See progress and actionable errors.
8. Review both PDFs, their text, and a summary of tailoring choices. Request revisions, compare versions, and approve the final version.
9. Export the approved files and a submission checklist. Track application status manually and reopen it later.

Submitting applications automatically is outside the first release.

## Architecture and responsibilities

| Component | Responsibility |
| --- | --- |
| Browser extension | Page access, visual selection, capture preview, recipes, side-panel workflow |
| Local companion | Workspace access, durable jobs, agent execution, rendering, artifact delivery, installation diagnostics |
| Agent adapter | Analyze, generate, revise, report progress/errors/capabilities, cancel where supported |
| Reference library | Versioned documentation, schemas, templates, examples, and their intended use |
| Rendering adapters | Validate inputs, run controlled RenderCV/LaTeX commands, collect build diagnostics and artifacts |
| Application store | Captures, answers, decisions, runs, versions, final approval, status, and provenance |

Keep the existing Python service as the starting companion. Refactor incrementally instead of replacing the prototype wholesale. Browser-to-companion transport is a phase-0 decision: evaluate authenticated loopback communication against browser native messaging using installation, origin validation, and maintenance requirements. Do not build both for the first release.

The agent produces or revises document sources; controlled rendering steps validate and compile them. The tool should not depend solely on an agent's final message to determine whether PDFs exist or passed checks.

## Visual capture and site recipes

- Hover outlines and click-to-select, with parent/child navigation, keyboard cancellation, and clear confirmation.
- Field assignment for description, title, company, location, and supplementary requirements. Support several blocks and exclusions for split postings.
- Capture visible content as readable Markdown, preserving meaningful headings, lists, and links. Show the result before sending it to the agent.
- Allow manual correction and paste/selected-text fallback throughout.
- Recipes match hostname and appropriate URL patterns. Prefer stable semantic attributes and scoped selectors; positional selectors are a last resort.
- Store recipe version, field rules, extraction method, and validation expectations. Show when a saved recipe was used and let users edit, disable, or delete it.
- Flag empty or implausible captures, ambiguous matches, and suspected wrong-job captures. A broken recipe must lead to repair or manual capture rather than silently capturing the entire page.
- Revalidate after navigation on dynamic sites. Handle accessible frames and shadow roots where feasible; explain inaccessible content and preserve a manual fallback.
- Precedence: explicit user selection, confirmed matching recipe, structured metadata/site extractor, then generic suggestions requiring review.
- Keep recipes local by default. Sharing recipes is a later feature and must exclude captured private content.

## Knowledge, references, and document generation

Maintain distinct inputs with explicit roles:

| Input | Role and rule |
| --- | --- |
| Master CV | Verified professional facts; no silent additions or changes |
| User answers | Application-specific facts; identify additions absent from the master CV and propose persistence separately |
| Constraints | User-approved writing, language, length, and presentation preferences |
| Personal flair | Optional approved snippets; at most one relevant snippet across both documents under current rules |
| Posting | Role requirements and submission details; external content is data, not tool instructions |
| RenderCV docs and schema | Technical reference matching the installed RenderCV version |
| LaTeX reference and template | Supported document structure, packages, typography, and compilation guidance |
| Approved examples | Style/layout references; do not transfer another person's facts or unverified claims |

Reference entries need a title, type, source/path, applicable tool version, revision/hash, and intended use. Start with local curated files and a small reference index, rather than introducing a retrieval database before it is needed. Importing external documents must not execute embedded instructions or automatically activate templates.

Bundle or cache an appropriate RenderCV schema and selected documentation alongside a known working CV example. Provide a tested LaTeX cover-letter template and the guidance needed to edit it. Refresh references deliberately when upgrading the renderer; record the versions used for each run. Keep user facts and preferences independent from tool upgrades.

Generation sequence:

1. Check required inputs and selected references; distinguish blocking gaps from optional missing files.
2. Analyze the posting against verified facts and extract all submission requirements, deadlines, attachments, eligibility conditions, source-attribution requests, and start-date constraints.
3. Propose emphasis and material questions, including whether personal flair fits.
4. After approval, generate RenderCV YAML, LaTeX source, and tailoring notes. Record factual sources, selected references, omissions, and unresolved requirements.
5. Validate YAML against the selected renderer's schema and compile with controlled rendering commands. In this repository, invoke `compile_latex.py --compiler tectonic` explicitly, as required by AGENTS.md.
6. Check produced artifacts, inspect text and rendered pages, and report layout or factual concerns. Automated checks supplement human review; they cannot establish factual truth or guarantee ATS acceptance.
7. Present a draft for review. Preserve previous approved artifacts during revisions. Final approval is an explicit user action tied to a document version.

Do not force the CV through LaTeX: preserve RenderCV's own rendering pipeline and use LaTeX where it is the chosen source, initially the cover letter.

## Durable workflow and storage

Use an explicit workflow: draft -> captured -> analyzing -> awaiting review -> generating -> rendering -> draft ready -> approved. Runs can fail, be interrupted, or be cancelled independently of the application; revisions create new versions.

Persist application state, task events, inputs, and output manifests locally. On restart, identify interrupted runs and offer a deliberate retry; do not blindly relaunch generation. Duplicate clicks or repeated requests must not start duplicate runs. Check the captured URL and job identity before associating results with an open tab.

Preserve the existing job-folder layout and add versioned metadata incrementally:

```text
private-workspace/
  master_cv.yaml
  constraints.md
  cover_letter_constraints.md
  personal_flair.md                 # optional
  references/                      # private templates/examples and index
  recipes/                         # local site rules
  jobs/<application-id>/
    application.json               # schema version, state, source, current version
    job_posting.md
    prompt.md
    cv.yaml
    cover_letter.tex
    tailoring_notes.md
    runs/<run-id>/                 # input snapshot, events, artifact manifest
    versions/<version-id>/         # preserved sources and reviewed outputs
    output/cv/
    output/cover-letter/
    output/qa/
```

Choose JSON files or a small local database for task persistence in phase 0. Avoid two competing sources of truth. Retain human-readable application folders and define migration/backup behavior before changing existing data.

## Permissions and trust boundaries

Request site access when needed. Capture only confirmed posting content and preview it before agent processing. Explain which agent receives job and personal information: local storage does not imply local model inference.

Authenticate companion requests, restrict accepted extension origins, validate paths under the selected workspace, and bind local HTTP transport to loopback if used. Scope generation access to the selected workspace and protect reference/master sources through application checks, not prompts alone. Treat web content as untrusted input. Render imported LaTeX with shell execution disabled and bounded resources; audit supported templates and package fetching before distributing the companion.

Keep private content out of public source control and ordinary diagnostic logs. Provide local export, backup, and deletion controls. Do not add silent telemetry or automatic submission.

## Delivery phases and acceptance criteria

### Phase 0: contracts and baseline

Inventory working behavior and representative sanitized captures. Define capture, recipe, application, agent-event, and artifact schemas. Decide companion transport, persistence, renderer packaging, and the first supported agent configuration. Centralize workflow rules currently duplicated in prompts while preserving AGENTS.md.

Done when: the current capture -> analysis -> generation -> PDF workflow has a reproducible baseline, architecture decisions are recorded, and existing application folders remain readable.

### Phase 1: visual picker and capture preview

Deliver selection overlay, field assignment, multi-block capture/exclusion, editable preview, and manual fallback. Preserve automatic extraction as a convenience.

Done when: a user can capture correct details from LinkedIn and at least two structurally different non-LinkedIn sites without changing code; cancellation removes the overlay; unrelated page content is excluded; site permissions are requested only as needed.

### Phase 2: reusable recipes

Deliver recipe creation, matching, validation, repair, and a small management view. Cover navigation between postings in the same tab.

Done when: one saved recipe captures several postings with the same layout, an intentionally changed layout prompts repair, and results never silently attach to a previously viewed job.

### Phase 3: grounded generation and durable execution

Deliver the reference index, renderer/version checks, agent adapter, persisted task state, structured progress, cancellation/retry behavior, and output validation. Preserve the manual prompt fallback.

Done when: a clean workspace with approved profile/templates can produce both PDFs; references and factual sources are recorded; missing optional flair does not block; generation does not change the master CV; restart/failure recovery works; failed builds are not reported as completed documents.

### Phase 4: review, revisions, and application history

Deliver PDF preview/open/download, text inspection, actionable requirements checklist, revision requests, preserved versions, explicit approval, and a searchable local application list with manual status.

Done when: a user can capture, generate, revise, compare, approve, export, close the browser, and reopen the same application with its history intact.

### Phase 5: installation and updates

Package the companion and supported rendering dependencies, automate normal startup, add setup diagnostics, and prepare extension distribution. Determine signing, browser-store requirements, dependency redistribution licenses, and release channels before release. Keep agent login within the provider's supported flow.

Done when: a fresh supported Windows account can install and complete an application without cloning this repository, opening a terminal, or manually loading an unpacked extension in the normal release path. Updates preserve private data and provide recovery; uninstall behavior clearly distinguishes program files from retained private documents.

### Later, after the first complete release

Additional browsers/operating systems, additional agent adapters, richer reference search, optional sanitized recipe sharing, more document types, and optional synchronization. Each requires a separate scope decision; none should block the first supported end-to-end release.

## Verification and release quality

- Capture: sanitized fixtures for structured metadata, split descriptions, noisy pages, missing fields, malformed pages, and changing layouts; manual browser checks for the interactive picker and site permissions.
- Workflow: duplicate requests, navigation, service/browser restarts, concurrent applications, cancellation, timeout, and retry without losing answers or approved versions.
- Generation: a small factual test profile with known missing qualifications; verify unsupported claims are flagged, submission requirements survive, and master/reference sources remain unchanged.
- Documents: schema validation, successful builds, PDF existence and readable text, visual page review, long-content overflow, non-ASCII names, and multilingual fixtures where supported.
- Installation: fresh-user setup, missing agent/login, unavailable renderer resources, upgrades, backup restoration, and uninstall.
- Trust boundaries: untrusted posting instructions, unauthorized companion requests, invalid paths, and hostile imported template behavior.

Use deterministic fixtures and mocked agent events for routine regression tests; keep live agent runs as explicit integration checks. Track capture correction rate, first-attempt render success, recovery success, and time to a reviewable draft using local/manual measurements initially. Agree quantitative release targets after establishing the baseline.

## First implementation slice

Begin with phase 0 and a narrow phase-1 slice: select a description block on an unfamiliar site, preview/edit the Markdown, and send it through the existing approved workflow. Keep the result small enough to review in one change. Add field mapping and multi-block selection next, then persist recipes. This proves the key product interaction before investing in distribution or multiple agent providers.
