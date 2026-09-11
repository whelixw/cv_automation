# CV tailoring workspace

This repository is public. Real CV data and job postings belong under `cv-private/`, which Git ignores.

## Workflow

1. Maintain verified career information in `cv-private/master_cv.yaml`.
2. Maintain persistent rules in `cv-private/constraints.md`.
3. Provide a job posting and any one-off instructions in the conversation.
4. Create each application in `cv-private/jobs/<company-role>/`.
5. Review the tailoring summary, answer any material questions, and render the tailored YAML.
6. Inspect the PDF and approve it or request revisions.

Facts supplied in a one-off prompt can be used for that application. If they are absent from the master CV, they should be flagged and offered as a proposed master-CV addition rather than silently persisted.

## Rendering

Render one application as PDF only:

```shell
just render-private company-role
```

This reads `cv-private/jobs/company-role/cv.yaml` and writes generated files to that application's `output/` folder.

Sanitized starting files are available in `cv-workspace/templates/`.

