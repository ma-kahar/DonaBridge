import { ArrowLeft, Bell, Plus, Tag } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ContactDto,
  type NoteDto,
  type TagDto,
  crmAddNote,
  crmAssignTag,
  crmListContactTags,
  crmListNotes,
  crmListTags,
  crmRemoveTag,
  crmUpsertReminder,
  crmUpsertTag,
} from "../../lib/ipc";
import ContactInsights from "./ContactInsights";
import { CONTACT_STAGES } from "./stages";

interface ContactDetailPanelProps {
  accountId: string;
  contact: ContactDto;
  allTags: TagDto[];
  onStageChange: (contact: ContactDto, stage: string) => void;
  onOpenChat: (phone: string, contact: ContactDto) => void;
  onBack?: () => void;
  onTagsChanged?: (tags: TagDto[]) => void;
  onRefresh?: () => void;
}

export default function ContactDetailPanel({
  accountId,
  contact,
  allTags,
  onStageChange,
  onOpenChat,
  onBack,
  onTagsChanged,
  onRefresh,
}: ContactDetailPanelProps) {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [contactTags, setContactTags] = useState<TagDto[]>([]);
  const [noteInput, setNoteInput] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderDue, setReminderDue] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.all([crmListNotes(contact.id), crmListContactTags(contact.id)])
      .then(([noteList, tagList]) => {
        if (cancelled) return;
        setNotes(noteList);
        setContactTags(tagList);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [contact.id]);

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!noteInput.trim()) return;
    await crmAddNote(accountId, contact.id, noteInput.trim());
    setNoteInput("");
    setNotes(await crmListNotes(contact.id));
  }

  async function handleAddTag(e: FormEvent) {
    e.preventDefault();
    if (!tagInput.trim()) return;
    const tag = await crmUpsertTag({ id: "", name: tagInput.trim(), color: "#3B82F6" });
    await crmAssignTag(contact.id, tag.id);
    setTagInput("");
    const [tags, assigned] = await Promise.all([
      crmListTags(),
      crmListContactTags(contact.id),
    ]);
    onTagsChanged?.(tags);
    setContactTags(assigned);
  }

  async function handleToggleTag(tag: TagDto) {
    const assigned = contactTags.some((t) => t.id === tag.id);
    if (assigned) {
      await crmRemoveTag(contact.id, tag.id);
    } else {
      await crmAssignTag(contact.id, tag.id);
    }
    setContactTags(await crmListContactTags(contact.id));
  }

  async function handleAddReminder(e: FormEvent) {
    e.preventDefault();
    if (!reminderNote.trim()) return;
    const dueIso = reminderDue ? new Date(reminderDue).toISOString() : new Date().toISOString();
    await crmUpsertReminder({
      id: "",
      contact_id: contact.id,
      due_at: dueIso,
      note: reminderNote.trim(),
      status: "pending",
    });
    setReminderNote("");
    setReminderDue("");
    onRefresh?.();
  }

  return (
    <div className="space-y-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("crm.back")}
        </button>
      )}

      <div className="rounded-lg bg-dona-panel border border-dona-border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {contact.display_name || contact.phone_e164}
            </p>
            <p className="text-xs text-gray-400 truncate">{contact.phone_e164}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChat(contact.phone_e164, contact)}
            className="text-emerald-400 hover:text-emerald-300 text-[11px] flex items-center gap-1 px-2 py-1 rounded bg-emerald-900/30 border border-emerald-800/50 shrink-0"
            title="Open in WhatsApp"
          >
            💬 Open Chat
          </button>
        </div>
        <select
          value={contact.stage}
          onChange={(e) => onStageChange(contact, e.target.value)}
          className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
        >
          {CONTACT_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              {t(`crm.stages.${stage}`)}
            </option>
          ))}
        </select>
        {contact.stage === "do_not_contact" && (
          <p className="text-[10px] text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded px-2 py-1">
            Opted out. Do not send marketing or bulk messages.
          </p>
        )}
      </div>

      {/* Custom fields + timeline */}
      <ContactInsights accountId={accountId} contact={contact} />

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
          {notes.map((note) => (
            <li
              key={note.id}
              className="rounded bg-dona-panel border border-dona-border p-2 text-xs text-gray-200"
            >
              {note.body}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
