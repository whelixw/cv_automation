# Review and application history

Connect the companion, expand **Application history and document review**, and
refresh applications. Search by company/role, then choose an application.
History lists captured applications saved since durable storage was introduced;
older directories are not silently imported or marked approved.

Select a preserved document version to see page previews, PDF links, requirements
and tailoring notes. Compare source changes with another version. Revision requests
start a new isolated run after a generated draft exists. They preserve previous
versions and approvals. Saved applications without documents can be analyzed again.

Review every page and the requirements checklist, check the review box, and approve
the current version. Approval is recorded with its version and manifest hash. The
server rejects stale versions, active runs and changed artifacts. Final ZIP export
contains the approved CV/letter PDFs, submission requirements and tailoring notes;
it excludes the master profile, connection secrets and application run state.

The tracking-status control is manual. It does not submit applications, contact an
employer, or infer that an exported application was sent.

Private files are fetched with the paired authorization header and displayed through
temporary browser blob URLs. Credentials are never placed in artifact URLs. File
access is limited to the selected version's manifest and workspace-contained paths.

Automated checks cover approval/export boundaries, changed artifacts, private HTTP
authentication, and browser history/comparison/approval controls. A live agent-generated
application still needs manual end-to-end review before release.
