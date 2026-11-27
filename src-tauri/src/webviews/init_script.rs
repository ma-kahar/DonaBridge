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

    // ── Microphone bridge (WDM-KS fallback) ───────────────────────────
    // Windows exposes this Huawei/Intel microphone only through kernel
    // streaming; WASAPI (used by WebView2) returns 0x8000FFFF. Capture it
    // natively and expose the PCM as a normal MediaStream to WhatsApp.
    (function () {{
        const md = navigator.mediaDevices;
        if (!md || typeof md.getUserMedia !== 'function') return;
        if (typeof MediaStreamTrackGenerator !== 'function' ||
            typeof AudioData !== 'function') return;

        const original = md.getUserMedia.bind(md);
        const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
        let permission = null;
        let captureRefs = 0;
        let unlisten = null;
        const sinks = new Set();

        async function listenPcm(handler) {{
            const handlerId = window.__TAURI_INTERNALS__.transformCallback(handler);
            const eventId = await invoke('plugin:event|listen', {{
                event: 'mic://pcm',
                target: {{ kind: 'Any' }},
                handler: handlerId
            }});
            return () => {{
                invoke('plugin:event|unlisten', {{ event: 'mic://pcm', eventId }}).catch(() => {{}});
            }};
        }}

        async function begin() {{
            if (captureRefs === 0) {{
                unlisten = await listenPcm((event) => {{
                    const b64 = event && event.payload;
                    if (typeof b64 !== 'string' || !b64) return;
                    let bin;
                    try {{ bin = atob(b64); }} catch (e) {{ return; }}
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    for (const sink of sinks) sink.push(bytes);
                }});
                try {{
                    await invoke('mic_start');
                }} catch (e) {{
                    if (unlisten) {{ unlisten(); unlisten = null; }}
                    throw e;
                }}
            }}
            captureRefs++;
        }}

        async function end() {{
            captureRefs = Math.max(0, captureRefs - 1);
            if (captureRefs === 0) {{
                if (unlisten) {{ unlisten(); unlisten = null; }}
                try {{ await invoke('mic_stop'); }} catch (e) {{}}
            }}
        }}

        md.getUserMedia = async function (constraints) {{
            if (!constraints || !constraints.audio) return original(constraints);
            // Video calls keep the native camera path; voice notes get the bridge.
            if (constraints.video) return original(constraints);
            try {{
                if (permission !== 'allow') {{
                    const ok = await invoke('mic_permission');
                    if (!ok) throw new DOMException('Permission denied', 'NotAllowedError');
                    permission = 'allow';
                }}
                await begin();
            }} catch (e) {{
                // Bridge unavailable (or permission denied): use the native path.
                if (e && e.name === 'NotAllowedError') throw e;
                return original(constraints);
            }}

            const generator = new MediaStreamTrackGenerator({{ kind: 'audio' }});
            const writer = generator.writable.getWriter();
            const queue = [];
            let writing = false;
            let timestamp = 0;

            async function pump() {{
                if (writing) return;
                writing = true;
                try {{
                    while (queue.length) {{
                        const bytes = queue.shift();
                        const frames = Math.floor(bytes.length / 2);
                        if (!frames) continue;
                        try {{
                            const data = new AudioData({{
                                format: 's16',
                                sampleRate: 48000,
                                numberOfFrames: frames,
                                numberOfChannels: 1,
                                timestamp,
                                data: bytes.buffer
                            }});
                            timestamp += Math.round((frames * 1000000) / 48000);
                            await writer.write(data);
                        }} catch (e) {{}}
                    }}
                }} finally {{
                    writing = false;
                }}
            }}

            const sink = {{
                push(bytes) {{
                    queue.push(bytes);
                    if (queue.length > 20) queue.shift();
                    void pump();
                }}
            }};
            sinks.add(sink);

            const stream = new MediaStream([generator]);
            const track = stream.getAudioTracks()[0];
            try {{
                Object.defineProperty(track, 'getSettings', {{
                    value: () => ({{
                        deviceId: 'default',
                        groupId: 'dona',
                        sampleRate: 48000,
                        channelCount: 1,
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }})
                }});
            }} catch (e) {{}}

            let cleaned = false;
            let limit = null;
            const cleanup = () => {{
                if (cleaned) return;
                cleaned = true;
                if (limit) clearTimeout(limit);
                sinks.delete(sink);
                try {{ writer.close(); }} catch (e) {{}}
                void end();
            }};
            limit = setTimeout(cleanup, 600000);
            track.addEventListener('ended', cleanup, {{ once: true }});
            const watchdog = setInterval(() => {{
                if (track.readyState === 'ended') {{
                    clearInterval(watchdog);
                    cleanup();
                }}
            }}, 1000);
            track.addEventListener('ended', () => clearInterval(watchdog), {{ once: true }});

            return stream;
        }};

        const release = () => {{
            captureRefs = 0;
            if (unlisten) {{ unlisten(); unlisten = null; }}
            invoke('mic_stop').catch(() => {{}});
        }};
        window.addEventListener('pagehide', release);
        window.addEventListener('beforeunload', release);
    }})();

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

    // ── Auto-read incoming messages (when chat is open) ────────────────────
    // Watch for new messages in the active chat and auto-mark as read
    // Compliance: Only reads when chat is open, never in background
    let lastMessageCount = 0;
    function checkForNewMessages() {{
        const msgContainer = document.querySelector('[data-testid="conversation-panel-messages"]');
        if (!msgContainer) return;
        
        const messages = msgContainer.querySelectorAll('[data-testid="msg-container"]');
        const currentCount = messages.length;
        
        if (currentCount > lastMessageCount) {{
            // New message detected - mark chat as read
            window.__TAURI_INTERNALS__.invoke('wa_auto_read', {{
                account_id: ACCOUNT_ID
            }}).catch(() => {{}});
        }}
        lastMessageCount = currentCount;
    }}
    
    // Watch for new messages
    const chatObserver = new MutationObserver(checkForNewMessages);
    function startChatWatch() {{
        const msgContainer = document.querySelector('[data-testid="conversation-panel-messages"]');
        if (msgContainer) {{
            chatObserver.observe(msgContainer, {{ childList: true, subtree: true }});
            checkForNewMessages();
        }}
    }}
    startChatWatch();
    // Re-watch when chat changes
    setInterval(startChatWatch, 2000);

    // ── Session health (connected vs. logged out) ──────────────────────────
    // WhatsApp Web logs a device out on its own after long inactivity or when
    // the user removes it from the phone. Surface that as a "reconnect" badge
    // so a logged-out session never looks like "my account was deleted".
    let lastSessionState = '';
    let pendingSessionState = '';
    let pendingTicks = 0;
    function detectSessionState() {{
        try {{
            if (document.querySelector('#pane-side') ||
                document.querySelector('[data-testid="chat-list"]') ||
                document.querySelector('[aria-label="Chat list"]')) {{
                return 'connected';
            }}
            if (document.querySelector('[data-ref]') ||
                document.querySelector('[data-testid="qrcode"]') ||
                document.querySelector('canvas[aria-label]')) {{
                return 'logged_out';
            }}
            return 'loading';
        }} catch (e) {{
            return 'loading';
        }}
    }}
    function reportSessionState() {{
        const state = detectSessionState();
        if (state === pendingSessionState) {{
            pendingTicks += 1;
        }} else {{
            pendingSessionState = state;
            pendingTicks = 1;
        }}
        // Require two consecutive identical checks so the short "loading"
        // flash while WhatsApp boots is never reported as a logout.
        if (pendingTicks >= 2 && state !== lastSessionState) {{
            lastSessionState = state;
            window.__TAURI_INTERNALS__.invoke('wa_session_state', {{ state }}).catch(() => {{}});
        }}
    }}
    setInterval(reportSessionState, 4000);
    setTimeout(reportSessionState, 3000);

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
