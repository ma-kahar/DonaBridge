import {
  FileText,
  FolderKanban,
  Info,
  Lock,
  MessageCircle,
  Moon,
  PanelRightOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CrmProject } from "../features/crm/ProjectsPanel";
import {
  type ContactDto,
  type TemplateDto,
  crmInsertDraft,
  crmListContacts,
  crmListTemplates,
  crmOpenChat,
} from "../lib/ipc";
import { type Account, useAppStore } from "../store";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectAccount: (account: Account) => void;
  onOpenSettings: () => void;
  onOpenCrm: () => void;
  onAddAccount: () => void;
  onLockApp: () => void;
  onReloadAccounts: () => void;
  onOpenAbout: () => void;
}

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  section: string;
  icon: ReactNode;
  run: () => void;
}

function loadProjects(accountId: string): CrmProject[] {
  try {
    const raw = localStorage.getItem(`dona_crm_projects_${accountId}`);
    if (raw) return JSON.parse(raw) as CrmProject[];
  } catch {
    // ignore malformed local data
  }
  return [];
}

export default function CommandPalette({
  open,
  onClose,
  onSelectAccount,
  onOpenSettings,
  onOpenCrm,
  onAddAccount,
  onLockApp,
  onReloadAccounts,
  onOpenAbout,
}: CommandPaletteProps) {
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    setContacts([]);
    setTemplates([]);
    // Hooks are synchronous; focus after the overlay is mounted.
    window.setTimeout(() => inputRef.current?.focus(), 30);

    if (!activeAccountId) return;
    let cancelled = false;
    void crmListContacts(activeAccountId)
      .then((list) => {
        if (!cancelled) setContacts(list);
      })
      .catch(() => {});
    void crmListTemplates(activeAccountId)
      .then((list) => {
        if (!cancelled) setTemplates(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, activeAccountId]);

  const items = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "action-search-crm",
        label: "Open CRM drawer",
        section: "Actions",
        icon: <PanelRightOpen className="w-4 h-4" />,
        run: onOpenCrm,
      },
      {
        id: "action-add-account",
        label: "Add account",
        section: "Actions",
        icon: <Plus className="w-4 h-4" />,
        run: onAddAccount,
      },
      {
        id: "action-settings",
        label: "Open settings",
        section: "Actions",
        icon: <Settings className="w-4 h-4" />,
        run: onOpenSettings,
      },
      {
        id: "action-lock",
        label: "Lock Dona Bridge",
        section: "Actions",
        icon: <Lock className="w-4 h-4" />,
        run: onLockApp,
      },
      {
        id: "action-theme",
        label: "Toggle dark / light theme",
        section: "Actions",
        icon: <Moon className="w-4 h-4" />,
        run: toggleTheme,
      },
      {
        id: "action-reload",
        label: "Reload accounts",
        section: "Actions",
        icon: <RefreshCw className="w-4 h-4" />,
        run: onReloadAccounts,
      },
      {
        id: "action-about",
        label: "About Dona Bridge",
        section: "Actions",
        icon: <Info className="w-4 h-4" />,
        run: onOpenAbout,
      },
    ];

    const accountItems: PaletteItem[] = accounts.map((account) => {
      const hint = [account.hasLock ? "locked" : null, account.muted ? "muted" : null]
        .filter(Boolean)
        .join(" · ");
      return {
        id: `account-${account.id}`,
        label: account.name,
        hint: hint || undefined,
        section: "Accounts",
        icon: <Users className="w-4 h-4" />,
        run: () => onSelectAccount(account),
      };
    });

    const contactItems: PaletteItem[] = contacts.slice(0, 200).map((contact) => ({
      id: `contact-${contact.id}`,
      label: contact.display_name || contact.phone_e164,
      hint: contact.phone_e164,
      section: "Contacts",
      icon: <MessageCircle className="w-4 h-4" />,
      run: () => {
        if (activeAccountId) {
          void crmOpenChat(activeAccountId, contact.phone_e164);
        }
      },
    }));

    const templateItems: PaletteItem[] = templates.map((template) => ({
      id: `template-${template.id}`,
      label: template.name,
      hint: template.body.slice(0, 60),
      section: "Quick replies",
      icon: <FileText className="w-4 h-4" />,
      run: () => {
        if (activeAccountId) {
          void crmInsertDraft(activeAccountId, template.body);
        }
      },
    }));

    const projectItems: PaletteItem[] = activeAccountId
      ? loadProjects(activeAccountId).map((project) => ({
          id: `project-${project.id}`,
          label: project.name,
          hint: project.status.replace("_", " "),
          section: "Projects",
          icon: <FolderKanban className="w-4 h-4" />,
          run: onOpenCrm,
        }))
      : [];

    return [
      ...actions,
      ...accountItems,
      ...contactItems,
      ...templateItems,
      ...projectItems,
    ];
  }, [
    accounts,
    activeAccountId,
    contacts,
    templates,
    onAddAccount,
    onLockApp,
    onOpenAbout,
    onOpenCrm,
    onOpenSettings,
    onReloadAccounts,
    onSelectAccount,
    toggleTheme,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? items.filter((item) =>
          `${item.label} ${item.hint ?? ""} ${item.section}`.toLowerCase().includes(needle)
        )
      : items;
    return list.slice(0, 40);
  }, [items, query]);

  if (!open) return null;

  const runItem = (item: PaletteItem) => {
    item.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 pt-[12vh] px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl rounded-2xl border border-dona-border bg-dona-panel shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-dona-border">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const item = filtered[cursor];
                if (item) runItem(item);
              }
            }}
            placeholder="Search accounts, contacts, quick replies, projects or actions…"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
            aria-label="Command palette"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-dona-border text-gray-400">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-gray-500">No matches</p>
          ) : (
            filtered.map((item, index) => {
              const showSection = index === 0 || filtered[index - 1].section !== item.section;
              return (
                <div key={item.id}>
                  {showSection && (
                    <p className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-wider text-gray-500">
                      {item.section}
                    </p>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => runItem(item)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                      index === cursor ? "bg-blue-600/25" : "hover:bg-white/5"
                    }`}
                  >
                    <span className="text-gray-400 shrink-0">{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-white truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-[11px] text-gray-500 truncate">{item.hint}</span>
                      )}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
