import { AlertTriangle, BarChart3, CheckCircle2, Clock, Target, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type CrmReportDto,
  type PipelineWithStagesDto,
  crmListPipelines,
  crmReport,
} from "../../lib/ipc";

interface ReportsPanelProps {
  accountId: string;
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

function Kpi({
  label,
  value,
  sub,
  tone = "text-white",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-0.5">
      <p className="text-[10px] text-gray-400 inline-flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className={`text-sm font-semibold ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
    </div>
  );
}

export default function ReportsPanel({ accountId }: ReportsPanelProps) {
  const [pipelines, setPipelines] = useState<PipelineWithStagesDto[]>([]);
  const [pipelineId, setPipelineId] = useState("");
  const [report, setReport] = useState<CrmReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void crmListPipelines()
      .then((list) => {
        if (cancelled) return;
        setPipelines(list);
        const pid =
          list.find((p) => p.pipeline.is_default)?.pipeline.id || list[0]?.pipeline.id || "";
        setPipelineId(pid);
      })
      .catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pipelineId) return;
    let cancelled = false;
    void crmReport(accountId, pipelineId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => setError(String(err)));
    return () => {
      cancelled = true;
    };
  }, [accountId, pipelineId]);

  const maxStageValue = Math.max(1, ...(report?.stages.map((s) => s.value) ?? [1]));

  return (
    <div className="space-y-3 max-w-5xl">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="w-4 h-4 text-blue-400 shrink-0" />
        <select
          value={pipelineId}
          onChange={(e) => setPipelineId(e.target.value)}
          className="flex-1 min-w-0 rounded bg-dona-panel border border-dona-border px-2 py-1 text-xs text-gray-200"
        >
          {pipelines.map((p) => (
            <option key={p.pipeline.id} value={p.pipeline.id}>
              {p.pipeline.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-[11px] text-red-400 break-words rounded bg-red-950/30 border border-red-900/40 px-2 py-1">
          {error}
        </p>
      )}

      {!report ? (
        <p className="text-xs text-gray-500 text-center py-6">Loading report…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Kpi
              label="Open pipeline"
              value={money(report.open_value, report.currency)}
              sub={`${report.open_count} open deals`}
              icon={<TrendingUp className="w-3 h-3" />}
            />
            <Kpi
              label="Won"
              value={money(report.won_value, report.currency)}
              sub={`${report.won_count} deals`}
              tone="text-emerald-400"
              icon={<CheckCircle2 className="w-3 h-3" />}
            />
            <Kpi
              label="Win rate"
              value={`${report.win_rate.toFixed(0)}%`}
              sub={`${report.won_count} won · ${report.lost_count} lost`}
              tone="text-blue-300"
              icon={<Target className="w-3 h-3" />}
            />
            <Kpi
              label="Average deal"
              value={money(report.avg_deal_value, report.currency)}
              sub="open deals only"
            />
            <Kpi
              label="Open tasks"
              value={String(report.open_tasks)}
              sub={`${report.overdue_tasks} overdue`}
              tone={report.overdue_tasks > 0 ? "text-amber-400" : "text-white"}
              icon={<Clock className="w-3 h-3" />}
            />
            <Kpi
              label="Last 30 days"
              value={`${report.deals_last_30_days} deals`}
              sub={`${report.won_last_30_days} won`}
            />
          </div>

          <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2">
            <p className="text-[11px] font-semibold text-white">Pipeline by stage</p>
            <ul className="space-y-2">
              {report.stages.map((stage) => (
                <li key={stage.stage_id} className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-300 inline-flex items-center gap-1.5 min-w-0">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="truncate">{stage.name}</span>
                    </span>
                    <span className="text-gray-400 shrink-0">
                      {stage.count} · {money(stage.value, report.currency)}
                    </span>
                  </div>
                  <div className="h-1.5 rounded bg-dona-dark overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{
                        width: `${Math.max(2, (stage.value / maxStageValue) * 100)}%`,
                        backgroundColor: stage.color,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {report.overdue_tasks > 0 && (
            <p className="text-[11px] text-amber-400 inline-flex items-center gap-1.5 rounded bg-amber-950/20 border border-amber-900/40 px-2 py-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {report.overdue_tasks} task{report.overdue_tasks === 1 ? "" : "s"} overdue — check the
              Tasks tab.
            </p>
          )}

          <p className="text-[10px] text-gray-500">
            Values are grouped per pipeline and use the pipeline's most common currency.
          </p>
        </>
      )}
    </div>
  );
}
