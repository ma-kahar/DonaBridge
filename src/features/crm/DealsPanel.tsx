import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Plus,
  Settings2,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  type ContactDto,
  type DealDto,
  type PipelineStageDto,
  type PipelineWithStagesDto,
  crmDeleteDeal,
  crmDeletePipeline,
  crmDeleteStage,
  crmListDeals,
  crmListPipelines,
  crmMoveDeal,
  crmUpsertDeal,
  crmUpsertPipeline,
  crmUpsertStage,
} from "../../lib/ipc";

const CURRENCIES = ["USD", "EUR", "GBP", "BDT", "INR", "AED", "SAR"];

interface DealsPanelProps {
  accountId: string;
  contacts: ContactDto[];
  expanded: boolean;
}

interface DealForm {
  id: string;
  title: string;
  contactId: string;
  stageId: string;
  value: string;
  currency: string;
  probability: string;
  expectedClose: string;
  lostReason: string;
}

function emptyForm(stageId: string): DealForm {
  return {
    id: "",
    title: "",
    contactId: "",
    stageId,
    value: "",
    currency: "USD",
    probability: "30",
    expectedClose: "",
    lostReason: "",
  };
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${value.toFixed(0)} ${currency}`;
  }
}

export default function DealsPanel({ accountId, contacts, expanded }: DealsPanelProps) {
  const [pipelines, setPipelines] = useState<PipelineWithStagesDto[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [deals, setDeals] = useState<DealDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<DealForm>(emptyForm(""));
  const [error, setError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [newStage, setNewStage] = useState("");
  const [newStageColor, setNewStageColor] = useState("#3B82F6");
  const [newPipeline, setNewPipeline] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const current = pipelines.find((p) => p.pipeline.id === pipelineId) ?? pipelines[0];
  const stages = current?.stages ?? [];

  async function loadPipelines(preferred?: string) {
    const list = await crmListPipelines();
    setPipelines(list);
    const next =
      preferred ??
      (list.find((p) => p.pipeline.id === pipelineId)?.pipeline.id ||
        list.find((p) => p.pipeline.is_default)?.pipeline.id ||
        list[0]?.pipeline.id ||
        "");
    setPipelineId(next);
    return next;
  }

  const loadDeals = useCallback(
    async (pid: string) => {
      if (!pid) return;
      setDeals(await crmListDeals(accountId, pid));
    },
    [accountId]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await crmListPipelines();
      if (cancelled) return;
      setPipelines(list);
      const pid =
        list.find((p) => p.pipeline.is_default)?.pipeline.id || list[0]?.pipeline.id || "";
      setPipelineId(pid);
      if (pid) setDeals(await crmListDeals(accountId, pid));
    })().catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (pipelineId) {
      void loadDeals(pipelineId).catch((err) => setError(String(err)));
    }
  }, [pipelineId, loadDeals]);

  const totals = useMemo(() => {
    const open = deals.filter((d) => d.status === "open");
    return {
      count: open.length,
      value: open.reduce((sum, d) => sum + d.value, 0),
    };
  }, [deals]);

  function openNew(stageId?: string) {
    setForm(emptyForm(stageId || stages[0]?.id || ""));
    setShowForm(true);
    setError(null);
  }

  function openEdit(deal: DealDto) {
    setForm({
      id: deal.id,
      title: deal.title,
      contactId: deal.contact_id ?? "",
      stageId: deal.stage_id,
      value: String(deal.value),
      currency: deal.currency || "USD",
      probability: String(deal.probability ?? 0),
      expectedClose: deal.expected_close?.slice(0, 10) ?? "",
      lostReason: deal.lost_reason ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.stageId) return;
    try {
      const saved = await crmUpsertDeal({
        id: form.id,
        account_id: accountId,
        contact_id: form.contactId || null,
        pipeline_id: pipelineId,
        stage_id: form.stageId,
        title: form.title.trim(),
        value: Number.parseFloat(form.value) || 0,
        currency: form.currency,
        probability: Number.parseInt(form.probability, 10) || 0,
        expected_close: form.expectedClose || null,
        owner: null,
        status: "open",
        lost_reason: form.lostReason.trim() || null,
        sort_order: form.id ? 0 : deals.filter((d) => d.stage_id === form.stageId).length,
      });
      setDeals((prev) =>
        prev.some((d) => d.id === saved.id)
          ? prev.map((d) => (d.id === saved.id ? saved : d))
          : [...prev, saved]
      );
      setShowForm(false);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleMove(dealId: string, stageId: string) {
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === stageId) return;
    try {
      const order = deals.filter((d) => d.stage_id === stageId).length;
      const moved = await crmMoveDeal(dealId, stageId, order);
      setDeals((prev) => prev.map((d) => (d.id === dealId ? moved : d)));
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this deal? This cannot be undone.")) return;
    await crmDeleteDeal(id);
    setDeals((prev) => prev.filter((d) => d.id !== id));
    setShowForm(false);
  }

  async function handleAddStage(e: FormEvent) {
    e.preventDefault();
    if (!newStage.trim() || !current) return;
    const stage: PipelineStageDto = {
      id: "",
      pipeline_id: current.pipeline.id,
      name: newStage.trim(),
      color: newStageColor,
      sort_order: stages.length,
      wip_limit: 0,
      is_won: false,
      is_lost: false,
    };
    const saved = await crmUpsertStage(stage);
    setPipelines((prev) =>
      prev.map((p) =>
        p.pipeline.id === current.pipeline.id ? { ...p, stages: [...p.stages, saved] } : p
      )
    );
    setNewStage("");
  }

  async function handleUpdateStage(stage: PipelineStageDto, patch: Partial<PipelineStageDto>) {
    const saved = await crmUpsertStage({ ...stage, ...patch });
    setPipelines((prev) =>
      prev.map((p) =>
        p.pipeline.id === saved.pipeline_id
          ? { ...p, stages: p.stages.map((s) => (s.id === saved.id ? saved : s)) }
          : p
      )
    );
  }

  async function handleDeleteStage(stage: PipelineStageDto) {
    if (!window.confirm(`Delete the "${stage.name}" stage? Its deals move to the first stage.`))
      return;
    try {
      await crmDeleteStage(stage.id);
      const next = await loadPipelines(current?.pipeline.id);
      await loadDeals(next);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleAddPipeline(e: FormEvent) {
    e.preventDefault();
    if (!newPipeline.trim()) return;
    try {
      const saved = await crmUpsertPipeline({
        id: "",
        name: newPipeline.trim(),
        is_default: false,
        sort_order: pipelines.length,
      });
      await crmUpsertStage({
        id: "",
        pipeline_id: saved.id,
        name: "New",
        color: "#3B82F6",
        sort_order: 0,
        wip_limit: 0,
        is_won: false,
        is_lost: false,
      });
      setNewPipeline("");
      const next = await loadPipelines(saved.id);
      await loadDeals(next);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleDeletePipeline() {
    if (!current) return;
    if (!window.confirm(`Delete the "${current.pipeline.name}" pipeline and all of its deals?`))
      return;
    try {
      await crmDeletePipeline(current.pipeline.id);
      const next = await loadPipelines();
      await loadDeals(next);
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5">
        <select
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="flex-1 min-w-0 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-gray-200"
        >
          {pipelines.map((p) => (
            <option key={p.pipeline.id} value={p.pipeline.id}>
              {p.pipeline.name}
              {p.pipeline.is_default ? " ★" : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setManage((m) => !m)}
          className={`p-1.5 rounded border ${manage ? "bg-blue-600 border-blue-500 text-white" : "bg-dona-panel border-dona-border text-gray-300 hover:text-white"}`}
          title="Manage pipelines and stages"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => openNew()}
          className="px-2 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white inline-flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Deal
        </button>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between rounded-lg bg-dona-panel border border-dona-border px-2.5 py-2 text-[11px]">
        <span className="text-gray-400 inline-flex items-center gap-1">
          <TrendingUp className="w-3.5 h-3.5" /> {totals.count} open
        </span>
        <span className="text-emerald-400 font-semibold">
          {money(
            totals.value,
            deals.find((d) => d.status === "open")?.currency || "USD"
          )}
        </span>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 break-words rounded bg-red-950/30 border border-red-900/40 px-2 py-1">
          {error}
        </p>
      )}

      {/* Pipeline manager */}
      {manage && current && (
        <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2">
          <p className="text-[11px] font-semibold text-white">Stages · {current.pipeline.name}</p>
          <ul className="space-y-1.5">
            {stages.map((stage) => (
              <li key={stage.id} className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={stage.color}
                  onChange={(e) => void handleUpdateStage(stage, { color: e.target.value })}
                  className="h-6 w-6 rounded border border-dona-border bg-transparent p-0.5"
                />
                <input
                  defaultValue={stage.name}
                  onBlur={(e) => {
                    const name = e.target.value.trim();
                    if (name && name !== stage.name) void handleUpdateStage(stage, { name });
                  }}
                  className="flex-1 min-w-0 rounded bg-dona-dark border border-dona-border px-1.5 py-1 text-[11px] text-white"
                />
                <label className="text-[9px] text-gray-500 inline-flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={stage.is_won}
                    onChange={(e) =>
                      void handleUpdateStage(stage, {
                        is_won: e.target.checked,
                        is_lost: e.target.checked ? false : stage.is_lost,
                      })
                    }
                  />
                  Won
                </label>
                <label className="text-[9px] text-gray-500 inline-flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={stage.is_lost}
                    onChange={(e) =>
                      void handleUpdateStage(stage, {
                        is_lost: e.target.checked,
                        is_won: e.target.checked ? false : stage.is_won,
                      })
                    }
                  />
                  Lost
                </label>
                <button
                  type="button"
                  onClick={() => void handleDeleteStage(stage)}
                  className="text-gray-500 hover:text-red-400"
                  title="Delete stage"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={handleAddStage} className="flex items-center gap-1.5">
            <input
              type="color"
              value={newStageColor}
              onChange={(e) => setNewStageColor(e.target.value)}
              className="h-6 w-6 rounded border border-dona-border bg-transparent p-0.5"
            />
            <input
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
              placeholder="New stage"
              className="flex-1 min-w-0 rounded bg-dona-dark border border-dona-border px-1.5 py-1 text-[11px] text-white"
            />
            <button
              type="submit"
              className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-[11px] text-white"
            >
              Add
            </button>
          </form>

          <div className="border-t border-dona-border pt-2 space-y-1.5">
            <form onSubmit={handleAddPipeline} className="flex items-center gap-1.5">
              <input
                value={newPipeline}
                onChange={(e) => setNewPipeline(e.target.value)}
                placeholder="New pipeline"
                className="flex-1 min-w-0 rounded bg-dona-dark border border-dona-border px-1.5 py-1 text-[11px] text-white"
              />
              <button
                type="submit"
                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-[11px] text-white"
              >
                Add
              </button>
            </form>
            {!current.pipeline.is_default && (
              <button
                type="button"
                onClick={() => void handleDeletePipeline()}
                className="text-[10px] text-red-400 hover:underline"
              >
                Delete this pipeline
              </button>
            )}
          </div>
        </div>
      )}

      {/* Deal form */}
      {showForm && (
        <form
          onSubmit={handleSave}
          className="rounded-lg bg-dona-panel border border-blue-700/50 p-2.5 space-y-1.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-white">
              {form.id ? "Edit deal" : "New deal"}
            </span>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
              }}
              className="text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Deal title (e.g. 50 units — winter order)"
            className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-white"
          />
          <select
            value={form.contactId}
            onChange={(e) => setForm({ ...form, contactId: e.target.value })}
            className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
          >
            <option value="">No contact</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name || c.phone_e164}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="Value"
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-white"
            />
            <select
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              max="100"
              value={form.probability}
              onChange={(e) => setForm({ ...form, probability: e.target.value })}
              placeholder="Probability %"
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-white"
            />
            <input
              type="date"
              value={form.expectedClose}
              onChange={(e) => setForm({ ...form, expectedClose: e.target.value })}
              className="rounded bg-dona-dark border border-dona-border px-2 py-1 text-[11px] text-white"
            />
          </div>
          <select
            value={form.stageId}
            onChange={(e) => setForm({ ...form, stageId: e.target.value })}
            className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-gray-200"
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {stages.find((s) => s.id === form.stageId)?.is_lost && (
            <input
              value={form.lostReason}
              onChange={(e) => setForm({ ...form, lostReason: e.target.value })}
              placeholder="Lost reason"
              className="w-full rounded bg-dona-dark border border-dona-border px-2 py-1 text-xs text-white"
            />
          )}
          <div className="flex items-center justify-between pt-1">
            {form.id ? (
              <button
                type="button"
                onClick={() => void handleDelete(form.id)}
                className="text-[11px] text-red-400 hover:underline inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            ) : (
              <span />
            )}
            <button
              type="submit"
              className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-xs text-white"
            >
              Save deal
            </button>
          </div>
        </form>
      )}

      {/* Board */}
      {deals.length === 0 && !showForm ? (
        <div className="text-center py-6 space-y-2">
          <Columns3 className="w-6 h-6 mx-auto text-gray-600" />
          <p className="text-xs text-gray-500">No deals yet. Add one to start the pipeline.</p>
          <button
            type="button"
            onClick={() => openNew()}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            Add first deal
          </button>
        </div>
      ) : (
        <div className={`flex gap-2 ${expanded ? "items-stretch" : ""} overflow-x-auto pb-1`}>
          {stages.map((stage) => {
            const stageDeals = deals.filter((d) => d.stage_id === stage.id);
            const value = stageDeals.reduce((sum, d) => sum + d.value, 0);
            const isCollapsed = collapsed[stage.id];
            return (
              <div
                key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/deal-id");
                  if (id) void handleMove(id, stage.id);
                }}
                className={`rounded-lg bg-dona-panel/60 border border-dona-border p-2 space-y-1.5 min-h-[180px] ${
                  expanded ? "flex-1 min-w-[220px]" : "w-[220px] shrink-0"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [stage.id]: !c[stage.id] }))}
                  className="w-full flex items-center gap-1 text-[11px] font-semibold text-gray-300"
                >
                  {isCollapsed ? (
                    <ChevronRight className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="truncate">{stage.name}</span>
                  <span className="ml-auto text-gray-500">{stageDeals.length}</span>
                </button>
                {!isCollapsed && (
                  <>
                    <p className="text-[10px] text-emerald-400/80 pl-4">
                      {money(value, stageDeals[0]?.currency || "USD")}
                    </p>
                    {stageDeals.map((deal) => {
                      const contact = contacts.find((c) => c.id === deal.contact_id);
                      return (
                        <button
                          key={deal.id}
                          type="button"
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData("text/deal-id", deal.id)
                          }
                          onClick={() => openEdit(deal)}
                          className="cursor-grab active:cursor-grabbing text-left w-full rounded bg-dona-dark border border-dona-border p-2 space-y-1 hover:border-blue-500"
                        >
                          <span className="block text-xs text-white leading-snug line-clamp-2">
                            {deal.title}
                          </span>
                          {contact && (
                            <span className="block text-[10px] text-gray-400 truncate">
                              {contact.display_name || contact.phone_e164}
                            </span>
                          )}
                          <span className="flex items-center justify-between text-[10px]">
                            <span className="text-emerald-400 font-medium">
                              {money(deal.value, deal.currency)}
                            </span>
                            <span className="text-gray-500">{deal.probability}%</span>
                          </span>
                          {deal.expected_close && (
                            <span className="block text-[10px] text-gray-500">
                              {new Date(deal.expected_close).toLocaleDateString()}
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => openNew(stage.id)}
                      className="w-full flex items-center justify-center gap-1 text-[10px] text-gray-500 hover:text-white py-1 rounded hover:bg-white/5"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
