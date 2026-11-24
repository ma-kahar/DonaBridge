// Dona Bridge — Tauri entry point
// HARD RULES (see CLAUDE.md):
//   • Never press Send or simulate Enter in the WhatsApp message box
//   • WhatsApp webviews get only the wa-remote capability (5 report-only commands)
//   • Secrets live in Windows Credential Manager, never in files
//   • All webview-creating commands must be async

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dona_bridge_lib::run();
}
