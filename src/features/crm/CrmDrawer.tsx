import {
  ArrowLeft,
  Bell,
  Columns3,
  Copy,
  Download,
  FileText,
  List,
  MessageSquare,
  Pencil,
  Plus,
  SendHorizontal,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, type FormEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContactDto,
  type NoteDto,
  type ReminderDto,
  type TagDto,
  type TemplateDto,
  crmAddNote,
  crmAssignTag,
  crmDeleteContact,
  crmDeleteTemplate,
  crmExportCsv,
  crmImportCsv,
  crmInsertDraft,
  crmListContactTags,
  crmListContacts,
  crmListNotes,
  crmListReminders,
  crmListTags,
  crmListTemplates,
  crmRemoveTag,
  crmUpsertContact,
  crmUpsertReminder,
  crmUpsertTag,
  crmUpsertTemplate,
} from "../../lib/ipc";
import CopilotPanel from "../copilot/CopilotPanel";
import EmojiPickerPopover from "../../components/EmojiPickerPopover";
import QuickReplyBar from "../../components/QuickReplyBar";
import WaMessage from "../../components/WaMessage";

const STAGES = ["new", "follow_up", "negotiating", "won", "do_not_contact"] as const;

interface CrmDrawerProps {
  open: boolean;
  accountId: string | null;
  chatContext: { contact: string; messages: string[] } | null;
  onClose: () => void;
}

type Tab = "contacts" | "reminders" | "templates" | "quickreplies" | "copilot";

export default function CrmDrawer({ open, accountId, chatContext, onClose }: CrmDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("contacts");
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [search, setSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<ContactDto | null>(null);

  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [reminders, setReminders] = useState<ReminderDto[]>([]);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [contactTags, setContactTags] = useState<TagDto[]>([]);
  const [notes, setNotes] = useState<NoteDto[]>([]);

  const [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDue, setReminderDue] = useState("");
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
    }
  }, [open, accountId, refresh]);

  useEffect(() => {
    if (!selectedContact) return;
    void Promise.all([
      crmListNotes(selectedContact.id),
      crmListContactTags(selectedContact.id),
    ]).then(([n, ct]) => {
      setNotes(n);
      setContactTags(ct);
    });
  }, [selectedContact]);

  if (!open) return null;

  const filteredContacts = contacts.filter((c) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      c.phone_e164.toLowerCase().includes(q) || (c.display_name || "").toLowerCase().includes(q)
    );
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

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!accountId || !selectedContact || !noteInput.trim()) return;
    await crmAddNote(accountId, selectedContact.id, noteInput.trim());
    setNoteInput("");
    setNotes(await crmListNotes(selectedContact.id));
  }

  async function handleAddTag(e: FormEvent) {
    e.preventDefault();
    if (!selectedContact || !tagInput.trim()) return;
    const tag = await crmUpsertTag({
      id: "",
      name: tagInput.trim(),
      color: "#3B82F6",
    });
    await crmAssignTag(selectedContact.id, tag.id);
    setTagInput("");
    const [tags, ct] = await Promise.all([crmListTags(), crmListContactTags(selectedContact.id)]);
    setAllTags(tags);
    setContactTags(ct);
  }

  async function handleToggleTag(tag: TagDto) {
    if (!selectedContact) return;
    const assigned = contactTags.some((t) => t.id === tag.id);
    if (assigned) {
      await crmRemoveTag(selectedContact.id, tag.id);
    } else {
      await crmAssignTag(selectedContact.id, tag.id);
    }
    setContactTags(await crmListContactTags(selectedContact.id));
  }

  async function handleAddReminder(e: FormEvent) {
    e.preventDefault();
    if (!selectedContact || !reminderNote.trim()) return;
    const dueIso = reminderDue ? new Date(reminderDue).toISOString() : new Date().toISOString();
    await crmUpsertReminder({
      id: "",
      contact_id: selectedContact.id,
      due_at: dueIso,
      note: reminderNote.trim(),
      status: "pending",
    });
    setReminderNote("");
    setReminderDue("");
    await refresh();
  }

  async function handleInsertDraft(body: string) {
    if (!accountId) return;
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

  return (
    <aside className="w-[340px] shrink-0 h-full bg-dona-dark border-l border-dona-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dona-border">
        <h2 className="font-semibold text-white">{t("crm.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-white/50 hover:text-white transition-colors"
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-5 border-b border-dona-border text-[11px]">
        <button
          type="button"
          onClick={() => {
            setTab("contacts");
            setSelectedContact(null);
          }}
          className={`flex items-center justify-center gap-1 py-2.5 transition-colors ${
            tab === "contacts"
              ? "text-white border-b-2 border-blue-500 bg-white/5"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          {t("crm.contacts")}
        </button>
        <button
          type="button"
          onClick={() => setTab("reminders")}
          className={`flex items-center justify-center gap-1 py-2.5 transition-colors ${
            tab === "reminders"
              ? "text-white border-b-2 border-blue-500 bg-white/5"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          {t("crm.reminders")}
        </button>
        <button
          type="button"
          onClick={() => setTab("templates")}
          className={`flex items-center justify-center gap-1 py-2.5 transition-colors ${
            tab === "templates"
              ? "text-white border-b-2 border-blue-500 bg-white/5"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          {t("crm.templates")}
        </button>
        <button
          type="button"
          onClick={() => setTab("quickreplies")}
          className={`flex items-center justify-center gap-1 py-2.5 transition-colors ${
            tab === "quickreplies"
              ? "text-white border-b-2 border-blue-500 bg-white/5"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          Quick
        </button>
        <button
          type="button"
          onClick={() => setTab("copilot")}
          className={`flex items-center justify-center gap-1 py-2.5 transition-colors ${
            tab === "copilot"
              ? "text-white border-b-2 border-blue-500 bg-white/5"
              : "text-gray-400 hover:text-white"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          {t("copilot.title")}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {!accountId ? (
          <p className="text-xs text-gray-500 text-center py-8">{t("accounts.selectAccount")}</p>
        ) : tab === "copilot" ? (
          <CopilotPanel accountId={accountId} chatContext={chatContext} />
        ) : tab === "quickreplies" ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-400">
              Click a chip to insert it as a draft in WhatsApp. Hover to edit/delete. Use + to add new.
            </p>
            <QuickReplyBar accountId={accountId} />
          </div>
        ) : tab === "contacts" && selectedContact ? (
          /* ── Contact Detail View (Notes, Tags, Follow-up Reminder) ── */
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelectedContact(null)}
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {t("crm.back")}
            </button>

            <div className="rounded-lg bg-dona-panel border border-dona-border p-3 space-y-2">
              <p className="text-sm font-semibold text-white">
                {selectedContact.display_name || selectedContact.phone_e164}
              </p>
              <p className="text-xs text-gray-400">{selectedContact.phone_e164}</p>
              <select
                value={selectedContact.stage}
                onChange={(e) => void handleStageChange(selectedContact, e.target.value)}
                className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`crm.stages.${s}`)}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-300 flex items-center gap-1">
                <Tag className="w-3 h-3" /> {t("crm.tags")}
              </p>
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => {
                  const active = contactTags.some((ct) => ct.id === tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => void handleToggleTag(tag)}
                      className={`px-2 py-0.5 rounded-full text-[11px] border transition-colors ${
                        active
                          ? "bg-blue-600/30 border-blue-500 text-blue-200"
                          : "bg-dona-panel border-dona-border text-gray-400"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
              <form onSubmit={handleAddTag} className="flex gap-1.5">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  placeholder={t("crm.addTagPlaceholder")}
                  className="flex-1 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            {/* Follow-up Reminder */}
            <form
              onSubmit={handleAddReminder}
              className="space-y-1.5 border-t border-dona-border pt-2"
            >
              <p className="text-xs font-medium text-gray-300">{t("crm.addReminder")}</p>
              <input
                type="text"
                value={reminderNote}
                onChange={(e) => setReminderNote(e.target.value)}
                placeholder={t("crm.notePlaceholder")}
                className="w-full rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-white"
              />
              <div className="flex gap-1.5">
                <input
                  type="datetime-local"
                  value={reminderDue}
                  onChange={(e) => setReminderDue(e.target.value)}
                  className="flex-1 rounded bg-dona-panel border border-dona-border px-2 py-1 text-[11px] text-white"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
                >
                  <Bell className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>

            {/* Notes */}
            <div className="space-y-2 border-t border-dona-border pt-2">
              <form onSubmit={handleAddNote} className="flex gap-1.5">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder={t("crm.notePlaceholder")}
                  className="flex-1 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-white"
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
                  aria-label={t("crm.addNote")}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
              <ul className="space-y-1.5">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded bg-dona-panel border border-dona-border p-2 text-xs text-gray-200"
                  >
                    {n.body}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : tab === "contacts" ? (
          <>
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

            {/* Search + View Toggle + CSV Import/Export */}
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
              <div className="space-y-3">
                {STAGES.map((stage) => {
                  const stageContacts = filteredContacts.filter((c) => c.stage === stage);
                  return (
                    <div
                      key={stage}
                      className="rounded-lg bg-dona-panel/60 border border-dona-border p-2 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold text-gray-300">
                        <span>{t(`crm.stages.${stage}`)}</span>
                        <span className="text-gray-500">{stageContacts.length}</span>
                      </div>
                      {stageContacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedContact(c)}
                          className="w-full text-left rounded bg-dona-dark border border-dona-border px-2 py-1.5 hover:border-blue-500"
                        >
                          <p className="text-xs text-white truncate">
                            {c.display_name || c.phone_e164}
                          </p>
                          <p className="text-[10px] text-gray-400">{c.phone_e164}</p>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul className="space-y-2">
                {filteredContacts.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedContact(c)}
                        className="min-w-0 text-left hover:underline"
                      >
                        <p className="text-xs font-medium text-white truncate">
                          {c.display_name || c.phone_e164}
                        </p>
                        <p className="text-[11px] text-gray-400">{c.phone_e164}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteContact(c.id)}
                        className="text-gray-500 hover:text-red-400"
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <select
                      value={c.stage}
                      onChange={(e) => void handleStageChange(c, e.target.value)}
                      className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
                    >
                      {STAGES.map((s) => (
                        <option key={s} value={s}>
                          {t(`crm.stages.${s}`)}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : tab === "reminders" ? (
          reminders.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-6">{t("crm.noReminders")}</p>
          ) : (
            <ul className="space-y-2">
              {reminders.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg bg-dona-panel border border-dona-border p-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-xs text-white truncate">{r.note || r.contact_id}</p>
                    <p className="text-[11px] text-gray-400">
                      {r.due_at ? new Date(r.due_at).toLocaleString() : r.status}
                    </p>
                  </div>
                  {r.status !== "done" && (
                    <button
                      type="button"
                      onClick={() => void handleCompleteReminder(r)}
                      className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                    >
                      ✓
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {/* Template add/edit form */}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!tplName.trim() || !tplBody.trim()) return;
                if (editingTpl) {
                  await crmUpsertTemplate({ ...editingTpl, name: tplName.trim(), body: tplBody.trim() });
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
                    onClick={() => { setEditingTpl(null); setTplName(""); setTplBody(""); }}
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
              {/* WhatsApp formatting helpers + emoji picker */}
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
                    {/* WhatsApp-rendered preview of template body */}
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
    </aside>
  );
}
