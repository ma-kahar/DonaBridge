import { Lock, PanelRightOpen, Plus, Search, Settings } from "lucide-react";
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
  const groups = useAppStore((s) => s.groups);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const unreadTotal = accounts.reduce((sum, a) => sum + a.unreadCount, 0);

  return (
    <div className="h-12 shrink-0 border-t border-dona-border bg-dona-panel2 px-2 flex items-center gap-1 overflow-x-auto">
      {/* Account switcher, like a Windows taskbar */}
      <div className="flex items-center gap-2 px-1 overflow-x-auto">
        {accounts.map((account) => {
          const groupColor = groups.find((g) => g.id === account.groupId)?.color;
          const loggedOut = sessionStates[account.id] === "logged_out";
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onSelectAccount(account)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditAccount(account);
              }}
              title={`${account.name}${loggedOut ? " — session logged out" : ""} (right-click to edit)`}
              style={{
                backgroundColor: account.color,
                outline: groupColor ? `2px solid ${groupColor}` : undefined,
                outlineOffset: "1px",
              }}
              className={`relative w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 shadow-md shadow-black/25 transition-all ${
                account.id === activeAccountId
                  ? "ring-2 ring-dona-accent scale-105"
                  : "opacity-75 hover:opacity-100"
              }`}
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
              {account.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
                  {account.unreadCount > 99 ? "99+" : account.unreadCount}
                </span>
              )}
              {loggedOut && (
                <span className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-dona-panel2" />
              )}
            </button>
          );
        })}
      </div>

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

      <div className="ml-auto flex items-center gap-2 pl-2 shrink-0">
        {unreadTotal > 0 && (
          <span className="text-[10px] text-dona-muted">{unreadTotal} unread</span>
        )}
        <span className="text-[10px] text-dona-faint hidden lg:inline">Dona Bridge</span>
      </div>
    </div>
  );
}
