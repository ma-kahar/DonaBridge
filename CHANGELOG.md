# Changelog

All notable changes to Dona Bridge follow [Keep a Changelog](https://keepachangelog.com/) format and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-11-27

### Added

- **Native microphone compatibility layer.** On some Intel/Huawei laptops the
  Windows WASAPI shared-mode engine cannot open the built-in microphone
  (`IAudioClient::GetMixFormat` returns `0x8000FFFF`), so Chromium/WebView2
  cannot record even though Firefox and the hardware work. Dona Bridge now
  captures the microphone through PortAudio’s **WDM-KS (kernel streaming)**
  backend and feeds it to WhatsApp Web as a normal `MediaStream`, so voice
  messages record and send exactly like in a browser. If the bridge is not
  available, the normal WebView2 path is used automatically.
- **Microphone permission prompt** on first use: Allow / Block. The answer is
  remembered for the current session.
- **PortAudio runtime** bundled with the installer (`src-tauri/resources/portaudio`,
  MIT licence included).

### Fixed

- Voice notes now work on machines where Chrome/WebView2 reports
  “Microphone not found / unavailable” but Firefox can record.

## [0.2.3] - 2026-11-26

### Fixed

- **Voice messages / microphone.** WebView2 asks the host for microphone
  permission before the first `getUserMedia` call. That request was previously
  unanswered while the page was loading, so WhatsApp reported “Microphone not
  found”. The permission is now granted when the webview is built (and globally
  for the app shell), so recording a voice note works like in the browser.
- **Drag and drop.** Tauri replaced WebView2’s drop handler, which silently
  blocked HTML5 file drops. Child webviews now use the native handler, so a file
  dropped on a chat is attached normally.

### Added

- **Privacy-safe demo mode** for screenshots and support:
  `DONA_DATA_DIR` relocates the database, WebView2 profiles, backups and
  download history to an isolated folder, and `DONA_DEMO=1` loads a bundled,
  fictional chat page instead of WhatsApp. Seeded demo accounts/CRM come from
  `scripts/seed-demo-data.py`; see `docs/DEMO_SCREENSHOTS.md`.
- Screenshots section in the README, captured entirely with demo data.

### Changed

- New bridge/chat icon in the title bar and About screen, 128 px favicon, and
  the wide Dona Bridge banner at the top of the README.

## [0.2.2] - 2026-11-26

### Added

- **WhatsApp file downloads now work.** PDFs, images and documents downloaded
  inside a WhatsApp webview are saved to `Downloads\Dona Bridge` instead of
  doing nothing.
- **Download manager**: a Downloads button in the taskbar (with an unread
  badge) opens a panel listing every file with account, size, time and status.
  Open the file, show it in Explorer, remove it from the list, delete it from
  disk, clear the history, or open the downloads folder.
- A native Windows notification is shown when a download completes.

## [0.2.1] - 2026-11-26

### Added

- **Detailed About screen** (title-bar info button, Settings → About or the
  “About Dona Bridge” command-palette action): version and build profile, Tauri
  and WebView2 versions, OS/architecture, database schema, storage sizes and
  account counts, buttons to open the data/logs/backups folders, copyable
  system information, update check, release highlights, credits, MIT licence
  and the independent/not-affiliated notice.

## [0.2.0] - 2026-11-26

### Fixed — startup & layout

- **Account switcher could not be used.** The dropdown opened upwards into the
  native WhatsApp webview area, which always paints above HTML, so it was
  invisible and unclickable. It now hides the webview while open, with a
  backdrop, Escape to close, and the list is fully usable.
- **CSV contact import** now handles quoted names containing commas, header
  rows in any column order, CRLF/BOM files and normalises unknown stages to
  “New” instead of leaving a blank stage.
- **Locked at startup**: a webview created while App Lock was engaged could
  still be shown for a moment. Webviews now stay hidden whenever the app is
  locked, not only when a React overlay is open.

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
- **Blank white window in development**: on machines where Windows resolves
  `localhost` to IPv6 only, the dev server and the WebView2 shell disagreed.
  Vite now binds `127.0.0.1` and the dev URL uses it explicitly.
- **Light-mode banners**: warning, success and error boxes now use dark text on
  a light tint instead of pale text on a dark tint.
- **Startup could show a minimised window**: when the saved state was
  maximised, the state plugin ran before the window was shown and left it
  minimised. The show path now unminimises first (and does the same when a
  second launch focuses the existing window).

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

- **Theme selector** in Settings → General (Dark / Light), an app favicon and
  visible keyboard focus rings for every control.
- **Read-only local API** (Settings → Integrations): a token-protected JSON API
  on `127.0.0.1` (default port 8787) for dashboards and automation. Endpoints
  cover accounts, contacts, contact timelines, deals, tasks, reports and
  templates. Off by default, GET-only, no CORS headers, Bearer token stored in
  Windows Credential Manager, with reveal/rotate and a configurable port.
- **WebDAV backup upload** (Settings → Data & Storage): send an encrypted backup
  to a Nextcloud, ownCloud, HiDrive or NAS WebDAV folder on a 6/12/24-hour or
  weekly schedule, or with “Back up now”. The file is AES-256-GCM encrypted
  before upload, the newest 7–30 are kept on the server with WebDAV DELETE,
  credentials live in Windows Credential Manager, and “Test connection” checks
  write access without creating a real backup.
- **Outbound webhooks** (Settings → Integrations): send contact, deal and task
  events to n8n, Zapier, Make or your own endpoint. Deliveries are signed with
  HMAC-SHA256 over `timestamp.body` (`X-Dona-Signature: sha256=…`), include a
  timestamp and delivery id, retry server errors, and record the last status.
  The signing secret lives in Windows Credential Manager; nothing is sent until
  webhooks are enabled.
- **CRM data portability** (Settings → Data & Storage): export the entire CRM —
  contacts, tags, notes, reminders, quick-reply templates, pipelines, deals,
  custom fields and tasks — as one readable JSON file, and import it on another
  PC (accounts are matched by name when their ids differ). Import replaces CRM
  data only, runs in one transaction and writes a safety snapshot first.
  Deals and tasks can also be exported per account as CSV for Excel/Sheets.
- **Native-style green title bar**: the window is now frameless with an
  integrated WhatsApp-green caption (logo, active account, window controls).
  Drag anywhere on the bar to move the window and double-click to
  maximise/restore; minimise, maximise and close work as expected.
  The WhatsApp page is positioned below the bar and above the taskbar, so no
  content is covered.
- **Automatic encrypted folder backups**: choose any folder (OneDrive, Google
  Drive or Mega sync folder, or an external drive), schedule 6/12/24 h or weekly,
  and keep 7–30 rolling `.donabk` files. Backups are AES-256-GCM encrypted before
  writing; a recovery code in Windows Credential Manager can be revealed and
  saved for restoring on another PC.
- **Automatic local safety net**: snapshots are taken at startup, every 6 hours
  and on a clean exit (the newest 14 are kept). The database is checked with
  `quick_check` on every start.
- **Crash & corruption recovery**: a damaged database is quarantined and the
  newest valid snapshot is restored automatically. An unclean shutdown is
  detected via a session marker and explained in a Recovery dialog.
- **Recovery Center** (Settings → Data): database integrity, unclean-session
  notice, snapshot list with one-click restore, “Create snapshot”, “Open
  backups” and “Export diagnostics” (logs + health bundle).
- **UI error boundary**: a render error now shows a recovery screen with
  Reload / Open logs / Export diagnostics instead of a blank window.
- **Pro CRM dashboard**: the right-hand CRM panel is now 420 px wide with top
  tabs (Contacts, Pipeline, Tasks, Reports), contact/win-rate/revenue metric
  cards, quick actions, recent contacts and an AI Copilot card. Secondary
  sections (Reminders, Projects, Templates, Quick Replies, AI) live in the “⋯”
  menu.
- **Account dropdown taskbar**: the bottom bar now shows the active account with
  a switcher menu (avatars, edit, add), plus CRM, Search, Add, Lock, Settings,
  Online status and the Dona Bridge brand.
- **Contact recency**: contacts expose their last-updated time so recent-contact
  rows show “Active · 2m ago”.
- **WhatsApp colour system**: the full app now uses WhatsApp's dark/light palette
  and signature teal accent. Light mode text, inputs, borders and buttons are
  contrast-corrected.
- **Left dock removed**: the account switcher now lives in the bottom taskbar
  (right-click an avatar to edit), giving the WhatsApp view the full width.
- **Premium account colours**: 12 curated gradient swatches, larger colour
  picker, and shadowed/ringed avatars in the taskbar.
- **Refined CRM navigation**: larger rounded bottom tiles with an accent-tinted
  active state, matching the WhatsApp look.
- **No floating panels**: removed the sticky inspector, backdrop blur and drawer
  transition that made the right side appear to float while scrolling.
- **LiteCRM (Tier 1)**: deals with value, currency, probability and expected
  close date; custom pipelines and stages; a drag-and-drop deal board with
  column totals; contact timeline; custom contact fields; unified tasks with
  Today/Upcoming/Overdue views and desktop notifications; pipeline reports
  (open/won value, win rate, average deal, overdue tasks); and a Do-Not-Contact
  warning before opening a chat or inserting a draft.
- **Bottom CRM navigation**: the CRM sections now sit in an icon + text bar at
  the bottom of the drawer (3×3 grid) and across the bottom in full-screen mode.
- **Hideable account bar + application taskbar**: minimise the left account dock
  to a slim rail. A Windows-style taskbar at the bottom of the app now holds the
  account switcher, CRM, search, add account, lock and settings.
- **Right-side contact properties**: in full-screen CRM the contact list stays in
  the main area and the selected contact's details, fields, timeline and actions
  appear in a right-hand inspector.
- **Account-aware AI drafts**: replies are generated on behalf of the current
  account and signed with that account's name — never “Dona Bridge”.
- **Auto-read the open chat (opt-in)**: when a new message arrives in the chat
  you already have open, Dona Bridge reloads its last 20 messages so the Copilot
  can prepare a draft. It never reads background chats, never marks messages as
  read and never sends anything.
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
