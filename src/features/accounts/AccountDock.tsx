import { Lock, PanelRightOpen, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type Account, useAppStore } from "../../store";

interface AccountDockProps {
  onSelectAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onAddClick: () => void;
  onToggleCrm: () => void;
  onOpenSettings: () => void;
  onLockApp: () => void;
  crmOpen: boolean;
}

export default function AccountDock({
  onSelectAccount,
  onEditAccount,
  onAddClick,
  onToggleCrm,
  onOpenSettings,
  onLockApp,
  crmOpen,
}: AccountDockProps) {
  const { t } = useTranslation();
  const { accounts, activeAccountId } = useAppStore();

  return (
    <aside className="w-16 flex flex-col items-center py-3 gap-2 bg-dona-dark border-r border-dona-border shrink-0">
      {accounts.map((account) => (
        <AccountButton
          key={account.id}
          account={account}
          isActive={account.id === activeAccountId}
          onClick={() => onSelectAccount(account)}
          onContextMenu={(e) => {
            e.preventDefault();
            onEditAccount(account);
          }}
        />
      ))}

      <div className="mt-auto flex flex-col items-center gap-2">
        <button
          onClick={onToggleCrm}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
            crmOpen
              ? "bg-blue-600 text-white"
              : "bg-white/5 text-white/60 hover:text-white hover:bg-white/10"
          }`}
          title={t("crm.title")}
          aria-label={t("crm.title")}
          type="button"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>

        <button
          onClick={onLockApp}
          className="w-10 h-10 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          title={t("lock.lockNow")}
          aria-label={t("lock.lockNow")}
          type="button"
        >
          <Lock className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          title={t("settings.title")}
          aria-label={t("settings.title")}
          type="button"
        >
          <Settings className="w-4 h-4" />
        </button>

        <button
          onClick={onAddClick}
          className="w-10 h-10 rounded-full border-2 border-dashed border-white/20
                     flex items-center justify-center text-white/40 hover:text-white/70
                     hover:border-white/40 transition-colors"
          title={t("accounts.addAccount")}
          aria-label={t("accounts.addAccount")}
          type="button"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>
    </aside>
  );
}

function AccountButton({
  account,
  isActive,
  onClick,
  onContextMenu,
}: {
  account: Account;
  isActive: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`relative w-10 h-10 rounded-full flex items-center justify-center
                  text-sm font-bold transition-all
                  ${isActive ? "ring-2 ring-white scale-110" : "opacity-70 hover:opacity-100"}`}
      style={{ backgroundColor: account.color }}
      title={`${account.name} (Right-click to edit)`}
      type="button"
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
        <span
          className="absolute -top-1 -right-1 bg-red-500 text-white text-xs
                         rounded-full min-w-[16px] h-4 flex items-center justify-center px-1"
        >
          {account.unreadCount > 99 ? "99+" : account.unreadCount}
        </span>
      )}
      {account.hasLock && (
        <span className="absolute -bottom-0.5 -right-0.5 bg-dona-dark rounded-full p-0.5 border border-dona-border">
          <Lock className="w-2.5 h-2.5 text-amber-400" />
        </span>
      )}
    </button>
  );
}
