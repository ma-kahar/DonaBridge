/**
 * QuickReplyBar — editable quick-reply chips for per-account message templates.
 * Features:
 *  - Click chip → inserts text into WhatsApp draft
 *  - Edit (pencil icon) → inline edit, colour change
 *  - Delete (trash icon) → remove
 *  - Add (+) → new chip
 *  - Persisted to localStorage (per accountId key) until IPC backend ready
 */

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { crmInsertDraft } from "../lib/ipc";

export interface QuickReply {
  id: string;
  text: string;
  color: string;
}

const COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

function storageKey(accountId: string) {
  return `dona_quickreplies_${accountId}`;
}

function load(accountId: string): QuickReply[] {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (raw) return JSON.parse(raw) as QuickReply[];
  } catch {}
  return [
    { id: "1", text: "👍 Got it, thanks!", color: "#3b82f6" },
    { id: "2", text: "I'll get back to you shortly.", color: "#10b981" },
    { id: "3", text: "Can we schedule a call?", color: "#8b5cf6" },
  ];
}

function save(accountId: string, replies: QuickReply[]) {
  localStorage.setItem(storageKey(accountId), JSON.stringify(replies));
}

interface QuickReplyBarProps {
  accountId: string;
}

export default function QuickReplyBar({ accountId }: QuickReplyBarProps) {
  const [replies, setReplies] = useState<QuickReply[]>(() => load(accountId));
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editColor, setEditColor] = useState(COLORS[0]);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [newColor, setNewColor] = useState(COLORS[0]);

  // Reload when account switches
  useEffect(() => {
    setReplies(load(accountId));
    setEditing(null);
    setAdding(false);
  }, [accountId]);

  function persist(next: QuickReply[]) {
    setReplies(next);
    save(accountId, next);
  }

  function startEdit(r: QuickReply) {
    setEditing(r.id);
    setEditText(r.text);
    setEditColor(r.color);
  }

  function saveEdit() {
    if (!editText.trim() || !editing) return;
    persist(replies.map((r) => (r.id === editing ? { ...r, text: editText.trim(), color: editColor } : r)));
    setEditing(null);
  }

  function deleteReply(id: string) {
    persist(replies.filter((r) => r.id !== id));
    if (editing === id) setEditing(null);
  }

  function addReply() {
    if (!newText.trim()) return;
    const newReply: QuickReply = {
      id: Date.now().toString(),
      text: newText.trim(),
      color: newColor,
    };
    persist([...replies, newReply]);
    setNewText("");
    setNewColor(COLORS[0]);
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-1 p-2 border-t border-dona-border bg-dona-dark/80">
      <div className="flex items-center gap-1 overflow-x-auto pb-1 no-scrollbar">
        {replies.map((r) =>
          editing === r.id ? (
            // Inline edit mode
            <div
              key={r.id}
              className="flex items-center gap-1 rounded-lg border border-blue-500 bg-dona-panel px-2 py-1 shrink-0"
            >
              <input
                autoFocus
                type="text"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-32 bg-transparent text-xs text-white outline-none"
              />
              {/* Color swatches */}
              <div className="flex gap-0.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    className={`w-3 h-3 rounded-full border-2 ${editColor === c ? "border-white" : "border-transparent"}`}
                    style={{ backgroundColor: c }}
                    aria-label={c}
                  />
                ))}
              </div>
              <button type="button" onClick={saveEdit} className="text-emerald-400 hover:text-emerald-300">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={() => setEditing(null)} className="text-gray-400 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            // Normal chip
            <div
              key={r.id}
              className="group flex items-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-medium text-white shrink-0 transition-opacity"
              style={{ backgroundColor: r.color + "30", border: `1px solid ${r.color}60` }}
            >
              <button
                type="button"
                onClick={() => void crmInsertDraft(accountId, r.text)}
                className="max-w-[140px] truncate"
                style={{ color: r.color }}
                title={r.text}
              >
                {r.text}
              </button>
              <button
                type="button"
                onClick={() => startEdit(r)}
                className="ml-0.5 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-opacity"
                aria-label="Edit"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={() => deleteReply(r.id)}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 transition-opacity"
                aria-label="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        )}

        {/* Add new */}
        {adding ? (
          <div className="flex items-center gap-1 rounded-lg border border-blue-500 bg-dona-panel px-2 py-1 shrink-0">
            <input
              autoFocus
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addReply();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="Quick reply text…"
              className="w-32 bg-transparent text-xs text-white outline-none"
            />
            <div className="flex gap-0.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNewColor(c)}
                  className={`w-3 h-3 rounded-full border-2 ${newColor === c ? "border-white" : "border-transparent"}`}
                  style={{ backgroundColor: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <button type="button" onClick={addReply} className="text-emerald-400 hover:text-emerald-300">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 w-7 h-7 rounded-full bg-dona-panel border border-dona-border flex items-center justify-center text-gray-400 hover:text-white hover:border-blue-500 transition-colors"
            aria-label="Add quick reply"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
