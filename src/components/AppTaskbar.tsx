import {
  Check,
  ChevronDown,
  Lock,
  PanelRightOpen,
  Pencil,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Account, useAppStore } from "../store";

interface AppTaskbarProps {
  crmOpen: boolean;
  onToggleCrm: () => void;
  onOpenPalette: () => void;
  onAddAccount: () => void;
  onOpenSettings: () => void;
  onLockApp: () => void;
  onSelectAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
}

function Avatar({ account, size = 28 }: { account: Account; size?: number }) {
  const groups = useAppStore((s) => s.groups);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const groupColor = groups.find((g) => g.id === account.groupId)?.color;
  const loggedOut = sessionStates[account.id] === "logged_out";

  return (
    <span
      className="relative rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        backgroundColor: account.color,
        outline: groupColor ? `2px solid ${groupColor}` : undefined,
        outlineOffset: "1px",
      }}
    >
      {account.avatarDataUrl ? (
        <img
          src={account.avatarDataUrl}
          alt={account.name}
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        account.iconText || account.name[0]
      )}
      {loggedOut && (
        <span className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-dona-panel2" />
      )}
      {account.unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
          {account.unreadCount > 99 ? "99+" : account.unreadCount}
        </span>
      )}
    </span>
  );
}

export default function AppTaskbar({
  crmOpen,
  onToggleCrm,
  onOpenPalette,
  onAddAccount,
  onOpenSettings,
  onLockApp,
  onSelectAccount,
  onEditAccount,
}: AppTaskbarProps) {
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = accounts.find((a) => a.id === activeAccountId) ?? accounts[0] ?? null;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [menuOpen]);

  return (
    <div
      ref={rootRef}
      className="relative h-12 shrink-0 border-t border-dona-border bg-dona-panel2 px-3 flex items-center gap-2"
    >
      {/* Account switcher */}
      <button
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
        className="flex items-center gap-2 rounded-xl px-2 py-1 hover:bg-dona-panel transition-colors shrink-0"
        aria-label="Switch account"
        title="Switch account"
      >
        {active ? (
          <Avatar account={active} size={28} />
        ) : (
          <span className="w-7 h-7 rounded-full bg-dona-panel border border-dona-border" />
        )}
        <span className="text-xs font-semibold text-dona-fg max-w-[150px] truncate hidden sm:inline">
          {active?.name ?? "Add account"}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-dona-muted" />
      </button>

      <div className="h-6 w-px bg-dona-border shrink-0" />

      <button
        type="button"
        onClick={onToggleCrm}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors shrink-0 ${
          crmOpen
            ? "bg-dona-accent text-white"
            : "text-dona-muted hover:bg-dona-panel hover:text-dona-fg"
        }`}
        title="Open the CRM"
        aria-label="CRM"
      >
        <PanelRightOpen className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">CRM</span>
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-dona-muted hover:bg-dona-panel hover:text-dona-fg transition-colors shrink-0"
        title="Search (Ctrl+K)"
        aria-label="Search"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search</span>
      </button>

      <button
        type="button"
        onClick={onAddAccount}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-dona-muted hover:bg-dona-panel hover:text-dona-fg transition-colors shrink-0"
        title="Add account"
        aria-label="Add account"
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Add</span>
      </button>

      <button
        type="button"
        onClick={onLockApp}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-dona-muted hover:bg-dona-panel hover:text-dona-fg transition-colors shrink-0"
        title="Lock the app"
        aria-label="Lock app"
      >
        <Lock className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Lock</span>
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-dona-muted hover:bg-dona-panel hover:text-dona-fg transition-colors shrink-0"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Settings</span>
      </button>

      <div className="ml-auto flex items-center gap-3 pl-2 shrink-0">
        <span className="flex items-center gap-1.5 text-[10px] text-dona-muted">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="hidden md:inline">Online</span>
          <ChevronDown className="w-3 h-3" />
        </span>
        <span className="w-px h-4 bg-dona-border" />
        <span className="text-[10px] text-dona-faint hidden md:inline">Dona Bridge</span>
      </div>

      {menuOpen && (
        <div className="absolute bottom-12 left-3 z-50 w-72 rounded-2xl border border-dona-border bg-dona-panel p-1.5 shadow-2xl shadow-black/30">
          <p className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider text-dona-muted">
            Accounts
          </p>
          {accounts.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-dona-muted">No accounts yet.</p>
          )}
          {accounts.map((account) => (
            <div
              key={account.id}
              className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-dona-panel2"
            >
              <button
                type="button"
                onClick={() => {
                  onSelectAccount(account);
                  setMenuOpen(false);
                }}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <Avatar account={account} size={26} />
                <span className="text-xs text-dona-fg truncate flex-1">{account.name}</span>
                {account.id === activeAccountId && (
                  <Check className="w-3.5 h-3.5 text-dona-accent shrink-0" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  onEditAccount(account);
                  setMenuOpen(false);
                }}
                className="text-dona-muted hover:text-dona-fg shrink-0"
                title="Edit account"
                aria-label={`Edit ${account.name}`}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <div className="border-t border-dona-border mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                onAddAccount();
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs text-dona-accent hover:bg-dona-panel2"
            >
              <Plus className="w-3.5 h-3.5" />
              Add account
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
