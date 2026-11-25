# Reliability Audit & Feature Roadmap

**Audit date:** 2026-11-25
**Scope:** Dona Bridge `master` @ `1b2707a`

> **Update (same branch):** the following roadmap items are now implemented and
> tested: **A1** (real encrypted backup/restore), **A2** (pre-migration and
> pre-restore snapshots), **A3/A4** (open-data-folder buttons + storage/health
> panel), **A6** (updater plugin + UI + `createUpdaterArtifacts`; server
> configuration documented in `docs/UPDATES.md`), **B1** (drag-to-reorder and
> colour-coded account groups), **B2** (`Ctrl+K` command palette), and an
> auto-start toggle in Settings (launches minimised to the tray).

---

## 1. Root cause: “all accounts disappear after restarting the PC”

The accounts were **never deleted**. `list_accounts` hung forever, so the UI
rendered the first-run onboarding screen (“add your first account”).

### The deadlock

`src-tauri/src/commands/accounts.rs` held the single global database guard
while converting each row into an `AccountInfo`:

```rust
let conn = db::get().lock();                       // ← database lock #1
let list = core_accounts::list_accounts(&conn)?;
Ok(list.into_iter().map(AccountInfo::from).collect())   // ← conn still alive
```

`AccountInfo::from` looked up the per-account PIN, which did:

```rust
let conn = db::get().lock();                       // ← database lock #2, same thread
```

`parking_lot::Mutex` is **not re-entrant**. Locking it twice on one thread
blocks forever. Consequences:

1. The blocking thread is stuck with the database lock held **for the rest of
   the process lifetime**.
2. The first `list_accounts()` invocation never resolves ──> the account list
   stays empty ──> onboarding screen.
3. Every later account `upsert` also blocks → the temporary 8-second timeout in
   `AddAccountModal` fired → “Request timed out”.
4. The bug only appears when **at least one account exists**, which is exactly
   why it looked like “accounts are lost on restart”: the very first run with an
   empty database works, adding an account works in memory, and the next launch
   can no longer read the list.

A second, independent data-loss bug was found in `src-tauri/nsis-hooks.nsh`:
the custom uninstall hook ran on **updates** too, and in silent mode NSIS's
`MessageBox` returns `IDOK` (= `IDYES`), so every version upgrade silently ran
`RMDir /r` over `%APPDATA%` (database) and `%LOCALAPPDATA%` (all WhatsApp
sessions). That path is now guarded by `$UpdateMode` and `${Silent}`.

### Fixes applied

| Area | Change |
|---|---|
| Account list | Lock state is read with the **same** connection (`lock::locked_account_ids`) and the guard is dropped before building DTOs. |
| Regression test | `listing_accounts_with_a_pin_does_not_deadlock` fails with a timeout if a second lock is ever introduced. |
| Error handling | Loading is retried with exponential backoff (8 attempts). On final failure the app shows an explicit “could not open your accounts — data is not deleted” screen with a Retry button and the log path, **never** the onboarding screen. |
| Save flow | Removed the artificial 8 s `Promise.race` timeout that reported failure while the write could still succeed. |
| Durability | `PRAGMA synchronous=FULL` + `wal_autocheckpoint=1000`, explicit `wal_checkpoint(TRUNCATE)` on window close and process exit. |
| DB location | Moved from Roaming AppData to **Local** AppData (next to the WebView2 profiles) with a one-time automatic copy of the old database. Roaming/OneDrive-synced folders are a known way to corrupt SQLite WAL databases. |
| Upgrades | NSIS hook no longer deletes user data during `/UPDATE` or silent installs. |
| Diagnostics | Logs are now written to `%LOCALAPPDATA%\com.makahar.donabridge\logs\dona-bridge.log` (daily rotation) in addition to stdout. |
| Notifications | `wa_notify` no longer blocks the async runtime on the DB mutex, and now honours **DND / quiet hours** (previously implemented but unused). |
| Startup load | Background pre-warming is staggered (1.2 s apart) and skips PIN-locked accounts, so locked messages no longer load behind the lock screen. |
| Data fidelity | `created_at` now parses SQLite's `datetime('now')` format (it was always `None`); removing an avatar now actually clears it. |
| Session health | New `wa_session_state` report → amber dot on the account dock when WhatsApp has logged the device out, instead of it looking like a missing account. |

---

## 2. Other issues found (not yet fixed)

1. **`FEATURES.md` overstates the product.** Drag-to-reorder accounts, account
   groups, per-account zoom UI and “rich text notes (Quill)” are listed as ✅ but
   are not implemented (no drag handlers on the dock, no `group_id` UI, no zoom
   control, notes are a plain `<textarea>`). This is the fastest way to lose user
   trust — align the table with reality before the next release.
2. **Encrypted backup was a stub that reported success.** Replaced with a real
   AES-256-GCM + Argon2id backup/restore (see above).
3. **Avatars are stored as base64 data URLs in the `avatar_path` column**, which
   contradicts the project's own “images as files” rule and bloats every
   `list_accounts` response. Fine at 128×128, worth moving to
   `avatars/{account_id}.jpg` + `convertFileSrc`.
4. **`account_groups` had no UI or commands** — now has full CRUD and
   colour-coded dock rings.
5. **No `pnpm-lock.yaml` in the repo** — fixed: lockfiles are now tracked, so
   the `--frozen-lockfile` CI step works on a clean checkout.
6. **Unused dependencies** (`tauri-plugin-updater`, `tauri-plugin-log`, `rmcp`,
   `sysinfo`, `tauri-specta` in `src-tauri`; `uuid`, `anyhow` in `dona-core`)
   produce cargo warnings and extra build time. Either wire them up or drop them.
7. **`add_child` webview bounds** use logical pixels without accounting for
   DPI-scaled secondary monitors; worth testing on a mixed-DPI setup.
8. **`securityLockStatus().then(...)` has no `.catch`** — a backend error leaves
   the app un-locked silently. Add error handling.
9. **No automatic schema backup before migrations.** One bad migration is
   unrecoverable; copy `dona.db` to `backups/` before `to_latest` when the
   schema version changes.
10. **Window close exits the app**; the tray has “Show”, but closing the main
    window does not hide to tray. Many users expect minimise-to-tray for a
    messaging client (and it keeps notification webviews alive).

---

## 3. Feature roadmap (WhatsApp-policy safe)

The governing rule from the project itself: **the user always presses Send**.
Anything that reads/sends automatically, bulk-sends, or reverse-engineers the
protocol is out. The items below only use `web.whatsapp.com` as a normal browser
session and the user's own local data.

### A. Reliability & trust (do first)

- **A1. Real encrypted backup/restore.** `VACUUM INTO` a consistent snapshot,
  encrypt with AES-256-GCM, key derived with Argon2id, save via the native file
  dialog. Restore into a fresh DB with a confirmation + automatic restart.
  *(Replaces the current stub that lies about success.)*
- **A2. Pre-migration snapshots** in `backups/` (keep the last 3).
- **A3. “Open data folder” / “Open logs” buttons** in Settings → Support.
- **A4. Health panel**: DB path, size, last checkpoint, account count, WebView2
  profile size per account, WhatsApp session state. One screenshot replaces a
  dozen support questions.
- **A5. Database integrity check on startup** (`PRAGMA quick_check`) with a
  non-destructive warning and a “restore from snapshot” action.
- **A6. Auto-update via `tauri-plugin-updater`** (dependency is already present
  but unused). Must ship together with the NSIS hook fix, otherwise updates
  still wipe data. Requires a signing key + `latest.json` endpoint.

### B. Daily-driver productivity

- **B1. Account reordering + groups** (schema already has `group_id` and
  `sort_order`; `@dnd-kit` is already installed). Drag the dock, collapse groups.
- **B2. Command palette (`Ctrl+K`)**: jump to account, contact, project, template
  or setting. The shortcut is already forwarded from the webviews but unused.
- **B3. Per-account zoom & spellcheck toggles** (WebView2 supports both).
- **B4. Hibernate inactive accounts**: destroy the webview for accounts unused
  for N hours to cut RAM, recreate on click. Not the same as logging out — the
  profile stays on disk.
- **B5. Minimise to tray + “start minimised” handling** (the autostart plugin
  already passes `--minimized`, but the flag is ignored).
- **B6. Per-account notification sounds and “mention only” mode.**
- **B7. Follow-up snooze presets** (1 h / tomorrow / next week) on reminders.
- **B8. Contact merge + duplicate detection** for CSV imports.
- **B9. Template variables beyond `{name}`**: `{first_name}`, `{company}`,
  `{last_order}`, with a live preview against the selected contact.
- **B10. Notes with markdown + full-text search** (SQLite FTS5 is built in).
- **B11. CSV/JSON export of the whole CRM** (contacts, tags, notes, projects) —
  the current “JSON backup” only covers a few `localStorage` keys.
- **B12. Contact timeline**: notes, reminders, stage changes, and captured chat
  context in one chronological view.

### C. AI copilot (still draft-only)

- **C1. Local-only default** (Ollama) with a clear badge when a cloud provider
  is active.
- **C2. Summarise the open chat**, translate a draft, fix grammar — output goes
  into the composer, never to Send.
- **C3. Tone presets** (formal / friendly / concise) — already listed as planned.
- **C4. Redaction preview** before sending chat context to a cloud provider
  (hide phone numbers/emails, show exactly what will leave the PC).
- **C5. Per-account AI profiles** (e.g. Bengali for support, English for sales).

### D. CRM depth

- **D1. Pipeline analytics**: conversion rate per stage, average time in stage,
  won/lost this month — computed locally from existing tables.
- **D2. Saved views/filters** for contacts (tag + stage + owner).
- **D3. Custom fields** (JSON column) with a schema editor.
- **D4. Reminder templates** (“no reply in 3 days” → creates a reminder, not a
  message).
- **D5. Calendar (`.ics`) export of reminders/projects.**

### E. Security & privacy

- **E1. Auto-lock after N minutes idle** (currently only manual lock).
- **E2. Lock on Windows session lock / sleep** (subscribe to `WM_WTSSESSION_CHANGE`).
- **E3. Encrypted local database (SQLCipher)** as an opt-in, key in Credential
  Manager.
- **E4. Panic wipe** (delete DB + WebView2 profiles after PIN confirmation).
- **E5. Audit log viewer** for MCP activity (table already exists).

### F. Deliberately **not** doing (policy / ToS)

- Auto-send, bulk/broadcast, scheduled sending, auto-reply bots.
- Scraping chats or contact lists in the background.
- Unofficial protocol libraries (Baileys, whatsapp-web.js).
- Custom CSS/JS injection into WhatsApp beyond the privacy blur.
- Cold-outreach automation. For legitimate business automation, the compliant
  path is the official **WhatsApp Business Platform (Cloud API)** — a separate
  integration, not a wrapper feature.

---

## 4. Suggested order of work

1. Ship the reliability fixes in this branch (account list, NSIS, durability).
2. A1 + A3 + A4 (backup + support tooling) — cheapest way to stop data-loss
   reports for good.
3. B1 + B2 (reorder/groups + command palette) — biggest perceived quality jump.
4. A6 (auto-update) once the installer hook fix is verified on a real upgrade.
5. A5, E1, E2 — security hardening.
6. D1, C2, C4 — differentiators that stay fully compliant.
