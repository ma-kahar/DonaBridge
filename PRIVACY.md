# Privacy Policy

**Dona Bridge stores everything locally on your PC. No data is sent anywhere by default.**

## What stays local

- WhatsApp sessions (WebView2 profiles in `%LOCALAPPDATA%\org.donabridge.desktop\WebView2\`)
- CRM contacts, notes, tags, reminders (`%APPDATA%\org.donabridge.desktop\dona.db`)
- Avatars and screenshots (`%APPDATA%\org.donabridge.desktop\avatars\`, `captures\`)
- API keys and tokens (Windows Credential Manager — never in files)

## What leaves your PC (only when you choose)

- **Cloud AI:** If you configure OpenAI, Anthropic or OpenRouter, the last 20 messages of the open chat are sent to that provider when you click "Suggest reply". A consent notice appears before the first request. Phone numbers and emails can be redacted automatically (v1.1).
- **Auto-update check:** Dona Bridge checks `github.com/ma-kahar/dona-bridge/releases/latest` for updates. No personal data is sent.

## GDPR

CRM data (names, phone numbers, notes) are personal data under GDPR. You can export or delete any contact at any time. There is no server holding your data — delete the app and the data is gone.

## No telemetry

Dona Bridge collects no usage statistics, crash reports, or analytics by default.
