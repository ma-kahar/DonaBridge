# Privacy-safe interface screenshots

Dona Bridge normally shows real WhatsApp conversations, so a regular screenshot
can expose names, phone numbers and message content. Use **demo mode** instead:
it runs the real UI against a throwaway data folder and replaces WhatsApp with a
bundled, fully fictional chat page.

Nothing in demo mode touches your real profile, database or WhatsApp sessions.

## How it works

| Setting | Effect |
| --- | --- |
| `DONA_DATA_DIR` | Moves the database, WebView2 profiles, backups and download history to the given folder. |
| `DONA_DEMO=1` | Loads `public/demo/whatsapp.html` (sample conversations, "Demo workspace" label) instead of `web.whatsapp.com`, and keeps the Downloads panel on `C:\Users\Public\Downloads\Dona Bridge`. |

## Step by step (Windows)

1. Create a folder for the demo profile, for example:

   ```powershell
   New-Item -ItemType Directory "C:\Users\Public\Dona Bridge Demo" -Force
   ```

2. Start the installed app once with the demo data folder so the database and
   WebView2 profiles are created, then close it:

   ```powershell
   $env:DONA_DATA_DIR = "C:\Users\Public\Dona Bridge Demo"
   & "$env:LOCALAPPDATA\Dona Bridge\dona-bridge.exe"
   ```

3. Fill the demo database with fictional accounts, contacts, deals, tasks and
   activities:

   ```powershell
   python scripts/seed-demo-data.py "C:\Users\Public\Dona Bridge Demo\dona.db"
   ```

   The script refuses to run unless the database path contains `demo`.

4. Start it again with demo mode enabled:

   ```powershell
   $env:DONA_DATA_DIR = "C:\Users\Public\Dona Bridge Demo"
   $env:DONA_DEMO = "1"
   & "$env:LOCALAPPDATA\Dona Bridge\dona-bridge.exe"
   ```

5. Take the screenshots you need (Win+Shift+S, Snipping Tool, or any capture
   tool). Good shots:

   - main window in light mode with the CRM drawer open;
   - CRM → Pipeline, Tasks and Reports (use the expand button for full width);
   - Settings → General (theme selector) and Settings → About;
   - Downloads with the fake files;
   - account switcher (crop the menu, the page behind it is hidden by design);
   - dark mode, if you want to show both themes.

6. Remove the demo profile when you are done. It contains no real data:

   ```powershell
   Remove-Item "C:\Users\Public\Dona Bridge Demo" -Recurse -Force
   ```

7. Start Dona Bridge normally again (without the environment variables). Your
   real profile is untouched.

## Privacy checklist

- The demo chat page is bundled and fictional; no WhatsApp account is signed in.
- The seeded names, phone numbers (`+1 555 01xx`), deals and messages are made up.
- The "Demo workspace - sample conversations only" label in the chat sidebar makes
  the context obvious.
- Download paths use the public folder, never your Windows user name.
- Turn on **Focus assist / Do not disturb** while capturing so Windows toasts do
  not end up in the image.
- If you want a physically separate environment, repeat the steps under a second
  Windows user account.

## Notes for developers

`DONA_DATA_DIR` is also handy for testing migrations, recovery and upgrades
without touching your day-to-day profile. Demo mode is opt-in and has no effect
unless the environment variable is set.
