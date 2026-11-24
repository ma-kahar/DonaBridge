// webviews/init_script.rs
// Builds the JavaScript init script injected into every wa_* webview.
//
// Rules:
//   • Build with serde_json::to_string for values — NEVER string templates
//   • No custom CSS on WhatsApp pages (only privacy blur overlay is allowed)
//   • No send, no auto-reply, no background reading
//   • Forward shortcut keys to the wa_shortcut command
//   • Watch document.title with MutationObserver for unread count
//   • Hook window.Notification so Windows native toast notifications fire

/// Build the init script for a WhatsApp webview.
pub fn build_init_script(account_id: &str) -> String {
    let account_id_json =
        serde_json::to_string(account_id).expect("account_id must be serializable");

    format!(
        r#"
(function() {{
    'use strict';
    const ACCOUNT_ID = {account_id_json};

    // ── Unread count via document.title ────────────────────────────────────
    function reportUnread() {{
        const match = document.title.match(/^\((\d+)\)/);
        const count = match ? parseInt(match[1], 10) : 0;
        window.__TAURI_INTERNALS__.invoke('wa_unread', {{ count }}).catch(() => {{}});
    }}
    const titleEl = document.querySelector('title') || document.head;
    if (titleEl) {{
        new MutationObserver(reportUnread).observe(
            titleEl,
            {{ subtree: true, characterData: true, childList: true }}
        );
    }}
    reportUnread();

    // ── Forward Web Notifications to Windows native toast ──────────────────
    const NativeNotification = window.Notification;
    if (NativeNotification) {{
        function DonaNotification(title, options) {{
            const body = (options && options.body) ? String(options.body) : '';
            window.__TAURI_INTERNALS__.invoke('wa_notify', {{
                title: String(title || 'Dona Bridge'),
                body
            }}).catch(() => {{}});
            return new NativeNotification(title, options);
        }}
        DonaNotification.prototype = NativeNotification.prototype;
        Object.defineProperty(DonaNotification, 'permission', {{
            get: () => 'granted'
        }});
        DonaNotification.requestPermission = () => Promise.resolve('granted');
        window.Notification = DonaNotification;
    }}

    // ── Shortcut key forwarder ─────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {{
        if (!e.ctrlKey) return;
        const key = [
            e.ctrlKey  ? 'Ctrl'  : '',
            e.shiftKey ? 'Shift' : '',
            e.key
        ].filter(Boolean).join('+');
        const shortcuts = ['Ctrl+k','Ctrl+b','Ctrl+Shift+x',
            'Ctrl+1','Ctrl+2','Ctrl+3','Ctrl+4','Ctrl+5',
            'Ctrl+6','Ctrl+7','Ctrl+8','Ctrl+9'];
        if (shortcuts.includes(key.toLowerCase())) {{
            e.preventDefault();
            window.__TAURI_INTERNALS__.invoke('wa_shortcut', {{ key }}).catch(() => {{}});
        }}
    }});

    // ── Privacy blur overlay ───────────────────────────────────────────────
    let blurOverlay = null;
    window.addEventListener('dona:set-blur', (e) => {{
        if (e.detail.enabled) {{
            if (!blurOverlay) {{
                blurOverlay = document.createElement('div');
                blurOverlay.id = 'dona-blur-overlay';
                blurOverlay.style.cssText =
                    'position:fixed;inset:0;backdrop-filter:blur(20px);z-index:99999;pointer-events:none;';
                document.body.appendChild(blurOverlay);
            }}
        }} else if (blurOverlay) {{
            blurOverlay.remove();
            blurOverlay = null;
        }}
    }});
}})();
"#,
        account_id_json = account_id_json
    )
}
