import {
  Clock,
  FileText,
  History,
  MessageSquare,
  Plus,
  Settings2,
  Target,
  Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  type ContactDto,
  type CustomFieldDto,
  type TimelineEntryDto,
  crmContactTimeline,
  crmDeleteCustomField,
  crmGetContactFields,
  crmListCustomFields,
  crmSetContactField,
  crmUpsertCustomField,
} from "../../lib/ipc";

interface ContactInsightsProps {
  accountId: string;
  contact: ContactDto;
}

function kindIcon(kind: string) {
  switch (kind) {
    case "note":
      return <FileText className="w-3 h-3 text-blue-400" />;
    case "stage":
      return <Target className="w-3 h-3 text-purple-400" />;
    case "deal":
      return <Target className="w-3 h-3 text-emerald-400" />;
    case "task":
      return <Clock className="w-3 h-3 text-amber-400" />;
    case "contact":
      return <MessageSquare className="w-3 h-3 text-gray-400" />;
    default:
      return <History className="w-3 h-3 text-gray-400" />;
  }
}

export default function ContactInsights({ accountId, contact }: ContactInsightsProps) {
  const [fields, setFields] = useState<CustomFieldDto[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [timeline, setTimeline] = useState<TimelineEntryDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [manage, setManage] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("text");
  const [newOptions, setNewOptions] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [fieldList, valueList, entries] = await Promise.all([
          crmListCustomFields(accountId),
          crmGetContactFields(contact.id),
          crmContactTimeline(contact.id),
        ]);
        if (cancelled) return;
        setFields(fieldList);
        const map: Record<string, string> = {};
        for (const value of valueList) map[value.field_id] = value.value;
        setValues(map);
        setDrafts(map);
        setTimeline(entries);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, contact.id]);

  async function saveField(fieldId: string) {
    const value = drafts[fieldId] ?? "";
    if ((values[fieldId] ?? "") === value) return;
    try {
      await crmSetContactField(contact.id, fieldId, value);
      setValues((prev) => ({ ...prev, [fieldId]: value }));
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleAddField(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      const options =
        newType === "select"
          ? JSON.stringify(
              newOptions
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            )
          : null;
      const saved = await crmUpsertCustomField({
        id: "",
        account_id: accountId,
        name: newName.trim(),
        field_type: newType,
        options,
        sort_order: fields.length,
      });
      setFields((prev) => [...prev, saved]);
      setNewName("");
      setNewOptions("");
      setNewType("text");
    } catch (err) {
      setError(String(err));
    }
  }

  async function removeField(field: CustomFieldDto) {
    if (!window.confirm(`Delete the "${field.name}" field from every contact?`)) return;
    await crmDeleteCustomField(field.id);
    setFields((prev) => prev.filter((f) => f.id !== field.id));
  }

  function optionsOf(field: CustomFieldDto): string[] {
    try {
      const parsed = JSON.parse(field.options || "[]") as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-[11px] text-red-400 break-words rounded bg-red-950/30 border border-red-900/40 px-2 py-1">
          {error}
        </p>
      )}

      {/* Custom fields */}
      <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold text-white">Details</p>
          <button
            type="button"
            onClick={() => setManage((m) => !m)}
            className={`p-1 rounded ${manage ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            title="Manage custom fields"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="text-[10px] text-gray-500">
            Add fields like Company, City, Birthday or “How did you find us?”.
          </p>
        ) : (
          <div className="space-y-1.5">
            {fields.map((field) => {
              const options = optionsOf(field);
              return (
                <div key={field.id} className="block space-y-0.5">
                  <span className="text-[10px] text-gray-400">{field.name}</span>
                  {field.field_type === "select" ? (
                    <select
                      aria-label={field.name}
                      value={drafts[field.id] ?? ""}
                      onChange={(e) => {
                        setDrafts((prev) => ({ ...prev, [field.id]: e.target.value }));
                        void crmSetContactField(contact.id, field.id, e.target.value);
                      }}
                      className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
                    >
                      <option value="">—</option>
                      {options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.name}
                      type={
                        field.field_type === "number"
                          ? "number"
                          : field.field_type === "date"
                            ? "date"
                            : "text"
                      }
                      value={drafts[field.id] ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [field.id]: e.target.value }))
                      }
                      onBlur={() => void saveField(field.id)}
                      className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {manage && (
          <div className="border-t border-dona-border pt-2 space-y-1.5">
            {fields.map((field) => (
              <div key={field.id} className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-300 truncate">
                  {field.name} <span className="text-gray-500">({field.field_type})</span>
                </span>
                <button
                  type="button"
                  onClick={() => void removeField(field)}
                  className="text-gray-500 hover:text-red-400"
                  aria-label={`Delete ${field.name}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <form onSubmit={handleAddField} className="space-y-1">
              <div className="flex gap-1">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name"
                  className="flex-1 min-w-0 rounded bg-dona-dark border border-dona-border px-1.5 py-1 text-[11px] text-white"
                />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="rounded bg-dona-dark border border-dona-border px-1 py-1 text-[10px] text-gray-200"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="select">Select</option>
                </select>
              </div>
              {newType === "select" && (
                <input
                  value={newOptions}
                  onChange={(e) => setNewOptions(e.target.value)}
                  placeholder="Options, comma separated"
                  className="w-full rounded bg-dona-dark border border-dona-border px-1.5 py-1 text-[10px] text-white"
                />
              )}
              <button
                type="submit"
                className="w-full py-1 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white inline-flex items-center justify-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add field
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-white inline-flex items-center gap-1">
          <History className="w-3.5 h-3.5 text-blue-400" /> Timeline
        </p>
        {timeline.length === 0 ? (
          <p className="text-[10px] text-gray-500">No activity yet.</p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {timeline.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="flex gap-2">
                <span className="mt-0.5 shrink-0">{kindIcon(entry.kind)}</span>
                <div className="min-w-0">
                  <p className="text-[11px] text-gray-200 leading-snug">
                    <span className="text-gray-400">{entry.title}: </span>
                    {entry.body}
                  </p>
                  {entry.at && (
                    <p className="text-[9px] text-gray-500">
                      {new Date(entry.at).toLocaleString()}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
