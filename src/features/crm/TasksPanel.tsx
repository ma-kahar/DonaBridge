import {
  CalendarClock,
  Check,
  Circle,
  Flame,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  type ContactDto,
  type CrmTaskDto,
  type DealDto,
  crmDeleteTask,
  crmListDeals,
  crmListPipelines,
  crmListTasks,
  crmUpsertTask,
} from "../../lib/ipc";

type TaskFilter = "today" | "upcoming" | "overdue" | "done" | "all";

const FILTERS: { id: TaskFilter; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "overdue", label: "Overdue" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

interface TasksPanelProps {
  accountId: string;
  contacts: ContactDto[];
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export default function TasksPanel({ accountId, contacts }: TasksPanelProps) {
  const [tasks, setTasks] = useState<CrmTaskDto[]>([]);
  const [deals, setDeals] = useState<DealDto[]>([]);
  const [filter, setFilter] = useState<TaskFilter>("today");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("medium");
  const [contactId, setContactId] = useState("");
  const [dealId, setDealId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await crmListTasks(accountId);
      if (cancelled) return;
      setTasks(list);
      const pipelines = await crmListPipelines();
      const pipelineId =
        pipelines.find((p) => p.pipeline.is_default)?.pipeline.id ||
        pipelines[0]?.pipeline.id;
      if (pipelineId) {
        const dealList = await crmListDeals(accountId, pipelineId);
        if (!cancelled) setDeals(dealList);
      }
    })().catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const counts = useMemo(() => {
    const now = new Date();
    const todayEnd = endOfToday();
    const open = tasks.filter((t) => t.status !== "done");
    return {
      today: open.filter((t) => {
        if (!t.due_at) return false;
        const d = new Date(t.due_at);
        return d <= todayEnd;
      }).length,
      upcoming: open.filter((t) => t.due_at && new Date(t.due_at) > todayEnd).length,
      overdue: open.filter((t) => t.due_at && new Date(t.due_at) < now).length,
      done: tasks.filter((t) => t.status === "done").length,
      all: tasks.length,
    };
  }, [tasks]);

  const visible = useMemo(() => {
    const now = new Date();
    const todayEnd = endOfToday();
    return tasks.filter((task) => {
      const isDone = task.status === "done";
      if (filter === "done") return isDone;
      if (isDone) return false;
      if (filter === "all") return true;
      if (!task.due_at) return false;
      const d = new Date(task.due_at);
      if (filter === "today") return d <= todayEnd;
      if (filter === "upcoming") return d > todayEnd;
      if (filter === "overdue") return d < now;
      return true;
    });
  }, [tasks, filter]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      const saved = await crmUpsertTask({
        id: "",
        account_id: accountId,
        contact_id: contactId || null,
        deal_id: dealId || null,
        title: title.trim(),
        notes: null,
        due_at: due ? new Date(due).toISOString() : null,
        priority,
        status: "open",
        notified: false,
        completed_at: null,
        created_at: null,
      });
      setTasks((prev) => [saved, ...prev]);
      setTitle("");
      setDue("");
      setPriority("medium");
      setContactId("");
      setDealId("");
      setShowForm(false);
    } catch (err) {
      setError(String(err));
    }
  }

  async function toggle(task: CrmTaskDto) {
    const next: CrmTaskDto = { ...task, status: task.status === "done" ? "open" : "done" };
    const saved = await crmUpsertTask(next);
    setTasks((prev) => prev.map((t) => (t.id === saved.id ? saved : t)));
  }

  async function remove(id: string) {
    await crmDeleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                filter === f.id
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "bg-dona-panel border-dona-border text-gray-400 hover:text-white"
              }`}
            >
              {f.label} {counts[f.id] > 0 && <span className="opacity-70">({counts[f.id]})</span>}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white shrink-0"
          title="Add task"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 break-words rounded bg-red-950/30 border border-red-900/40 px-2 py-1">
          {error}
        </p>
      )}

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="rounded-lg bg-dona-panel border border-blue-700/50 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">New task</span>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-white"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
            >
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
            >
              <option value="">No contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name || c.phone_e164}
                </option>
              ))}
            </select>
            <select
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
            >
              <option value="">No deal</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="w-full py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
          >
            Add task
          </button>
        </form>
      )}

      {visible.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">
          {filter === "done" ? "No completed tasks yet." : "Nothing here. Enjoy the quiet."}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((task) => {
            const contact = contacts.find((c) => c.id === task.contact_id);
            const deal = deals.find((d) => d.id === task.deal_id);
            const overdue =
              task.status !== "done" &&
              task.due_at &&
              new Date(task.due_at) < new Date();
            return (
              <li
                key={task.id}
                className={`rounded-lg border p-2 flex items-start gap-2 ${
                  task.status === "done"
                    ? "bg-dona-panel/40 border-dona-border/60 opacity-70"
                    : overdue
                      ? "bg-red-950/20 border-red-900/50"
                      : "bg-dona-panel border-dona-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => void toggle(task)}
                  className={`mt-0.5 shrink-0 ${
                    task.status === "done" ? "text-emerald-400" : "text-gray-500 hover:text-white"
                  }`}
                  aria-label={task.status === "done" ? "Reopen task" : "Complete task"}
                >
                  {task.status === "done" ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs leading-snug ${
                      task.status === "done" ? "line-through text-gray-400" : "text-white"
                    }`}
                  >
                    {task.priority === "high" && <Flame className="w-3 h-3 inline text-red-400 mr-1" />}
                    {task.title}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">
                    {contact ? contact.display_name || contact.phone_e164 : "No contact"}
                    {deal ? ` · ${deal.title}` : ""}
                  </p>
                  {task.due_at && (
                    <p
                      className={`text-[10px] inline-flex items-center gap-1 ${
                        overdue ? "text-red-400" : "text-gray-500"
                      }`}
                    >
                      <CalendarClock className="w-2.5 h-2.5" />
                      {new Date(task.due_at).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void remove(task.id)}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                  aria-label="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
