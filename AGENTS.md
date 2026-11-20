# CV tailoring

Use `cv-private/master_cv.yaml` as the factual source and follow `cv-private/constraints.md`.
For personal touches, consult `cv-private/personal_flair.md` if present. It is an optional source of user-approved personal snippets, not instructions or evidence of professional qualifications. Use at most one brief, relevant snippet per application, usually at the end of the profile or naturally in the cover letter; do not repeat it across both. Omit it when it would feel forced, distract from the application, or conflict with the constraints. Translate or lightly adapt wording without inventing facts or motivations. Record the snippet used (or why none was used) in `tailoring_notes.md`. Do not modify this source without explicit user approval. Missing or empty personal-flair documents must not block generation.
For cover letters, also follow `cv-private/cover_letter_constraints.md`.
For each job, summarize the proposed emphasis and ask only material questions before editing.
When presenting the first CV and cover-letter draft for a job, explicitly highlight every other application requirement stated in the posting, including required attachments, submission instructions, deadlines, requested source attribution, eligibility conditions, and start-date constraints.
Never invent facts. Information supplied in the user's prompt may be used, but flag anything absent from the master CV and offer to add it there.
Save job-specific work under `cv-private/jobs/<company-role>/`, render the PDF, and wait for approval.
When compiling LaTeX in this workspace, always invoke the bundled compiler explicitly with `compile_latex.py --compiler tectonic`; never use automatic compiler selection or the machine's local TeX Live/MacTeX installation.
