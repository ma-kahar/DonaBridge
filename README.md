<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Dona Bridge Logo" width="96" height="96" />
  <h1>Dona Bridge</h1>
  <p><strong>A fast, lightweight, privacy-first multi-account WhatsApp Web desktop client for Windows with a built-in CRM &amp; Draft-Only AI Copilot.</strong></p>

  <p>
    <a href="https://github.com/ma-kahar/DonaBridge/releases/latest">
      <img src="https://img.shields.io/github/v/release/ma-kahar/DonaBridge?style=for-the-badge&color=25D366&label=Download%20Installer" alt="Download Installer" />
    </a>
    <img src="https://img.shields.io/badge/Platform-Windows%2010%2F11%20(x64)-0078D6?style=for-the-badge" alt="Platform Windows" />
    <img src="https://img.shields.io/badge/Built%20With-Tauri%20v2%20%2B%20React-24C8DB?style=for-the-badge" alt="Tauri v2" />
  </p>
</div>

> **Disclaimer:** Dona Bridge is an independent desktop wrapper around official WhatsApp Web (`https://web.whatsapp.com`). It is **not affiliated with, endorsed by, or connected to WhatsApp LLC or Meta Platforms, Inc.**

---

## 📥 Download & Install (Windows)

1. Go to the [**Latest Release**](https://github.com/ma-kahar/DonaBridge/releases/latest) page.
2. Download **`Dona.Bridge_0.2.1_x64-setup.exe`**.
3. Run the installer and launch **Dona Bridge**.
   - **Safe Upgrades:** Installing a newer version over an older one **keeps all your existing accounts, sessions, and CRM data intact**.
   - **Clean Uninstall:** Uninstalling asks whether you also want to remove local app data.

---

## ✨ Detailed Features Guide

### 1. Multi-Account Workspace
- **Custom green title bar:** a frameless window with a WhatsApp-green caption showing the logo, the active account and native-style minimise / maximise / close controls. Drag the bar to move the window, double-click it to maximise or restore.
- **Isolated Sessions:** Run multiple WhatsApp accounts (Personal, Work, Support, Sales) side-by-side. Each account uses its own isolated `WebView2` profile.
- **Accounts in the taskbar:** switch accounts from the bottom taskbar avatars (right-click an avatar to edit). The old left dock is gone, so WhatsApp uses the full window width.
- **Application taskbar:** a Windows-style WhatsApp-coloured bar at the bottom of the window with the account switcher, CRM, search, add account, lock and settings.
- **Order & groups:** Drag accounts in the dock to reorder them. Create colour-coded groups in **Settings → Accounts** (Shop, Clients, Personal…) and assign an account to a group when you add or edit it.
- **Command palette (`Ctrl+K`):** Jump to an account, contact, quick reply, project or action from one search box.
- **Quiet Hours (DND):** Set per-account Do Not Disturb schedules in **Settings**.
- **Privacy & App Lock:** Lock the entire app or individual accounts with a PIN or **Windows Hello**.

### 2. Built-in Lightweight CRM (`Ctrl+B`)
Open the CRM drawer from the taskbar — or click the **Expand (`⛶`)** button to use it full-width. Press `Esc` to return to the drawer.

- **CRM dashboard (`Contacts` tab):** metric cards for total contacts, conversion and revenue, quick actions, recent contacts with one-tap chat, and an AI Copilot card.
- **Top tabs:** Contacts, Pipeline, Tasks and Reports; Reminders, Projects, Templates, Quick Replies and AI Copilot are one click away under “⋯”.
- **Deals pipeline (`Pipeline` tab):** create deals with value, currency, probability and expected close date. Custom pipelines and stages (colour, Won/Lost flags), drag deals between stages, column totals and pipeline value.
- **Contact timeline & custom fields:** every contact detail has a chronological timeline (notes, stage changes, deals, tasks) and user-defined fields (text, number, date, select) for Company, City, Birthday, etc.
- **Unified tasks (`Tasks` tab):** link tasks to a contact and deal, prioritise them and filter by Today / Upcoming / Overdue / Done. Due tasks raise desktop notifications.
- **Reports (`Reports` tab):** open and won pipeline value, win rate, average deal size, open/overdue tasks and activity for the last 30 days, with a per-stage breakdown.
- **Do-Not-Contact guard:** contacts in the `Do Not Contact` stage trigger a warning before opening a chat or inserting a template.
- **Contacts & Pipeline:**
  - Add contacts with name & phone number, or import/export via **CSV**.
  - **Pin (`📌`)** important contacts to keep them at the top.
  - **Search & Tag Filter:** Filter contacts by name, phone, or custom tags.
  - **List & Drag-and-Drop Kanban:** Switch between List view and Kanban columns (`New`, `Follow Up`, `Negotiating`, `Won`, `Do Not Contact`) and drag cards between stages.
  - **In-App Chat Launch (`💬`):** Clicking **Open Chat** opens the contact directly inside the app's active WhatsApp Web view (never in an external browser).
- **Projects & Tasks:**
  - Create client-linked projects with categories, due dates, and automatic progress bars.
  - Add tasks with **Priority** (`Low`, `Med`, `High`), **Importance** (`Normal`, `⭐ Important`, `🔥 Urgent`), and **Due Date/Time** for desktop reminder notifications.
  - **Drag-and-Drop Kanban:** Move projects across `Active`, `On Hold`, and `Done`.
- **Follow-up Reminders:**
  - Create contact-linked or general reminders with date/time and receive desktop notifications.
- **Templates & Quick Replies:**
  - Create reusable message templates with WhatsApp formatting (`*bold*`, `_italic_`, `~strike~`, `` `code` ``), emoji picker, and live preview.
  - **Vertical Quick Replies:** One-click color-coded chips that insert text directly into the WhatsApp composer.
- **Backup & Restore:**
  - **Automatic encrypted backups** in **Settings → Data**: point Dona Bridge at a
    OneDrive / Google Drive / Mega sync folder or an external drive, choose an
    interval (6 h, 12 h, 24 h, weekly) and a retention count. Files are encrypted
    with AES-256-GCM **before** they reach the folder; a recovery code is shown
    once configured and is the password used to restore them on another PC.
  - **WebDAV cloud backup**: upload the same encrypted backup to a Nextcloud, ownCloud, HiDrive or NAS WebDAV folder on a schedule (or “Back up now”). Files are encrypted before they leave the PC, the newest 7–30 are kept on the server, and the password is stored in Windows Credential Manager.
  - **Full manual encrypted backup**: a password-protected `.donabk` file containing every account, CRM record, template and setting. AES-256-GCM with an Argon2id-derived key; portable between PCs (scan the WhatsApp QR code again on the new machine).
  - **CRM data portability**: export the whole CRM (contacts, tags, notes, reminders, templates, pipelines, deals, custom fields, tasks) as one JSON file and import it on another PC — a safety snapshot is taken first. Deals and tasks also export per account as CSV for Excel or Sheets.
  - **Storage & health** panel shows the database size, WebView2 profile size, account/group counts and opens the data or log folder for support.
- **Integrations (Settings → Integrations):**
  - **Outbound webhooks** send `contact.*`, `deal.*` and `task.*` events to n8n, Zapier, Make or your own endpoint. Nothing is sent until you enable it.
  - Every delivery is signed with **HMAC-SHA256** over `timestamp.body` and carries `X-Dona-Event`, `X-Dona-Timestamp`, `X-Dona-Signature` and `X-Dona-Delivery` headers; there is a “Send test delivery” button and the last status is shown. The signing secret is stored in Windows Credential Manager and can be revealed or rotated.
  - **Read-only local API** for scripts and dashboards: `GET /v1/accounts`, `/v1/contacts`, `/v1/contacts/{id}/timeline`, `/v1/deals`, `/v1/tasks`, `/v1/report`, `/v1/templates` and `/v1/health` on `http://127.0.0.1:8787/v1`. It is off by default, bound to loopback only, GET-only and requires `Authorization: Bearer <token>`; the token lives in Credential Manager and can be revealed or rotated.

### 3. Draft-Only AI Copilot (Optional)
- Supports **Ollama** (100% offline/local) as well as **OpenAI**, **Anthropic**, **DeepSeek**, **Kimi**, **OpenRouter**, or any custom OpenAI-compatible API.
- **Strict Draft-Only Policy:** AI suggestions only insert text into the WhatsApp message box — **Dona Bridge never automatically sends messages or clicks Send.**
- **Signed per account:** drafts are prepared on behalf of the active account and signed with that account's name, never with the application name.
- **Auto-read the open chat (opt-in):** with the eye toggle enabled in the Copilot tab, a new message in the chat you already have open reloads its last 20 messages so a draft can be prepared. It never reads a background chat, never changes read receipts, and never sends.

### 4. Themes & Languages
- **WhatsApp palette:** the whole app uses WhatsApp's colours (`#0B141A` / `#111B21` / `#202C33` dark, `#F0F2F5` / `#FFFFFF` / `#E9EDEF` light) with the signature teal accent (`#00A884`).
- Toggle between Dark Mode and Light Mode anytime from the CRM header (`☀️` / `🌙`) or **Settings → General → Theme**. Light mode has full contrast-corrected text, inputs, buttons and status banners.
- Available in **English**, **বাংলা (Bengali)**, and **Français (French)**.

---

## 🛡️ WhatsApp Policy & Safety Compliance

Dona Bridge is built to respect WhatsApp's Terms of Service:
1. **Official Web Client Only:** Loads `https://web.whatsapp.com` inside standard WebView2 containers — no unofficial protocol reverse-engineering.
2. **No Automation / No Bulk Sending:** No auto-responder, no bulk broadcaster, and no automated message sending. Every message is reviewed and sent manually by you.
3. **100% Local Storage:** Contacts, notes, projects, and API keys stay on your device (SQLite + Windows Credential Manager).

---

## 🧭 Where your data lives

| Path | Contents |
|---|---|
| `%LOCALAPPDATA%\com.makahar.donabridge\dona.db` | Accounts, CRM contacts, notes, reminders, templates, settings |
| `%LOCALAPPDATA%\com.makahar.donabridge\WebView2\` | One isolated WhatsApp session per account |
| `%LOCALAPPDATA%\com.makahar.donabridge\logs\` | Daily logs (`dona-bridge.log`) |

Upgrading from an older build that kept the database in `%APPDATA%` is handled
automatically: the database is copied once to the new location on first start.

## 🩺 If accounts do not appear

Dona Bridge **never deletes accounts because a read failed**. If the local
database is locked (antivirus scan, OneDrive sync, a leftover process) the app
shows a “Could not open your accounts” screen with a **Retry** button instead of
the first-run setup screen. Check the log file above for the exact error.

### Automatic recovery

- The database is checked on every start. A damaged file is **quarantined** (kept
  in `backups\corrupt-…`) and the newest valid automatic snapshot is restored.
- Snapshots are written at startup, every 6 hours and on a clean exit; the
  newest 14 are kept in `%LOCALAPPDATA%\com.makahar.donabridge\backups`.
- If Windows or the app was killed, the next start shows a **Recovery** dialog
  explaining what happened, with a one-click restore of the latest snapshot.
- **Settings → Data → Recovery & safety** shows the database integrity, the
  snapshot list, and can export a diagnostics bundle (logs + health) for support.
- A UI error shows a recovery screen (Reload / Open logs / Export diagnostics)
  instead of a blank window.

---

## 🛠️ Build from Source (Developers)

### Prerequisites
- [Node.js](https://nodejs.org/) (v20+) & `pnpm`
- [Rust](https://www.rust-lang.org/tools/install) (stable MSVC toolchain on Windows)
- Microsoft Edge WebView2 Runtime (pre-installed on Windows 10/11)

### Commands
```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Type-check and run tests
pnpm tsc --noEmit
pnpm test --run

# Build production installer
pnpm tauri build
```

> **Note for OneDrive / synced folders:** Windows Controlled Folder Access can
> block the esbuild binary from writing its cache inside `node_modules`, which
> makes Vite fail with “Access is denied”. `pnpm dev` now copies the esbuild
> binary to a local temp folder and moves Vite's dependency cache out of the
> project, so development works from a synced folder without disabling
> security features.

---

## 📄 License

See [LICENSE](LICENSE) for details.
