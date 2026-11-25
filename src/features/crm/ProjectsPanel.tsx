import {
  CheckSquare,
  Columns3,
  List,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ContactDto } from "../../lib/ipc";

export interface CrmTask {
  id: string;
  title: string;
  priority: "low" | "medium" | "high";
  importance: "normal" | "important" | "urgent";
  done: boolean;
  tags: string[];
  dueAt?: string;
  notified?: boolean;
}

export interface CrmProject {
  id: string;
  name: string;
  contactId: string;
  status: "active" | "on_hold" | "completed";
  dueDate: string;
  category: string;
  tasks: CrmTask[];
}

function storageKey(accountId: string) {
  return `dona_crm_projects_${accountId}`;
}
function loadProjects(accountId: string): CrmProject[] {
  try {
    const raw = localStorage.getItem(storageKey(accountId));
    if (raw) return JSON.parse(raw) as CrmProject[];
  } catch {}
  return [];
}
function saveProjects(accountId: string, projects: CrmProject[]) {
  localStorage.setItem(storageKey(accountId), JSON.stringify(projects));
}

const PRIORITY_COLORS: Record<CrmTask["priority"], string> = {
  low: "text-gray-400",
  medium: "text-amber-400",
  high: "text-red-400",
};

const IMPORTANCE_LABELS: Record<CrmTask["importance"], string> = {
  normal: "",
  important: "⭐",
  urgent: "🔥",
};

const STATUS_LABELS: Record<CrmProject["status"], string> = {
  active: "🟢 Active",
  on_hold: "🟡 On Hold",
  completed: "✅ Done",
};

interface ProjectsPanelProps {
  accountId: string;
  contacts: ContactDto[];
}

export default function ProjectsPanel({ accountId, contacts }: ProjectsPanelProps) {
  const [projects, setProjects] = useState<CrmProject[]>(() => loadProjects(accountId));
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  // Add Project form
  const [name, setName] = useState("");
  const [contactId, setContactId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState("");

  // Add Task
  const [taskInputs, setTaskInputs] = useState<Record<string, string>>({});
  const [taskPriorities, setTaskPriorities] = useState<Record<string, CrmTask["priority"]>>({});
  const [taskImportance, setTaskImportance] = useState<Record<string, CrmTask["importance"]>>({});
  const [taskDueDates, setTaskDueDates] = useState<Record<string, string>>({});

  useEffect(() => {
    setProjects(loadProjects(accountId));
  }, [accountId]);

  // Task due reminder check every 30s
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = loadProjects(accountId).map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => {
          if (!t.done && t.dueAt && !t.notified && new Date(t.dueAt).getTime() <= now) {
            changed = true;
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(`Dona Bridge · Task Due (${p.name})`, { body: t.title });
            }
            return { ...t, notified: true };
          }
          return t;
        }),
      }));
      if (changed) {
        setProjects(next);
        saveProjects(accountId, next);
      }
    }, 30000);
    return () => clearInterval(id);
  }, [accountId]);

  function persist(next: CrmProject[]) {
    setProjects(next);
    saveProjects(accountId, next);
  }

  function handleAddProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const proj: CrmProject = {
      id: Date.now().toString(),
      name: name.trim(),
      contactId,
      status: "active",
      dueDate,
      category: category.trim(),
      tasks: [],
    };
    persist([proj, ...projects]);
    setName("");
    setContactId("");
    setDueDate("");
    setCategory("");
  }

  function handleAddTask(projectId: string) {
    const title = (taskInputs[projectId] ?? "").trim();
    if (!title) return;
    const priority = taskPriorities[projectId] ?? "medium";
    const importance = taskImportance[projectId] ?? "normal";
    const dueAt = taskDueDates[projectId] || undefined;
    if (dueAt && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    persist(
      projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              tasks: [
                ...p.tasks,
                {
                  id: Date.now().toString(),
                  title,
                  priority,
                  importance,
                  done: false,
                  tags: [],
                  dueAt,
                  notified: false,
                },
              ],
            }
          : p
      )
    );
    setTaskInputs((prev) => ({ ...prev, [projectId]: "" }));
    setTaskDueDates((prev) => ({ ...prev, [projectId]: "" }));
  }

  function toggleTask(projectId: string, taskId: string) {
    persist(
      projects.map((p) =>
        p.id === projectId
          ? {
              ...p,
              tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, done: !t.done } : t)),
            }
          : p
      )
    );
  }

  function deleteTask(projectId: string, taskId: string) {
    persist(
      projects.map((p) =>
        p.id === projectId ? { ...p, tasks: p.tasks.filter((t) => t.id !== taskId) } : p
      )
    );
  }

  function updateStatus(projectId: string, status: CrmProject["status"]) {
    persist(projects.map((p) => (p.id === projectId ? { ...p, status } : p)));
  }

  function deleteProject(projectId: string) {
    persist(projects.filter((p) => p.id !== projectId));
  }

  // Gather unique categories
  const categories = [...new Set(projects.map((p) => p.category).filter(Boolean))];

  // Filtered list
  const filtered = projects.filter((p) => {
    const q = search.trim().toLowerCase();
    const matchSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (contacts.find((c) => c.id === p.contactId)?.display_name || "")
        .toLowerCase()
        .includes(q);
    const matchCat = !categoryFilter || p.category === categoryFilter;
    return matchSearch && matchCat;
  });

  // ProjectCard reused in both list and kanban
  function ProjectCard({ p }: { p: CrmProject }) {
    const total = p.tasks.length;
    const doneCount = p.tasks.filter((t) => t.done).length;
    const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);
    const client = contacts.find((c) => c.id === p.contactId);

    return (
      <div
        draggable
        onDragStart={(e) => e.dataTransfer.setData("text/project-id", p.id)}
        className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2 cursor-grab active:cursor-grabbing"
      >
        {/* Project header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">{p.name}</p>
            {client && (
              <p className="text-[10px] text-blue-400 truncate">
                👤 {client.display_name || client.phone_e164}
              </p>
            )}
            {p.category && (
              <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-purple-900/40 border border-purple-700/40 text-purple-300 mt-0.5">
                {p.category}
              </span>
            )}
            {p.dueDate && (
              <p className="text-[10px] text-gray-500 mt-0.5">📅 {p.dueDate}</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <select
              value={p.status}
              onChange={(e) => updateStatus(p.id, e.target.value as CrmProject["status"])}
              className="rounded bg-dona-dark border border-dona-border px-1 py-0.5 text-[10px] text-gray-200"
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Done</option>
            </select>
            <button
              type="button"
              onClick={() => deleteProject(p.id)}
              className="text-gray-500 hover:text-red-400"
              aria-label="Delete project"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>
              Tasks: {doneCount}/{total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-dona-dark overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Task list */}
        {p.tasks.length > 0 && (
          <ul className="space-y-1 pt-1">
            {p.tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => toggleTask(p.id, task.id)}
                  className="text-gray-400 hover:text-white shrink-0"
                >
                  {task.done ? (
                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                </button>
                <span
                  className={`flex-1 truncate ${
                    task.done ? "line-through text-gray-500" : "text-gray-200"
                  }`}
                >
                  {IMPORTANCE_LABELS[task.importance ?? "normal"]} {task.title}
                  {task.dueAt && (
                    <span className="ml-1 text-[9px] text-amber-400">
                      ⏰ {new Date(task.dueAt).toLocaleString()}
                    </span>
                  )}
                </span>
                <span className={`text-[9px] uppercase ${PRIORITY_COLORS[task.priority]}`}>
                  {task.priority}
                </span>
                <button
                  type="button"
                  onClick={() => deleteTask(p.id, task.id)}
                  className="text-gray-600 hover:text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add task */}
        <div className="flex gap-1 pt-1">
          <input
            type="text"
            value={taskInputs[p.id] ?? ""}
            onChange={(e) =>
              setTaskInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddTask(p.id);
              }
            }}
            placeholder="Add task..."
            className="flex-1 rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
          />
          <select
            value={taskPriorities[p.id] ?? "medium"}
            onChange={(e) =>
              setTaskPriorities((prev) => ({
                ...prev,
                [p.id]: e.target.value as CrmTask["priority"],
              }))
            }
            className="rounded bg-dona-dark border border-dona-border px-1 py-1 text-[10px] text-gray-300"
          >
            <option value="low">Low</option>
            <option value="medium">Med</option>
            <option value="high">High</option>
          </select>
          <select
            value={taskImportance[p.id] ?? "normal"}
            onChange={(e) =>
              setTaskImportance((prev) => ({
                ...prev,
                [p.id]: e.target.value as CrmTask["importance"],
              }))
            }
            className="rounded bg-dona-dark border border-dona-border px-1 py-1 text-[10px] text-gray-300"
          >
            <option value="normal">—</option>
            <option value="important">⭐</option>
            <option value="urgent">🔥</option>
          </select>
          <button
            type="button"
            onClick={() => handleAddTask(p.id)}
            className="px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white"
            aria-label="Add task"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <input
          type="datetime-local"
          value={taskDueDates[p.id] ?? ""}
          onChange={(e) =>
            setTaskDueDates((prev) => ({ ...prev, [p.id]: e.target.value }))
          }
          title="Task reminder time"
          className="w-full rounded bg-dona-dark border border-dona-border px-2 py-0.5 text-[10px] text-gray-300"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Add Project Form */}
      <form
        onSubmit={handleAddProject}
        className="space-y-2 rounded-lg bg-dona-panel border border-dona-border p-2.5"
      >
        <input
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name..."
          className="w-full rounded bg-dona-dark border border-dona-border px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="flex gap-1.5">
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="flex-1 rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
          >
            <option value="">No client linked</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.phone_e164}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Category..."
            className="w-24 rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-gray-200"
          />
        </div>
        <div className="flex gap-1.5">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="flex-1 rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
      </form>

      {/* Search + View Mode + Category filter */}
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full pl-6 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-white"
          />
        </div>
        <button
          type="button"
          onClick={() => setViewMode(viewMode === "list" ? "kanban" : "list")}
          className="p-1.5 rounded bg-dona-panel border border-dona-border text-gray-300 hover:text-white"
          title={viewMode === "list" ? "Kanban view" : "List view"}
        >
          {viewMode === "list" ? (
            <Columns3 className="w-3.5 h-3.5" />
          ) : (
            <List className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Category filter chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategoryFilter("")}
            className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
              categoryFilter === ""
                ? "bg-blue-600 border-blue-500 text-white"
                : "bg-dona-panel border-dona-border text-gray-400"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(categoryFilter === cat ? "" : cat)}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                categoryFilter === cat
                  ? "bg-purple-600/40 border-purple-500 text-purple-100"
                  : "bg-dona-panel border-dona-border text-gray-400"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Project list / Kanban */}
      {filtered.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-6">No projects yet.</p>
      ) : viewMode === "kanban" ? (
        /* Kanban: 3 columns by status */
        <div className="grid grid-cols-1 gap-3">
          {(["active", "on_hold", "completed"] as const).map((status) => {
            const cols = filtered.filter((p) => p.status === status);
            return (
              <div
                key={status}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const projId = e.dataTransfer.getData("text/project-id");
                  if (projId) updateStatus(projId, status);
                }}
                className="rounded-lg bg-dona-panel/50 border border-dona-border p-2 space-y-2 min-h-[64px]"
              >
                <div className="text-[11px] font-semibold text-gray-300 flex items-center justify-between">
                  <span>{STATUS_LABELS[status]}</span>
                  <span className="text-gray-500">{cols.length}</span>
                </div>
                {cols.map((p) => (
                  <ProjectCard key={p.id} p={p} />
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
