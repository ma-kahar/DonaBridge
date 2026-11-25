# Dona Bridge

**Dona Bridge** is a fast, lightweight, privacy-first multi-account **WhatsApp Web** desktop client for Windows, built with Tauri, React, TypeScript, and Rust.

> **Disclaimer:** Dona Bridge is an independent desktop wrapper around official WhatsApp Web (`https://web.whatsapp.com`). It is **not affiliated with, endorsed by, or connected to WhatsApp LLC or Meta Platforms, Inc.**

---

## ✨ Key Features

- **Multi-Account Workspace**
  - Run multiple WhatsApp Web accounts side-by-side with isolated sessions (`WebView2` profiles).
  - Custom account colors, categories, unread badges, and per-account or app-wide PIN / Windows Hello lock.
  - Quiet Hours (DND) schedule per account.

- **Built-in Lightweight CRM**
  - **Contacts & Pipeline:** Add, search, pin (`📌`), tag, and organize contacts in List or drag-and-drop **Kanban** view.
  - **In-App Chat Launch:** Open any contact's chat directly inside the app's active WhatsApp Web view.
  - **Projects & Tasks:** Track client projects with progress bars, categories, priority/importance levels, drag-and-drop Kanban, and desktop task due reminders.
  - **Follow-up Reminders:** Schedule reminders linked to contacts or general tasks with desktop notifications.
  - **Templates & Quick Replies:** Reusable message templates with WhatsApp formatting (`*bold*`, `_italic_`, `~strike~`, `` `code` ``), emoji picker, and vertical quick-reply chips.
  - **CSV & JSON Backup:** Import/export contacts via CSV and back up/restore workspace data via JSON.

- **Draft-Only AI Copilot (Optional)**
  - Supports local models (**Ollama**) or your own API key (**OpenAI**, **Anthropic**, **DeepSeek**, **Kimi**, **OpenRouter**, or custom OpenAI-compatible endpoints).
  - **Strict Draft-Only Policy:** AI suggestions only insert text into the composer box — **Dona Bridge never automatically sends messages or clicks Send.**

- **Modern UI**
  - Expandable CRM drawer (sidebar or full-width).
  - **Dark Mode** and **Light Mode** toggle.
  - Multi-language support (English, Bengali, French).

---

## 🛡️ WhatsApp Policy & Safety Compliance

Dona Bridge is designed to respect WhatsApp's Terms of Service:
1. **Official Web Client Only:** Uses the official `https://web.whatsapp.com` interface inside isolated WebView2 containers — no unofficial protocol reverse-engineering.
2. **No Automation / No Bulk Sending:** There is no auto-responder, bulk broadcaster, or automated message sender. Every message is reviewed and sent manually by you.
3. **100% Local Data:** Your contacts, notes, projects, and credentials stay on your own device (SQLite + OS Credential Manager).

---

## 🚀 Getting Started

### For Users (Windows Installer)
1. Download the latest `Dona Bridge_x.x.x_x64-setup.exe` from the **Releases** page.
2. Run the installer. Upgrading to a newer version preserves your existing accounts and CRM data.
3. Click **+ Add Account**, give it a name, and scan the WhatsApp Web QR code.

### For Developers (Build from Source)

#### Prerequisites
- [Node.js](https://nodejs.org/) (v20+) & `pnpm`
- [Rust](https://www.rust-lang.org/tools/install) (stable MSVC toolchain on Windows)
- WebView2 Runtime (pre-installed on Windows 10/11)

#### Commands
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

---

## 📄 License

See [LICENSE](LICENSE) for details.
