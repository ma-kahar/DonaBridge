import {
  BarChart3,
  Bell,
  Briefcase,
  CheckSquare,
  Columns3,
  Copy,
  Download,
  FileText,
  FolderKanban,
  List,
  Maximize2,
  MessageSquare,
  Minimize2,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  SendHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContactDto,
  type ReminderDto,
  type TagDto,
  type TemplateDto,
  crmDeleteContact,
  crmDeleteTemplate,
  crmExportCsv,
  crmImportCsv,
  crmInsertDraft,
  crmOpenChat,
  crmListContacts,
  crmListReminders,
  crmListTags,
  crmListTemplates,
  crmUpsertContact,
  crmUpsertReminder,
  crmUpsertTemplate,
} from "../../lib/ipc";
import { useAppStore } from "../../store";
import CopilotPanel from "../copilot/CopilotPanel";
import ProjectsPanel from "./ProjectsPanel";
import ContactDetailPanel from "./ContactDetailPanel";
import DealsPanel from "./DealsPanel";
import ReportsPanel from "./ReportsPanel";
import TasksPanel from "./TasksPanel";
import { CONTACT_STAGES } from "./stages";
import EmojiPickerPopover from "../../components/EmojiPickerPopover";
import QuickReplyBar from "../../components/QuickReplyBar";
import WaMessage from "../../components/WaMessage";

type NavSection = "Workspace" | "Library" | "Insights";

function pinnedKey(accountId: string) {
  return `dona_crm_pinned_${accountId}`;
}
function loadPinned(accountId: string): Set<string> {
  try {
    const raw = localStorage.getItem(pinnedKey(accountId));
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  return new Set();
}
function savePinned(accountId: string, set: Set<string>) {
  localStorage.setItem(pinnedKey(accountId), JSON.stringify([...set]));
}

interface CrmDrawerProps {
  open: boolean;
  accountId: string | null;
  chatContext: { contact: string; messages: string[] } | null;
  onClose: () => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

type Tab =
  | "contacts"
  | "pipeline"
  | "tasks"
  | "reminders"
  | "projects"
  | "templates"
  | "quickreplies"
  | "reports"
  | "copilot";

export default function CrmDrawer({
  open,
  accountId,
  chatContext,
  onClose,
  expanded,
  onToggleExpand,
}: CrmDrawerProps) {
  const { t } = useTranslation();
  const { theme, toggleTheme, accounts: allAccounts } = useAppStore();
  const activeAccount = allAccounts.find((a) => a.id === accountId) ?? null;

  const [tab, setTab] = useState<Tab>("contacts");
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [selectedContact, setSelectedContact] = useState<ContactDto | null>(null);

  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDue, setReminderDue] = useState("");
  const [reminderContactId, setReminderContactId] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplBody, setTplBody] = useState("");
  const [tplPreview, setTplPreview] = useState(false);
  const [editingTpl, setEditingTpl] = useState<TemplateDto | null>(null);

  const refresh = useCallback(async () => {
    if (!accountId) return;
    const [c, r, tpl, tags] = await Promise.all([
      crmListContacts(accountId),
      crmListReminders(accountId),
      crmListTemplates(accountId),
      crmListTags(),
    ]);
    setContacts(c);
    setReminders(r);
    setTemplates(tpl);
    setAllTags(tags);
  }, [accountId]);

  useEffect(() => {
    if (open && accountId) {
      void refresh();
      setPinned(loadPinned(accountId));
    }
  }, [open, accountId, refresh]);

  // Escape collapses the full-screen CRM.
  useEffect(() => {
    if (!open || !expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggleExpand();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, expanded, onToggleExpand]);

  if (!open) return null;

  // --- Pin helpers ---
  function togglePin(id: string) {
    if (!accountId) return;
    const next = new Set(pinned);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPinned(next);
    savePinned(accountId, next);
  }

  // --- Filtered + sorted contacts (pinned first) ---
  const filteredContacts = contacts
    .filter((c) => {
      const q = search.trim().toLowerCase();
      const matchSearch =
        !q ||
        c.phone_e164.toLowerCase().includes(q) ||
        (c.display_name || "").toLowerCase().includes(q);
      return matchSearch;
    })
    .sort((a, b) => {
      const ap = pinned.has(a.id) ? 0 : 1;
      const bp = pinned.has(b.id) ? 0 : 1;
      return ap - bp;
    });

  async function handleAddContact(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !phone.trim()) return;
    const saved = await crmUpsertContact({
      id: "",
      account_id: accountId,
      phone_e164: phone.trim(),
      display_name: contactName.trim() || null,
      stage: "new",
    });
    setContacts((prev) => [saved, ...prev.filter((x) => x.id !== saved.id)]);
    setPhone("");
    setContactName("");
  }

  async function handleStageChange(contact: ContactDto, stage: string) {
    const updated = await crmUpsertContact({ ...contact, stage });
    setContacts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    if (selectedContact?.id === updated.id) {
      setSelectedContact(updated);
    }
  }

  async function handleDeleteContact(id: string) {
    await crmDeleteContact(id);
    setContacts((prev) => prev.filter((c) => c.id !== id));
    if (selectedContact?.id === id) setSelectedContact(null);
  }

  async function handleExportCsv() {
    if (!accountId) return;
    const csv = await crmExportCsv(accountId);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dona-contacts-${accountId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportCsv(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accountId) return;
    const text = await file.text();
    await crmImportCsv(accountId, text);
    await refresh();
    e.target.value = "";
  }

  async function handleInsertDraft(body: string) {
    if (!accountId) return;
    if (selectedContact?.stage === "do_not_contact") {
      const proceed = window.confirm(
        "This contact is marked “Do Not Contact”. Inserting a message draft is allowed, but sending marketing messages to opted-out contacts breaks WhatsApp policy. Insert anyway?"
      );
      if (!proceed) return;
    }
    const contactNameVal = selectedContact?.display_name || chatContext?.contact || "";
    const phoneVal = selectedContact?.phone_e164 || "";
    const dateVal = new Date().toLocaleDateString();
    const rendered = body
      .replaceAll("{name}", contactNameVal)
      .replaceAll("{phone}", phoneVal)
      .replaceAll("{date}", dateVal);
    await crmInsertDraft(accountId, rendered);
  }

  async function handleCompleteReminder(reminder: ReminderDto) {
    await crmUpsertReminder({ ...reminder, status: "done" });
    setReminders((prev) => prev.map((r) => (r.id === reminder.id ? { ...r, status: "done" } : r)));
  }

  async function handleOpenChat(phone_e164: string, target?: ContactDto) {
    if (!accountId) return;
    const contact =
      target ?? contacts.find((c) => c.phone_e164 === phone_e164) ?? selectedContact;
    if (contact?.stage === "do_not_contact") {
      const proceed = window.confirm(
        "This contact is marked “Do Not Contact”.\n\nThe chat will open for reference only — do not send marketing or bulk messages. Continue?"
      );
      if (!proceed) return;
    }
    await crmOpenChat(accountId, phone_e164);
  }

  const navItems: { id: Tab; label: string; icon: React.ReactNode; section: NavSection }[] = [
    {
      id: "contacts",
      label: t("crm.contacts"),
      icon: <Users className="w-4 h-4" />,
      section: "Workspace",
    },
    {
      id: "pipeline",
      label: t("crm.pipeline"),
      icon: <Briefcase className="w-4 h-4" />,
      section: "Workspace",
    },
    {
      id: "tasks",
      label: t("crm.tasks"),
      icon: <CheckSquare className="w-4 h-4" />,
      section: "Workspace",
    },
    {
      id: "reminders",
      label: t("crm.reminders"),
      icon: <Bell className="w-4 h-4" />,
      section: "Workspace",
    },
    {
      id: "projects",
      label: "Projects",
      icon: <FolderKanban className="w-4 h-4" />,
      section: "Library",
    },
    {
      id: "templates",
      label: t("crm.templates"),
      icon: <FileText className="w-4 h-4" />,
      section: "Library",
    },
    {
      id: "quickreplies",
      label: "Quick replies",
      icon: <MessageSquare className="w-4 h-4" />,
      section: "Library",
    },
    {
      id: "reports",
      label: t("crm.reports"),
      icon: <BarChart3 className="w-4 h-4" />,
      section: "Insights",
    },
    {
      id: "copilot",
      label: t("copilot.title"),
      icon: <Sparkles className="w-4 h-4" />,
      section: "Insights",
    },
  ];

  function selectTab(id: Tab) {
    setTab(id);
    if (id === "contacts") setSelectedContact(null);
  }

  const widthClass = expanded ? "fixed inset-0 z-40 w-screen h-screen" : "w-[340px]";

  return (
    <aside
      className={`${widthClass} shrink-0 h-full bg-dona-panel flex flex-col ${
        expanded ? "" : "border-l border-dona-border"
      }`}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-dona-border bg-dona-panel2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-dona-fg text-sm whitespace-nowrap">
            {expanded ? "Dona CRM" : t("crm.title")}
          </h2>
          {expanded && activeAccount && (
            <span className="text-[11px] text-dona-muted bg-dona-panel border border-dona-border rounded-full px-2 py-0.5 truncate max-w-[220px]">
              {activeAccount.name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Light / Dark toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="text-gray-400 hover:text-white transition-colors"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          {/* Expand / Collapse */}
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-gray-400 hover:text-white transition-colors"
            title={expanded ? "Collapse CRM" : "Expand CRM"}
          >
            {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {/* ── Content ── */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto space-y-3 ${
          expanded ? "p-4 xl:p-6" : "p-3"
        }`}
      >
        {!accountId ? (
          <p className="text-xs text-gray-500 text-center py-8">{t("accounts.selectAccount")}</p>
        ) : tab === "pipeline" ? (
          <DealsPanel accountId={accountId} contacts={contacts} expanded={expanded} />
        ) : tab === "tasks" ? (
          <TasksPanel accountId={accountId} contacts={contacts} />
        ) : tab === "reports" ? (
          <ReportsPanel accountId={accountId} />
        ) : tab === "copilot" ? (
          <CopilotPanel accountId={accountId} chatContext={chatContext} />
        ) : tab === "projects" ? (
          <ProjectsPanel accountId={accountId} contacts={contacts} />
        ) : tab === "quickreplies" ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Click a chip to insert it as a draft in WhatsApp. Hover to edit/delete. Use + to add new.
            </p>
            <QuickReplyBar accountId={accountId} />
          </div>
        ) : tab === "contacts" ? (
          <div
            className={
              expanded ? "grid grid-cols-[minmax(0,1fr)_380px] gap-4 items-start" : ""
            }
          >
            <div className={expanded || !selectedContact ? "min-w-0 space-y-3" : "hidden"}>
            {/* Add Contact */}
            <form onSubmit={handleAddContact} className="space-y-2">
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder={t("crm.namePlaceholder")}
                className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex gap-1.5">
                <input
                  type="text"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("crm.phonePlaceholder")}
                  className="flex-1 rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white flex items-center gap-1"
                  aria-label={t("crm.addContact")}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {/* Search + Tag Filter + View toggle */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("crm.searchPlaceholder")}
                className="flex-1 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-white"
              />
              <button
                type="button"
                onClick={() => setViewMode(viewMode === "list" ? "kanban" : "list")}
                className="p-1.5 rounded bg-dona-panel border border-dona-border text-gray-300 hover:text-white"
                title={viewMode === "list" ? t("crm.kanban") : t("crm.list")}
              >
                {viewMode === "list" ? (
                  <Columns3 className="w-3.5 h-3.5" />
                ) : (
                  <List className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* Tag filter chips */}
            {allTags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setTagFilter("")}
                  className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                    tagFilter === ""
                      ? "bg-blue-600 border-blue-500 text-white"
                      : "bg-dona-panel border-dona-border text-gray-400"
                  }`}
                >
                  All
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => setTagFilter(tagFilter === tag.id ? "" : tag.id)}
                    className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                      tagFilter === tag.id
                        ? "bg-blue-600/40 border-blue-500 text-blue-100"
                        : "bg-dona-panel border-dona-border text-gray-400"
                    }`}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            )}

            {/* Import / Export CSV */}
            <div className="flex items-center justify-between text-xs text-gray-400">
              <label className="cursor-pointer inline-flex items-center gap-1 hover:text-white">
                <Upload className="w-3 h-3" />
                {t("crm.importCsv")}
                <input type="file" accept=".csv" onChange={handleImportCsv} className="hidden" />
              </label>
              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1 hover:text-white"
              >
                <Download className="w-3 h-3" />
                {t("crm.exportCsv")}
              </button>
            </div>

            {filteredContacts.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-6">{t("crm.noContacts")}</p>
            ) : viewMode === "kanban" ? (
              /* Kanban by stage */
              <div className="space-y-3">
                {CONTACT_STAGES.map((stage) => {
                  const stageContacts = filteredContacts.filter((c) => c.stage === stage);
                  return (
                    <div
                      key={stage}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const contactId = e.dataTransfer.getData("text/contact-id");
                        const dragged = contacts.find((x) => x.id === contactId);
                        if (dragged && dragged.stage !== stage) {
                          void handleStageChange(dragged, stage);
                        }
                      }}
                      className="rounded-lg bg-dona-panel/60 border border-dona-border p-2 space-y-1.5 min-h-[56px]"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold text-gray-300">
                        <span>{t(`crm.stages.${stage}`)}</span>
                        <span className="text-gray-500">{stageContacts.length}</span>
                      </div>
                      {stageContacts.map((c) => (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("text/contact-id", c.id)}
                          className="relative group cursor-grab active:cursor-grabbing"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedContact(c)}
                            className="w-full text-left rounded bg-dona-dark border border-dona-border px-2 py-1.5 hover:border-blue-500"
                          >
                            <p className="text-xs text-white truncate pr-5">
                              {pinned.has(c.id) && "📌 "}
                              {c.display_name || c.phone_e164}
                            </p>
                            <p className="text-[10px] text-gray-400">{c.phone_e164}</p>
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePin(c.id)}
                            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 text-gray-500 hover:text-amber-400 transition-opacity"
                            title={pinned.has(c.id) ? "Unpin" : "Pin"}
                          >
                            {pinned.has(c.id) ? (
                              <PinOff className="w-3 h-3" />
                            ) : (
                              <Pin className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              /* List view */
              <ul
                className={
                  expanded
                    ? "grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2"
                    : "space-y-2"
                }
              >
                {filteredContacts.map((c) => (
                  <li
                    key={c.id}
                    className={`rounded-lg bg-dona-panel border p-2.5 space-y-1.5 ${
                      pinned.has(c.id) ? "border-amber-500/50" : "border-dona-border"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedContact(c)}
                        className="min-w-0 text-left hover:underline"
                      >
                        <p className="text-xs font-medium text-white truncate">
                          {pinned.has(c.id) && "📌 "}
                          {c.display_name || c.phone_e164}
                        </p>
                        <p className="text-[11px] text-gray-400">{c.phone_e164}</p>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Open chat inside app */}
                        <button
                          type="button"
                          onClick={() => void handleOpenChat(c.phone_e164, c)}
                          className="text-emerald-400 hover:text-emerald-300"
                          title="Open Chat"
                        >
                          💬
                        </button>
                        {/* Pin */}
                        <button
                          type="button"
                          onClick={() => togglePin(c.id)}
                          className={`${pinned.has(c.id) ? "text-amber-400" : "text-gray-500 hover:text-amber-400"}`}
                          title={pinned.has(c.id) ? "Unpin" : "Pin to top"}
                        >
                          {pinned.has(c.id) ? (
                            <PinOff className="w-3.5 h-3.5" />
                          ) : (
                            <Pin className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => void handleDeleteContact(c.id)}
                          className="text-gray-500 hover:text-red-400"
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <select
                      value={c.stage}
                      onChange={(e) => void handleStageChange(c, e.target.value)}
                      className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
                    >
                      {CONTACT_STAGES.map((s) => (
                        <option key={s} value={s}>
                          {t(`crm.stages.${s}`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
            </div>
            {(selectedContact || expanded) && (
              <aside
                className={
                  expanded
                    ? "max-h-[calc(100vh-9rem)] overflow-y-auto rounded-xl border border-dona-border bg-dona-panel2/60 p-3"
                    : ""
                }
              >
                {selectedContact ? (
                  <ContactDetailPanel
                    accountId={accountId}
                    contact={selectedContact}
                    allTags={allTags}
                    onStageChange={(c, stage) => void handleStageChange(c, stage)}
                    onOpenChat={(phone, c) => void handleOpenChat(phone, c)}
                    onBack={expanded ? undefined : () => setSelectedContact(null)}
                    onTagsChanged={setAllTags}
                    onRefresh={refresh}
                  />
                ) : (
                  <div className="text-center py-10 space-y-1">
                    <p className="text-xs text-gray-400">Select a contact</p>
                    <p className="text-[10px] text-gray-600">
                      Details and properties appear here.
                    </p>
                  </div>
                )}
              </aside>
            )}
          </div>
        ) : tab === "reminders" ? (
          <div className="space-y-3">
            {/* Add Reminder form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!reminderNote.trim()) return;
                const targetContact = reminderContactId || contacts[0]?.id || "general";
                const dueIso = reminderDue
                  ? new Date(reminderDue).toISOString()
                  : new Date().toISOString();
                await crmUpsertReminder({
                  id: "",
                  contact_id: targetContact,
                  due_at: dueIso,
                  note: reminderNote.trim(),
                  status: "pending",
                });
                setReminderNote("");
                setReminderDue("");
                await refresh();
              }}
              className="space-y-2 rounded-lg bg-dona-panel border border-dona-border p-2.5"
            >
              <select
                value={reminderContactId}
                onChange={(e) => setReminderContactId(e.target.value)}
                className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
              >
                <option value="">General Reminder (or pick contact)</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name || c.phone_e164}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
                placeholder="Reminder note..."
                className="w-full rounded bg-dona-dark border border-dona-border px-2.5 py-1.5 text-xs text-white"
              />
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={reminderDue}
                  onChange={(e) => setReminderDue(e.target.value)}
                  className="flex-1 rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
                />
                <button
                  type="submit"
                  className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {reminders.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">{t("crm.noReminders")}</p>
            ) : (
              <ul className="space-y-2">
                {reminders.map((r) => {
                  const contact = contacts.find((c) => c.id === r.contact_id);
                  return (
                    <li
                      key={r.id}
                      className="rounded-lg bg-dona-panel border border-dona-border p-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-white truncate">{r.note || "Follow-up"}</p>
                        <p className="text-[10px] text-blue-400 truncate">
                          {contact ? contact.display_name || contact.phone_e164 : "General"}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {r.due_at ? new Date(r.due_at).toLocaleString() : r.status}
                        </p>
                      </div>
                      {r.status !== "done" && (
                        <button
                          type="button"
                          onClick={() => void handleCompleteReminder(r)}
                          className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white shrink-0"
                        >
                          ✓
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          /* ── Templates ── */
          <>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!tplName.trim() || !tplBody.trim()) return;
                if (editingTpl) {
                  await crmUpsertTemplate({
                    ...editingTpl,
                    name: tplName.trim(),
                    body: tplBody.trim(),
                  });
                  setEditingTpl(null);
                } else {
                  await crmUpsertTemplate({
                    id: "",
                    account_id: accountId,
                    name: tplName.trim(),
                    body: tplBody.trim(),
                    language: "auto",
                    shortcut: null,
                  });
                }
                setTplName("");
                setTplBody("");
                await refresh();
              }}
              className="space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white">
                  {editingTpl ? t("common.edit") : t("crm.addTemplate")}
                </span>
                {editingTpl && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTpl(null);
                      setTplName("");
                      setTplBody("");
                    }}
                    className="text-xs text-gray-400 hover:text-white"
                  >
                    {t("common.cancel")}
                  </button>
                )}
              </div>
              <input
                type="text"
                required
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder={t("crm.templateNamePlaceholder")}
                className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="relative">
                <textarea
                  required
                  rows={3}
                  value={tplBody}
                  onChange={(e) => setTplBody(e.target.value)}
                  placeholder={t("crm.templateBodyPlaceholder")}
                  className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 pr-8"
                />
              </div>
              <div className="flex items-center gap-1 text-[11px] flex-wrap">
                {[
                  { label: "B", wrap: "*", cls: "font-bold" },
                  { label: "I", wrap: "_", cls: "italic" },
                  { label: "S̶", wrap: "~", cls: "line-through" },
                  { label: "</>", wrap: "`", cls: "font-mono" },
                ].map((fmt) => (
                  <button
                    key={fmt.label}
                    type="button"
                    onClick={() => setTplBody((prev) => `${prev}${fmt.wrap}text${fmt.wrap}`)}
                    className={`px-2 py-0.5 rounded bg-dona-panel border border-dona-border text-gray-300 hover:text-white ${fmt.cls}`}
                  >
                    {fmt.label}
                  </button>
                ))}
                <EmojiPickerPopover onSelect={(emoji) => setTplBody((b) => b + emoji)} />
                <button
                  type="button"
                  onClick={() => setTplPreview((p) => !p)}
                  className="ml-auto px-2 py-0.5 rounded bg-dona-panel border border-dona-border text-gray-300 hover:text-white text-[10px]"
                >
                  {tplPreview ? "Edit" : "Preview"}
                </button>
              </div>
              {tplPreview && tplBody && (
                <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5">
                  <WaMessage body={tplBody} showLinkPreview={false} />
                </div>
              )}
              <button
                type="submit"
                className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
              >
                {editingTpl ? t("common.save") : t("crm.addTemplate")}
              </button>
            </form>

            <p className="text-[11px] text-gray-500">{t("copilot.draftOnly")}</p>

            {templates.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-4">{t("crm.noTemplates")}</p>
            ) : (
              <ul className="space-y-2">
                {templates.map((tpl) => (
                  <li
                    key={tpl.id}
                    className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white truncate">{tpl.name}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleInsertDraft(tpl.body)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white"
                          title={t("crm.insertDraft")}
                        >
                          <SendHorizontal className="w-3 h-3" />
                          {t("crm.insertDraft")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTpl(tpl);
                            setTplName(tpl.name);
                            setTplBody(tpl.body);
                            setTplPreview(false);
                          }}
                          className="text-gray-400 hover:text-white"
                          title={t("common.edit")}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard?.writeText(tpl.body)}
                          className="text-gray-400 hover:text-white"
                          title="Copy"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void crmDeleteTemplate(tpl.id).then(refresh)}
                          className="text-gray-500 hover:text-red-400"
                          aria-label={t("common.delete")}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="text-[11px] text-gray-400">
                      <WaMessage body={tpl.body} showLinkPreview={false} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* ── Bottom navigation ── */}
      <nav
        className={`shrink-0 border-t border-dona-border bg-dona-panel2 ${
          expanded ? "flex items-stretch" : "grid grid-cols-3 gap-1.5 p-2"
        }`}
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectTab(item.id)}
            title={item.label}
            className={`flex flex-col items-center justify-center gap-1 px-1 transition-colors ${
              expanded
                ? "flex-1 text-[10px] py-2 border-t-2 -mt-px"
                : "rounded-xl text-[9px] leading-tight py-2.5 border"
            } ${
              tab === item.id
                ? expanded
                  ? "text-dona-accent bg-dona-accent/10 border-dona-accent"
                  : "bg-dona-accent/15 text-dona-accent border-dona-accent/35 shadow-sm shadow-black/10"
                : expanded
                  ? "text-dona-muted hover:text-dona-fg hover:bg-dona-panel border-transparent"
                  : "text-dona-muted border-transparent hover:text-dona-fg hover:bg-dona-panel"
            }`}
          >
            {item.icon}
            <span className="truncate max-w-full font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
