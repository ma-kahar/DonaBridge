import {
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { type Account, useAppStore } from "../store";

interface AppTaskbarProps {
  dockCollapsed: boolean;
  onToggleDock: () => void;
  crmOpen: boolean;
  onToggleCrm: () => void;
  onOpenPalette: () => void;
  onAddAccount: () => void;
  onOpenSettings: () => void;
  onLockApp: () => void;
  onSelectAccount: (account: Account) => void;
}

export default function AppTaskbar({
  dockCollapsed,
  onToggleDock,
  crmOpen,
  onToggleCrm,
  onOpenPalette,
  onAddAccount,
  onOpenSettings,
  onLockApp,
  onSelectAccount,
}: AppTaskbarProps) {
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const groups = useAppStore((s) => s.groups);
  const sessionStates = useAppStore((s) => s.sessionStates);
  const unreadTotal = accounts.reduce((sum, a) => sum + a.unreadCount, 0);

  return (
    <div className="h-12 shrink-0 border-t border-dona-border bg-dona-dark/95 backdrop-blur px-2 flex items-center gap-1 overflow-x-auto">
      <button
        type="button"
        onClick={onToggleDock}
        title={dockCollapsed ? "Show the account bar" : "Minimise the account bar"}
        aria-label={dockCollapsed ? "Show the account bar" : "Minimise the account bar"}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
      >
        {dockCollapsed ? (
          <PanelLeftOpen className="w-3.5 h-3.5" />
        ) : (
          <PanelLeftClose className="w-3.5 h-3.5" />
        )}
        <span className="hidden sm:inline">Accounts</span>
      </button>

      <div className="h-6 w-px bg-dona-border shrink-0" />

      {/* Quick account switcher, like a Windows taskbar */}
      <div className="flex items-center gap-1.5 px-1 overflow-x-auto">
        {accounts.map((account) => {
          const groupColor = groups.find((g) => g.id === account.groupId)?.color;
          const loggedOut = sessionStates[account.id] === "logged_out";
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onSelectAccount(account)}
              title={`${account.name}${loggedOut ? " — session logged out" : ""}`}
              style={{
                backgroundColor: account.color,
                outline: groupColor ? `2px solid ${groupColor}` : undefined,
                outlineOffset: "1px",
              }}
              className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 transition-all ${
                account.id === activeAccountId
                  ? "ring-2 ring-white"
                  : "opacity-70 hover:opacity-100"
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
                <span className="absolute -bottom-0.5 -left-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 border-2 border-dona-dark" />
              )}
            </button>
          );
        })}
      </div>

      <div className="h-6 w-px bg-dona-border shrink-0" />

      <button
        type="button"
        onClick={onToggleCrm}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] transition-colors shrink-0 ${
          crmOpen
            ? "bg-blue-600 text-white"
            : "text-gray-300 hover:bg-white/5 hover:text-white"
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
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
        title="Search (Ctrl+K)"
        aria-label="Search"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search</span>
      </button>

      <button
        type="button"
        onClick={onAddAccount}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
        title="Add account"
        aria-label="Add account"
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Add</span>
      </button>

      <button
        type="button"
        onClick={onLockApp}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
        title="Lock the app"
        aria-label="Lock app"
      >
        <Lock className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Lock</span>
      </button>

      <button
        type="button"
        onClick={onOpenSettings}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors shrink-0"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Settings</span>
      </button>

      <div className="ml-auto flex items-center gap-2 pl-2 shrink-0">
        {unreadTotal > 0 && (
          <span className="text-[10px] text-gray-400">{unreadTotal} unread</span>
        )}
        <span className="text-[10px] text-gray-600 hidden lg:inline">Dona Bridge</span>
      </div>
    </div>
  );
}
