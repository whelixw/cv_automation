# Source generation and document versions

Analysis uses the existing read-only agent workflow. Generation/revision uses a
temporary workspace outside the repository. It contains copies of the approved
profile/constraints, optional flair, application inputs and curated references.
The agent has workspace-write access to that temporary workspace. The companion
checks protected copies for changes and imports only validated document outputs;
it does not ask the agent to edit the original profile or compile documents.

Technical references include the repository's RenderCV schema, selected YAML/CLI
documentation and the approved cover-letter template. To add private references,
put documents under `cv-private/references/` and list them in `index.json`:

```json
[{"path": "cv-private/references/approved-style.md"}]
```

References are limited to supported document types, 5 MB each and 32 private entries.
The run records their paths/hashes and the installed RenderCV version. References
and example applications describe style/format; they do not add career facts.

The agent creates `cv.yaml`, `cover_letter.tex`, `tailoring_notes.md` and
`requirements.json` (an `items` list of category/text objects). The companion invokes
RenderCV itself, then the bundled `compile_latex.py --compiler tectonic` helper.
The bundled helper uses Tectonic's untrusted mode. TeX root redirection is rejected.
Missing compiler helpers or packages produce an error rather than silently using
local TeX Live. Set `JOB_CAPTURE_LATEX_SCRIPT` only to a trusted compiler helper.

Both builds must succeed and produce PDFs with readable text. Page PNG previews,
extracted text and private build logs are retained. These checks do not establish
factual correctness, guarantee ATS compatibility, or replace visual review.

Successful outputs go to `versions/<run-id>/` with a hash manifest. Older versions
are preserved. Compatibility copies remain at the existing job-root/output paths,
but review/approval uses preserved versions. Failed builds retain logs under
`runs/<run-id>/` and do not replace the reviewed version. Cancellation before publish
does not publish sources or PDFs. Temporary source workspaces are cleaned up.

Verification: fictional CV and cover-letter sources were built through both real
renderers on 27 October 2026; PDF text extraction and page preview inspection passed.
This is a renderer integration check, not a live agent generation acceptance test.
The Windows build environment explicitly uses UTF-8 for captured compiler output.
