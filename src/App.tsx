import { listen } from "@tauri-apps/api/event";
import { Lock, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AccountDock from "./features/accounts/AccountDock";
import AddAccountModal from "./features/accounts/AddAccountModal";
import CrmDrawer from "./features/crm/CrmDrawer";
import LockScreen from "./features/lock/LockScreen";
import SettingsModal from "./features/settings/SettingsModal";
import {
  accountVerifyPin,
  crmSetDrawerOpen,
  isTauri,
  listAccounts,
  prewarmAccounts,
  securityLockApp,
  securityLockStatus,
  setOverlayOpen,
  switchAccount,
} from "./lib/ipc";
import { type Account, useAppStore } from "./store";

export default function App() {
  const { t } = useTranslation();
  const { accounts, activeAccountId, setAccounts, setActiveAccount, updateUnread } = useAppStore();
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

  // Hide native wa_* WebView2 child when any React modal/lock overlay is open
  const overlayOpen = addOpen || settingsOpen || locked || pendingUnlockAccount !== null;
  useEffect(() => {
    void setOverlayOpen(overlayOpen, activeAccountId);
  }, [overlayOpen, activeAccountId]);

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

    const loadSavedAccounts = (attempt = 0) => {
      listAccounts()
        .then((list) => {
          if (cancelled || list.length === 0) return;
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
          }));
          setAccounts(mapped);
          const firstUnlocked = mapped.find((a) => !a.hasLock) ?? mapped[0];
          if (!firstUnlocked.hasLock) {
            setActiveAccount(firstUnlocked.id);
            void switchAccount(firstUnlocked.id);
          }
          void prewarmAccounts(firstUnlocked.hasLock ? null : firstUnlocked.id);
        })
        .catch(() => {
          if (!cancelled && attempt < 3) {
            setTimeout(() => loadSavedAccounts(attempt + 1), 500);
          }
        });
    };
    loadSavedAccounts();
    return () => {
      cancelled = true;
    };
  }, [setAccounts, setActiveAccount]);

  // Listen to unread, shortcut & chat-context events forwarded from wa_* webviews
  useEffect(() => {
    if (!isTauri()) return;
    const unlistenUnread = listen<{ account_id: string; count: number }>("wa:unread", (event) => {
      updateUnread(event.payload.account_id, event.payload.count);
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

  return (
    <div className="flex h-screen bg-dona-dark text-white overflow-hidden">
      {/* Left sidebar — account dock */}
      <AccountDock
        onSelectAccount={handleSelectAccount}
        onEditAccount={(acc) => {
          setEditingAccount(acc);
          setAddOpen(true);
        }}
        onAddClick={() => {
          setEditingAccount(null);
          setAddOpen(true);
        }}
        onToggleCrm={() => setCrmOpen((prev) => !prev)}
        onOpenSettings={() => setSettingsOpen(true)}
        onLockApp={() => void handleLockApp()}
        crmOpen={crmOpen}
      />

      {/* Main area — WhatsApp webview renders over this region when an account is active */}
      <main className="flex-1 flex items-center justify-center bg-dona-panel">
        {accounts.length === 0 ? (
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
    </div>
  );
}
