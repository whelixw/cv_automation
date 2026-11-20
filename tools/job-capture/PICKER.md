# Visual description picker: first slice

Reload the unpacked extension after updating. Open a job posting and the side panel.
If Chrome requests approval for the updated tab permission, accept it and reopen
the panel. This lets the persistent panel identify the current site's address;
reading the page still uses the separate site-access permission.

1. Click **Select description on page**. Allow access to that site if requested.
2. Point to the description. Press **↑** to select its enclosing section or **↓**
   to select its first child. Click sections to include them, Alt+click sections to
   exclude, then press **Enter** to finish. Click a section again to undo it.
   **Esc** cancels. Use the field selector to pick the role and company separately.
3. Review the editable description, role and company. You can paste or correct text.
4. Check the review box and click **Capture and analyze**. Generation still requires
   its separate approval after analysis.

The description is saved with the URL-specific draft. Review confirmation is not
persisted and is cleared when role, company or description changes. Capturing after
navigating to a different URL is blocked until you read the current page again.
Cancelling selection leaves the draft alone. The picker automatically cancels after
two minutes or when the page unloads.

Under **Saved site rules**, confirm the URL path pattern and save your page selections.
The star matches any characters in the URL path; hostname matching is exact. Read
another matching posting to apply the rule. Existing drafts keep your manual edits.
Disable/delete old rules there; repick fields and save the same pattern to repair
one. Rules contain selectors, not captured personal content, and stay local.
Missing/ambiguous selectors or conflicting matching rules leave the description empty.
Positional selectors can break when layouts change; always review the preview.

The picker works in the main document. Iframe content and shadow-root traversal are
future work. Browser
internal pages and pages that disallow extension access cannot be selected. Choose
another enclosing section or use pasted text if a page's markup extracts poorly.

## Development checks

Python checks from the repository root:

```powershell
.venv\Scripts\python.exe -m unittest discover -s tools/job-capture/tests -v
```

Browser checks use the development-only Playwright dependency declared in this
directory's `package.json`. Install it using your normal Node package manager, then
run `npm test` from this directory. No real agent or internet access is used by the
tests: job pages and companion responses are fixtures. Chrome is expected at its
standard Windows installation path; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to another
Chromium executable if needed. A runtime supplying Playwright through `NODE_PATH`
can run `node --test tools/job-capture/tests/picker.test.cjs` from the repository root.

Tests cover selection/parent navigation, Markdown preservation, relative links,
hidden content removal, intercepted clicks, cancellation/repeated activation,
page-unload cleanup, denied permissions, editable drafts, required confirmation,
and navigation before capture. Chrome extension APIs are mocked for the panel test;
this does not replace a manual test of actual extension permission prompts and
script injection on real websites, or a live agent-to-PDF run.
