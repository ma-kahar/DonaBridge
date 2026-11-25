# Changelog

All notable changes to Dona Bridge follow [Keep a Changelog](https://keepachangelog.com/) format and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed — startup & layout

- **Full-screen CRM now works.** Expanding the drawer renders it as a real
  full-window overlay (it used to overflow past the account dock and sit behind
  the native WhatsApp webview). The WhatsApp webview is hidden while the CRM is
  full-screen and restored when it collapses; `Esc` collapses it.
- **The application could not start at all.** The Tauri updater plugin was
  registered without a `plugins.updater` configuration section, so plugin
  initialization panicked before the window was created — clicking the icon did
  nothing. Added a safe placeholder configuration (empty endpoints/public key)
  so the app starts and the update button reports “not configured”.
- Added a native crash dialog and `logs/crash.log`. Startup failures are no
  longer silent; the dialog shows the error and the log path.
- Version bumped to 0.1.1 so the fixed installer is distinguishable from the
  broken 0.1.0 build.

### Fixed — data loss / reliability

- **Fixed the startup deadlock that made every saved account disappear.**
  `list_accounts` held the global SQLite mutex while building `AccountInfo`,
  which locked the same mutex again to read the per-account PIN. `parking_lot`
  is not re-entrant, so the command hung forever and the UI showed the
  first-run onboarding screen. Added a regression test
  (`listing_accounts_with_a_pin_does_not_deadlock`).
- **Installer no longer deletes user data when updating.** The NSIS uninstall
  hook removed `%APPDATA%` and `%LOCALAPPDATA%` during silent `/UPDATE` runs
  (NSIS returns `IDOK` = `IDYES` for `MessageBox` in silent mode), wiping every
  account, CRM row and WhatsApp session on upgrade. It now asks only on a real,
  interactive uninstall.
- The account list is retried with backoff, and a failed read shows an explicit
  “data is not deleted” error screen with Retry instead of the onboarding screen.
- Removed the 8 s client-side save timeout that could report failure for a
  successful write.
- Database moved to Local AppData (next to the WebView2 profiles) with an
  automatic one-time copy from the old Roaming location; `synchronous=FULL` and
  WAL checkpoint on exit for durability across hard shutdowns.
- `created_at` now parses SQLite timestamps correctly; clearing an avatar works.
- DND / quiet hours are now actually applied to notifications.
- File logging to `%LOCALAPPDATA%\com.makahar.donabridge\logs\`.

### Added

- **LiteCRM (Tier 1)**: deals with value, currency, probability and expected
  close date; custom pipelines and stages; a drag-and-drop deal board with
  column totals; contact timeline; custom contact fields; unified tasks with
  Today/Upcoming/Overdue views and desktop notifications; pipeline reports
  (open/won value, win rate, average deal, overdue tasks); and a Do-Not-Contact
  warning before opening a chat or inserting a draft.
- Session health reporting: the account dock shows an amber dot when WhatsApp
  has logged the device out, so it is clear that a QR re-scan is needed.
- **Encrypted, portable backups** (Settings → Data): AES-256-GCM with an
  Argon2id-derived key, consistent `VACUUM INTO` snapshots, automatic
  pre-restore and pre-migration snapshots, and a restart-based atomic restore.
- **Storage & health panel** with database/WAL/backup/WebView2 sizes,
  account/group counts, and buttons that open the data or log folder.
- **Account groups** (colour-coded, CRUD in Settings → Accounts) and
  **drag-to-reorder** in the account dock, both persisted to the database.
- **Command palette (`Ctrl+K`)** to search accounts, contacts, quick replies,
  projects and actions.
- **Auto-start toggle** in Settings → General; when launched at login the app
  starts minimised in the tray (`--minimized`).
- **Updater wiring**: the Tauri updater plugin, a "Check for updates" action and
  `docs/UPDATES.md` with the signing/endpoint setup.
- `docs/RELIABILITY-AND-ROADMAP.md` with the full audit and a policy-safe
  feature roadmap.
- Initial project scaffold
- Blueprint, compliance rules, security model
- MIT License, README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, PRIVACY docs
- `.githooks/commit-msg` strips unwanted trailers from every commit
