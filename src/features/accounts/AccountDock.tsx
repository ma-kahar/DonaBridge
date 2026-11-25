import {
  type DragEndEvent,
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Lock, PanelRightOpen, Plus, Search, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { reorderAccounts } from "../../lib/ipc";
import { type Account, useAppStore } from "../../store";

interface AccountDockProps {
  onSelectAccount: (account: Account) => void;
  onEditAccount: (account: Account) => void;
  onAddClick: () => void;
  onToggleCrm: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onLockApp: () => void;
  crmOpen: boolean;
}

export default function AccountDock({
  onSelectAccount,
  onEditAccount,
  onAddClick,
  onToggleCrm,
  onOpenSettings,
  onOpenPalette,
  onLockApp,
  crmOpen,
}: AccountDockProps) {
  const { t } = useTranslation();
  const { accounts, activeAccountId, groups, sessionStates, setAccounts } = useAppStore();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = accounts.findIndex((a) => a.id === active.id);
    const newIndex = accounts.findIndex((a) => a.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(accounts, oldIndex, newIndex).map((account, index) => ({
      ...account,
      sortOrder: index,
    }));
    setAccounts(next);
    void reorderAccounts(next.map((a) => a.id)).catch((err) => {
      console.error("Could not save the account order:", err);
    });
  }

  return (
    <aside className="w-16 flex flex-col items-center py-3 gap-2 bg-dona-dark border-r border-dona-border shrink-0">
      <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col items-center gap-2 px-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={accounts.map((a) => a.id)}
            strategy={verticalListSortingStrategy}
          >
            {accounts.map((account) => (
              <AccountButton
                key={account.id}
                account={account}
                isActive={account.id === activeAccountId}
                loggedOut={sessionStates[account.id] === "logged_out"}
                groupColor={
                  groups.find((g) => g.id === account.groupId)?.color ?? null
                }
                groupName={groups.find((g) => g.id === account.groupId)?.name ?? null}
                onClick={() => onSelectAccount(account)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onEditAccount(account);
                }}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      <div className="flex flex-col items-center gap-2 pt-1">
        <button
          onClick={onOpenPalette}
          className="w-10 h-10 rounded-full bg-white/5 text-white/60 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          title={`${t("palette.title")} (Ctrl+K)`}
          aria-label={t("palette.title")}
          type="button"
        >
          <Search className="w-4 h-4" />
        </button>

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
  loggedOut,
  groupColor,
  groupName,
  onClick,
  onContextMenu,
}: {
  account: Account;
  isActive: boolean;
  loggedOut: boolean;
  groupColor: string | null;
  groupName: string | null;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });

  const style: React.CSSProperties = {
    backgroundColor: account.color,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.85 : undefined,
    outline: groupColor ? `2px solid ${groupColor}` : undefined,
    outlineOffset: groupColor ? "1px" : undefined,
  };

  const titleParts = [account.name];
  if (groupName) titleParts.push(`(${groupName})`);
  titleParts.push(loggedOut ? "— session logged out, click to scan the QR code" : "— right-click to edit");

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`relative w-10 h-10 shrink-0 rounded-full flex items-center justify-center
                  text-sm font-bold transition-all select-none
                  ${isActive ? "ring-2 ring-white scale-110" : "opacity-70 hover:opacity-100"}`}
      title={titleParts.join(" ")}
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
      {loggedOut && !account.hasLock && (
        <span
          className="absolute -bottom-0.5 -left-0.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-dona-dark"
          aria-label="Session logged out"
        />
      )}
    </button>
  );
}
