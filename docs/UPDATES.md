# Auto-updates

Dona Bridge uses the official Tauri updater. The code and UI are already wired
(Settings → General → Check for updates); four one-time steps activate it.

## 1. Generate a signing key

Run once, on your build machine:

```bash
pnpm tauri signer generate -w ~/.tauri/dona-bridge.key
```

Keep `dona-bridge.key` **private** and back it up. Losing it means installed
copies cannot verify future updates.

The command prints the public key (also stored in
`dona-bridge.key.pub`). Copy the whole base64 value.

## 2. Configure the endpoint and public key

Add this to `src-tauri/tauri.conf.json` (top-level `plugins` object):

```json
"plugins": {
  "updater": {
    "pubkey": "<PASTE_PUBLIC_KEY_HERE>",
    "endpoints": [
      "https://github.com/ma-kahar/DonaBridge/releases/latest/download/latest.json"
    ]
  }
}
```

`bundle.createUpdaterArtifacts` must be enabled for release builds. Add it to
`src-tauri/tauri.conf.json` inside `bundle` **only after** the signing key exists
(Tauri refuses to build with this flag and no `TAURI_SIGNING_PRIVATE_KEY`):

```json
"createUpdaterArtifacts": true
```

Every release build then produces `latest.json` and the `.sig` files used by the
updater.

Without this configuration the app still runs; the Check button reports
“Update server is not configured in this build.”

## 3. Add the signing secrets to GitHub

In the repository settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the contents of `dona-bridge.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password chosen when generating the key |

The release workflow already builds with `pnpm tauri build`; with the secrets
present, Tauri signs the updater artifacts automatically.

## 4. Publish a release

1. Bump `version` in `Cargo.toml` (workspace) and `src-tauri/tauri.conf.json`.
2. Commit and tag (`git tag v0.2.0 && git push --tags`).
3. Upload the installer, `latest.json` and the `.sig` files to the release.

Existing installs check the endpoint on demand (and when the user opens
Settings → Data). A future version can also check once a day at startup.

## Notes

- Updates never touch `%LOCALAPPDATA%\com.makahar.donabridge` (database,
  WebView2 sessions, logs). The NSIS uninstall hook explicitly skips data
  deletion during updates.
- The updater only accepts artifacts signed with the matching private key.
