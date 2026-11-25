# Contributing to Dona Bridge

Thank you for your interest! Before opening a PR, read the rules below.

## Hard Rules (PRs that break these are closed)

1. **No code may press Send**, call a send API, or simulate Enter in the message box.
2. **No protocol emulation** — no Baileys, no whatsapp-web.js, no unofficial WhatsApp libraries.
3. **No reading chats** in the background or without an explicit user click.
4. **No bulk, scheduled, broadcast or auto-reply features** — these are permanently out of scope.
5. **DOM selectors** live only in `src-tauri/src/webviews/selectors.json`.

## PR Checklist

- [ ] I have read the compliance rules above
- [ ] My code does not add any send, auto-reply, bulk, or scheduled messaging feature
- [ ] All UI strings go through `react-i18next` (en, fr, bn)
- [ ] `cargo fmt`, `cargo clippy -D warnings`, `cargo test --workspace` all pass
- [ ] `tsc --noEmit` and `pnpm vitest run` pass

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/) — see `CODE_OF_CONDUCT.md`.
