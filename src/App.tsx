import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, Lock, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import AddAccountModal from "./features/accounts/AddAccountModal";
import CrmDrawer from "./features/crm/CrmDrawer";
import LockScreen from "./features/lock/LockScreen";
import SettingsModal from "./features/settings/SettingsModal";
import CommandPalette from "./components/CommandPalette";
import AppTaskbar from "./components/AppTaskbar";
import {
  accountVerifyPin,
  aiReadActiveChat,
  appHealth,
  crmSetDrawerOpen,
  isTauri,
  listAccountGroups,
  listAccounts,
  prewarmAccounts,
  restoreSnapshot,
  securityLockApp,
  securityLockStatus,
  setOverlayOpen,
  switchAccount,
} from "./lib/ipc";
import type { HealthReport } from "./lib/ipc";
import { type Account, type SessionState, useAppStore } from "./store";

export default function App() {
  const { t } = useTranslation();
  const {
    accounts,
    activeAccountId,
    accountsStatus,
    accountsError,
    setAccounts,
    setAccountsStatus,
    setGroups,
    setActiveAccount,
    updateUnread,
  } = useAppStore();
  const [reloadNonce, setReloadNonce] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recovery, setRecovery] = useState<HealthReport | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const lastAutoReadRef = useRef(0);
  const [addOpen, setAddOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmExpanded, setCrmExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [helloAvailable, setHelloAvailable] = useState(false);
  const [pendingUnlockAccount, setPendingUnlockAccount] = useState<Account | null>(null);
  const [accountPinInput, setAccountPinInput] = useState("");
  const [accountPinErr, setAccountPinErr] = useState(false);
  const [chatContext, setChatContext] = useState<{
    accountId: string;
    contact: string;
    messages: string[];
  } | null>(null);

  // Sync CRM drawer open state with Rust WebView2 bounds
  useEffect(() => {
    void crmSetDrawerOpen(crmOpen);
  }, [crmOpen]);

  // Closing the CRM must also leave full-screen mode, otherwise the native
  // WhatsApp webview would stay hidden behind a drawer that is no longer shown.
  useEffect(() => {
    if (!crmOpen) setCrmExpanded(false);
  }, [crmOpen]);

  // Check the recovery state once at startup: an unclean shutdown or a
  // database that was repaired/quarantined should be explained, not ignored.
  useEffect(() => {
    if (!isTauri()) return;
    void appHealth()
      .then((health) => {
        if (health && (health.unclean_shutdown || health.recovery_notice)) {
          setRecovery(health);
        }
      })
      .catch(() => {});
  }, []);

  // Hide native wa_* WebView2 child when any React modal/lock/full-screen CRM
  // overlay is open. The WhatsApp session is a native child window and always
  // paints above HTML, so it must be hidden while the CRM is full-screen.
  const overlayOpen =
    addOpen ||
    settingsOpen ||
    locked ||
    pendingUnlockAccount !== null ||
    paletteOpen ||
    crmExpanded ||
    recovery !== null;
  useEffect(() => {
    void setOverlayOpen(overlayOpen, activeAccountId);
  }, [overlayOpen, activeAccountId]);

  // Global command palette shortcut (Ctrl+K is also forwarded from the
  // WhatsApp webviews through the `wa:shortcut` event).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clear in-memory chat context on account switch
  useEffect(() => {
    if (chatContext && chatContext.accountId !== activeAccountId) {
      setChatContext(null);
    }
  }, [activeAccountId, chatContext]);

  // Check initial lock status & load saved accounts + prewarm background webviews
  useEffect(() => {
    let cancelled = false;
    void securityLockStatus().then((status) => {
      if (cancelled) return;
      if (status.locked) {
        setLocked(true);
      }
      setHelloAvailable(status.hello_available);
    });

    // Never show the "add your first account" onboarding while an existing
    // account list may still be loading. Retry with backoff instead of
    // silently giving up (that is what made a temporary DB lock look like
    // "all my accounts were deleted").
    const loadSavedAccounts = async (attempt: number) => {
      try {
        console.debug(`Loading accounts (reload ${reloadNonce}, attempt ${attempt})`);
        const [list, groupList] = await Promise.all([
          listAccounts(),
          listAccountGroups().catch(() => []),
        ]);
        if (cancelled) return;

        setGroups(
          groupList.map((g) => ({
            id: g.id,
            name: g.name,
            color: g.color,
            sortOrder: g.sort_order,
          }))
        );

        const mapped: Account[] = list.map((a) => ({
          id: a.id,
          name: a.name,
          color: a.color,
          iconText: a.icon_text,
          category: a.category,
          muted: a.muted,
          sortOrder: a.sort_order,
          unreadCount: 0,
          avatarDataUrl: a.avatar_data_url,
          hasLock: a.has_lock,
          groupId: a.group_id ?? null,
        }));
        setAccounts(mapped);
        setAccountsStatus("ready");

        // Only auto-select on the first successful load; a retry or manual
        // refresh must not steal focus from the account the user is on.
        const alreadyActive = useAppStore.getState().activeAccountId;
        const firstUnlocked = mapped.find((a) => !a.hasLock) ?? mapped[0];
        if (!alreadyActive && firstUnlocked && !firstUnlocked.hasLock) {
          setActiveAccount(firstUnlocked.id);
          void switchAccount(firstUnlocked.id);
        }
        void prewarmAccounts(alreadyActive ?? (firstUnlocked?.hasLock ? null : firstUnlocked?.id));
      } catch (err) {
        if (cancelled) return;
        console.error("Could not load accounts:", err);
        if (attempt < 8) {
          window.setTimeout(
            () => void loadSavedAccounts(attempt + 1),
            Math.min(400 * 2 ** attempt, 5000)
          );
        } else {
          setAccountsStatus("error", String(err));
        }
      }
    };

    setAccountsStatus("loading");
    void loadSavedAccounts(0);
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, setAccounts, setActiveAccount, setAccountsStatus, setGroups]);

  // Listen to unread, shortcut & chat-context events forwarded from wa_* webviews
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenUnread = listen<{ account_id: string; count: number }>("wa:unread", (event) => {
      updateUnread(event.payload.account_id, event.payload.count);
    });
    const unlistenSession = listen<{ account_id: string; state: SessionState }>(
      "wa:session",
      (event) => {
        useAppStore.getState().setSessionState(event.payload.account_id, event.payload.state);
      }
    );
    // Auto-read the open chat: when WhatsApp reports a new message in the chat
    // the user already has open, reload its last 20 messages so the Copilot can
    // prepare a draft. It never reads background chats and never sends.
    const unlistenAutoRead = listen<{ account_id: string }>("wa:auto-read", (event) => {
      if (localStorage.getItem("dona_auto_read_open_chat") !== "1") return;
      if (event.payload.account_id !== useAppStore.getState().activeAccountId) return;
      const now = Date.now();
      if (now - lastAutoReadRef.current < 4000) return;
      lastAutoReadRef.current = now;
      void aiReadActiveChat(event.payload.account_id);
    });
    const unlistenShortcut = listen<{ account_id: string; key: string }>("wa:shortcut", (event) => {
      const match = event.payload.key.match(/^Ctrl\+([1-9])$/i);
      if (match) {
        const idx = Number.parseInt(match[1], 10) - 1;
        const target = useAppStore.getState().accounts[idx];
        if (target) {
          setActiveAccount(target.id);
          void switchAccount(target.id);
        }
      } else if (event.payload.key.toLowerCase() === "ctrl+b") {
        setCrmOpen((prev) => !prev);
      } else if (event.payload.key.toLowerCase() === "ctrl+k") {
        setPaletteOpen((prev) => !prev);
      }
    });
    const unlistenContext = listen<{ account_id: string; contact: string; messages: string[] }>(
      "wa:chat-context",
      (event) => {
        if (event.payload.account_id === useAppStore.getState().activeAccountId) {
          setChatContext({
            accountId: event.payload.account_id,
            contact: event.payload.contact,
            messages: event.payload.messages,
          });
        }
      }
    );

    return () => {
      void unlistenUnread.then((fn) => fn());
      void unlistenSession.then((fn) => fn());
      void unlistenAutoRead.then((fn) => fn());
      void unlistenShortcut.then((fn) => fn());
      void unlistenContext.then((fn) => fn());
    };
  }, [setActiveAccount, updateUnread]);

  function handleSelectAccount(account: Account) {
    if (account.hasLock && account.id !== activeAccountId) {
      setPendingUnlockAccount(account);
      setAccountPinInput("");
      setAccountPinErr(false);
      return;
    }
    setActiveAccount(account.id);
    void switchAccount(account.id);
  }

  async function handleUnlockAccount(e: FormEvent) {
    e.preventDefault();
    if (!pendingUnlockAccount) return;
    const ok = await accountVerifyPin(pendingUnlockAccount.id, accountPinInput);
    if (ok) {
      const targetId = pendingUnlockAccount.id;
      setPendingUnlockAccount(null);
      setAccountPinInput("");
      setActiveAccount(targetId);
      void switchAccount(targetId);
    } else {
      setAccountPinErr(true);
    }
  }

  async function handleLockApp() {
    await securityLockApp();
    setLocked(true);
  }

  function handleUnlocked() {
    setLocked(false);
    if (activeAccountId) {
      void switchAccount(activeAccountId);
    }
  }

  async function handleRecoveryRestore() {
    const snapshot = recovery?.snapshots[0];
    if (!snapshot) return;
    const confirmed = window.confirm(
      "Restore the latest automatic snapshot? Current data will be replaced and Dona Bridge will restart. A pre-restore copy is kept in the backups folder."
    );
    if (!confirmed) return;
    setRecoveryBusy(true);
    setRecoveryError(null);
    try {
      await restoreSnapshot(snapshot.path);
    } catch (err) {
      setRecoveryError(String(err));
      setRecoveryBusy(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-dona-dark text-white overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {/* Main area — WhatsApp webview renders over this region when an account is active */}
        <main className="flex-1 flex items-center justify-center bg-dona-panel">
        {accounts.length === 0 && accountsStatus === "loading" ? (
          <div className="text-center space-y-4">
            <div className="w-7 h-7 mx-auto rounded-full border-2 border-white/15 border-t-blue-400 animate-spin" />
            <p className="text-gray-400 text-sm">{t("common.loadingAccounts")}</p>
          </div>
        ) : accounts.length === 0 && accountsStatus === "error" ? (
          <div className="max-w-md text-center space-y-4 px-6">
            <AlertTriangle className="w-10 h-10 mx-auto text-amber-400" />
            <h1 className="text-lg font-semibold text-white">{t("common.loadFailedTitle")}</h1>
            <p className="text-sm text-gray-400 leading-relaxed">{t("common.loadFailedBody")}</p>
            {accountsError && (
              <pre className="text-[11px] text-gray-500 bg-black/30 rounded-lg p-2 overflow-auto max-h-24 text-left whitespace-pre-wrap break-words">
                {accountsError}
              </pre>
            )}
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              {t("common.retry")}
            </button>
            <p className="text-[11px] text-gray-600 break-all">
              {t("common.logHint")} %LOCALAPPDATA%\com.makahar.donabridge\logs
            </p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="text-center space-y-4">
            <div className="text-6xl">🌉</div>
            <h1 className="text-2xl font-bold">{t("app.name")}</h1>
            <p className="text-gray-400">{t("onboarding.addFirstAccount")}</p>
            <button
              type="button"
              onClick={() => {
                setEditingAccount(null);
                setAddOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("accounts.addAccount")}
            </button>
            <p className="text-xs text-gray-600 mt-8">
              Made by Donatek · Not affiliated with WhatsApp or Meta
            </p>
          </div>
        ) : activeAccountId ? (
          <p className="text-gray-500 text-sm">{t("common.loading")}</p>
        ) : (
          <p className="text-gray-400">{t("accounts.selectAccount")}</p>
        )}
      </main>

      {/* Right CRM & Copilot drawer */}
      <CrmDrawer
        open={crmOpen}
        accountId={activeAccountId}
        chatContext={chatContext}
        onClose={() => setCrmOpen(false)}
        expanded={crmExpanded}
        onToggleExpand={() => setCrmExpanded((prev) => !prev)}
      />
      </div>

      {/* Bottom application taskbar */}
      <AppTaskbar
        crmOpen={crmOpen}
        onToggleCrm={() => setCrmOpen((prev) => !prev)}
        onOpenPalette={() => setPaletteOpen(true)}
        onAddAccount={() => {
          setEditingAccount(null);
          setAddOpen(true);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onLockApp={() => void handleLockApp()}
        onSelectAccount={handleSelectAccount}
        onEditAccount={(account) => {
          setEditingAccount(account);
          setAddOpen(true);
        }}
      />

      <AddAccountModal
        open={addOpen}
        editingAccount={editingAccount}
        onClose={() => {
          setAddOpen(false);
          setEditingAccount(null);
        }}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onEditAccount={(acc) => {
          setEditingAccount(acc);
          setAddOpen(true);
        }}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelectAccount={handleSelectAccount}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCrm={() => setCrmOpen(true)}
        onAddAccount={() => {
          setEditingAccount(null);
          setAddOpen(true);
        }}
        onLockApp={() => void handleLockApp()}
        onReloadAccounts={() => setReloadNonce((n) => n + 1)}
      />
      {pendingUnlockAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={handleUnlockAccount}
            className="w-full max-w-xs rounded-xl bg-dona-panel border border-dona-border p-6 space-y-4 text-center"
          >
            <Lock className="w-6 h-6 text-amber-400 mx-auto" />
            <p className="text-sm font-semibold text-white">{pendingUnlockAccount.name}</p>
            <input
              type="password"
              value={accountPinInput}
              onChange={(e) => setAccountPinInput(e.target.value)}
              placeholder={t("lock.pinPlaceholder")}
              className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-center text-white"
            />
            {accountPinErr && <p className="text-xs text-red-400">{t("lock.wrongPin")}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingUnlockAccount(null)}
                className="flex-1 py-2 rounded-lg text-xs text-gray-300 hover:bg-white/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
              >
                {t("lock.unlock")}
              </button>
            </div>
          </form>
        </div>
      )}
      {locked && <LockScreen helloAvailable={helloAvailable} onUnlocked={handleUnlocked} />}

      {recovery && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl bg-dona-panel border border-dona-border p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h2 className="text-base font-semibold text-dona-fg">Recovery</h2>
            </div>
            <p className="text-xs text-dona-muted leading-relaxed break-words">
              {recovery.recovery_notice ??
                "Dona Bridge didn't close normally last time. Committed data is safe."}
            </p>
            {recovery.snapshots[0] && (
              <p className="text-[11px] text-dona-muted">
                Latest automatic snapshot:{" "}
                <span className="text-dona-fg">
                  {recovery.snapshots[0].created_at
                    ? new Date(recovery.snapshots[0].created_at).toLocaleString()
                    : recovery.snapshots[0].path.split("\\").pop()}
                </span>
              </p>
            )}
            {recoveryError && (
              <p className="text-[11px] text-red-400 break-words">{recoveryError}</p>
            )}
            <div className="flex flex-col gap-2">
              {recovery.snapshots[0] && (
                <button
                  type="button"
                  onClick={() => void handleRecoveryRestore()}
                  disabled={recoveryBusy}
                  className="w-full py-2 rounded-lg bg-dona-accent hover:bg-dona-accentHover disabled:opacity-50 text-xs font-medium text-white inline-flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {recoveryBusy ? "Restoring…" : "Restore latest snapshot"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setRecovery(null)}
                className="w-full py-2 rounded-lg border border-dona-border hover:bg-white/5 text-xs text-dona-fg"
              >
                Continue
              </button>
              <button
                type="button"
                onClick={() => {
                  setRecovery(null);
                  setSettingsOpen(true);
                }}
                className="w-full py-2 rounded-lg border border-dona-border hover:bg-white/5 text-xs text-dona-muted"
              >
                Open recovery settings
              </button>
            </div>
            <p className="text-[10px] text-dona-faint">
              Your data stays local. Encrypted backups and automatic snapshots are in Settings →
              Data.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
