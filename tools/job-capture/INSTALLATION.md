# Developer distribution and release gates

This is a developer distribution, not a signed/publicly released installer. It avoids
cloning the repository and includes a double-click Windows setup entry point, but
still requires user-installed Python 3.12+, Codex signed in, the bundled LaTeX
compiler helper, internet for Python dependencies/initial TeX packages, and manually
loading the unpacked Chrome extension. Public distribution is not complete until
the release gates below are satisfied.

## Build

From the repository root:

```powershell
.venv\Scripts\python.exe tools/job-capture/release.py --output tmp/job-capture-release
```

This produces a developer ZIP and a separate extension ZIP. Payload files are
explicitly allowlisted, contain no cv-private data, and have an SHA-256 inventory.
Hashes detect incomplete/changed copies; they are not a signature or proof of
publisher identity. Policy/templates in Git workspaces are taken from HEAD so
unrelated working edits are excluded. The build does not install software or
publish anything.

## Developer install

Extract the developer ZIP to a trusted local folder and double-click `Install.cmd`.
Choose a private workspace. Setup creates a per-user program directory under
LocalAppData, installs pinned top-level Python dependencies into a private virtual
environment, seeds missing profile/preferences files, and creates a desktop launch
shortcut. Existing profile/preferences are never replaced. Fill the starter profile
with verified facts before generation. Use **Check setup** in the connected panel
to inspect missing components; it does not verify agent login or cached TeX packages.

Load the stable `LocalAppData/RenderCVJobCapture/extension` folder in Chrome's
developer extension UI. Connect through the local setup page described in
`DURABLE_WORKFLOW.md`. The browser extension still needs a reload after updates.

The installer is parsed and packaged by automated checks but has not been executed
against this user's Windows account or validated on a clean Windows account.
No autostart, global Python setup or global execution-policy change is performed.

## Updates and uninstall

Install a new version into its own release directory and retain the previous one.
Close the running companion before switching releases. The installation record
retains the prior release path. The stable extension folder preserves the unpacked
extension ID across updates. Automated upgrade rollback is not implemented yet;
restore the desktop shortcut to the previous release and its extension files if
needed. Back up the private workspace before an upgrade.

Run the installed `Uninstall.ps1` to remove default-location program releases and
the desktop shortcut after closing the companion. It refuses linked directories,
custom install roots and a workspace inside the program directory. Private documents
and the installation record are retained. Remove the Chrome extension separately.

## Private backups

Use the companion's Python environment and management tool:

```powershell
python manage.py backup --workspace C:\PrivateWorkspace --file C:\PrivateBackups\application-backup.zip
python manage.py restore --workspace C:\NewEmptyWorkspace --file C:\PrivateBackups\application-backup.zip
```

Backups include the profile, preferences, references, applications and a consistent
SQLite snapshot, with a checksum inventory. Connection secrets are excluded;
restored workspaces must pair again. A backup contains personal information and
should stay in private storage. Restore validates all paths/hashes before writing
and refuses nonempty destinations. It does not migrate or overwrite existing data.

## Public-release gates still open

- Managed Python/renderer runtime or a signed self-contained package; no Python prerequisite.
- Locked transitive dependencies, dependency-license review and applicable notices.
- Signed installer, tested upgrades/rollback and optional user-controlled startup.
- Clean Windows-account install/update/uninstall and restore acceptance tests.
- Live agent-generated end-to-end acceptance with source protection and visual review.
- Manual acceptance on LinkedIn and two different non-LinkedIn layouts; Jobindex
  basic capture was confirmed by the user before this larger update.
- Browser-store listing, permission disclosures, privacy notice, signed distribution
  and store-managed extension updates. The prepared extension ZIP is unpublished.

No public release, signing-account operation or store submission has been performed.
