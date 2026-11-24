## Summary

<!-- Describe what this PR changes and why -->

## WhatsApp Compliance Checklist (Required)

- [ ] No code presses Send, clicks Send, or simulates Enter in the WhatsApp message box
- [ ] No protocol emulation or unofficial WhatsApp libraries (`baileys`, `whatsapp-web.js`, etc.)
- [ ] No background reading of chats; chat reading happens only on explicit user click
- [ ] No bulk, scheduled, broadcast, or auto-reply features
- [ ] Any DOM selector changes are strictly inside `src-tauri/src/webviews/selectors.json`
- [ ] All UI strings use `react-i18next` (`en`, `fr`, `bn`)

## Verification

- [ ] `cargo fmt --check` & `cargo clippy --workspace -- -D warnings` pass
- [ ] `cargo test --workspace` passes
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass
