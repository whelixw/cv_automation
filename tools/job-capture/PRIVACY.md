# Developer-build data handling

Job Capture stores captured job text, URLs, drafts and site-selection rules locally
in the browser extension. Career facts, preferences, application sources, generated
documents, run answers/events and build logs are stored in the selected private
workspace. The companion uses a local SQLite database and a per-install pairing
secret. No analytics or telemetry endpoint is implemented by this tool.

Local file storage does not mean local model inference. Clicking analysis or
generation invokes the configured signed-in Codex agent service. Relevant posting,
profile, preferences and reference content can be processed by that service under
the user's account and the provider's terms/settings. Agent login is handled by the
provider's supported application, not by this extension. This build supports the
installed Codex CLI only.

The tool requests tab metadata access so it can identify the active site's address
and request content access for that site. It does not implement browsing-history
collection. Content reading requires the requested host permission. Website content
is treated as untrusted input and reviewed before capture.

Connection codes are stored in browser local storage and the private workspace.
Private API access requires the exact paired extension origin and connection code.
Codes are not put in artifact URLs, final application exports or normal logs.
Diagnostics report component readiness, not profile text or credentials.

Final ZIP export contains the approved application's two PDFs, requirements and
tailoring notes. Private backup ZIPs contain broader personal workspace data and
should remain in private storage. Backup excludes the companion connection code.
Deleting an extension removes its browser storage through Chrome's normal controls;
uninstalling the companion retains the chosen private workspace. Delete workspace
files explicitly if you want those local records removed. Provider-side retention
is controlled separately through the provider, not this tool.

This document describes the developer build. A public store listing and its required
disclosures have not been published or reviewed.
