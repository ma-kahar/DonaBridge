import {
  ArrowRight,
  BarChart3,
  Bot,
  CheckSquare,
  Columns3,
  DollarSign,
  MoreVertical,
  Phone,
  Plus,
  Search,
  TrendingUp,
  User,
  UserPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type ContactDto,
  type CrmReportDto,
  crmListPipelines,
  crmReport,
} from "../../lib/ipc";

interface CrmDashboardProps {
  accountId: string;
  contacts: ContactDto[];
  search: string;
  onSearch: (value: string) => void;
  onAddContact: () => void;
  onCreatePipeline: () => void;
  onAddTask: () => void;
  onViewReports: () => void;
  onOpenCopilot: () => void;
  onViewAllContacts: () => void;
  onSelectContact: (contact: ContactDto) => void;
  onOpenChat: (contact: ContactDto) => void;
}

function initials(contact: ContactDto): string {
  const name = contact.display_name || contact.phone_e164;
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "Active";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "Active";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

function StatCard({
  icon,
  value,
  label,
  tone,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  tone: string;
}) {
  return (
    <div className="dona-card p-3 flex flex-col items-center text-center gap-1">
      <span className={`w-8 h-8 rounded-full flex items-center justify-center ${tone}`}>
        {icon}
      </span>
      <span className="text-base font-semibold text-dona-fg leading-none pt-0.5">{value}</span>
      <span className="text-[10px] text-dona-muted leading-tight">{label}</span>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dona-card px-1 py-3 flex flex-col items-center gap-1.5 hover:border-dona-accent/40 transition-colors"
    >
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center ${tone}`}>
        {icon}
      </span>
      <span className="text-[10px] text-dona-fg leading-tight text-center">{label}</span>
    </button>
  );
}

export default function CrmDashboard({
  accountId,
  contacts,
  search,
  onSearch,
  onAddContact,
  onCreatePipeline,
  onAddTask,
  onViewReports,
  onOpenCopilot,
  onViewAllContacts,
  onSelectContact,
  onOpenChat,
}: CrmDashboardProps) {
  const [report, setReport] = useState<CrmReportDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pipelines = await crmListPipelines();
        const pipelineId =
          pipelines.find((p) => p.pipeline.is_default)?.pipeline.id ||
          pipelines[0]?.pipeline.id;
        if (!pipelineId) return;
        const next = await crmReport(accountId, pipelineId);
        if (!cancelled) setReport(next);
      } catch {
        // The dashboard still renders with contact-only metrics.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const total = contacts.length;
  const wonContacts = contacts.filter((c) => c.stage === "won").length;
  const conversion =
    report && report.won_count + report.lost_count > 0
      ? report.win_rate
      : total > 0
        ? (wonContacts / total) * 100
        : 0;
  const currency = report?.currency || "USD";
  const revenue = report?.won_value ?? 0;
  const recent = contacts.slice(0, 5);

  return (
    <div className="space-y-3">
      {/* Search + add */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-dona-muted" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search contacts…"
            className="w-full rounded-xl bg-dona-panel2 border border-dona-border pl-9 pr-3 py-2 text-xs text-dona-fg focus:outline-none focus:ring-1 focus:ring-dona-accent"
          />
        </div>
        <button
          type="button"
          onClick={onAddContact}
          className="w-9 h-9 rounded-xl bg-dona-accent hover:bg-dona-accentHover text-white flex items-center justify-center shrink-0"
          aria-label="Add contact"
          title="Add contact"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={<User className="w-4 h-4" />}
          value={String(total)}
          label="Total Contacts"
          tone="bg-dona-accent/10 text-dona-accent"
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          value={`${Math.round(conversion)}%`}
          label="Conversion"
          tone="bg-emerald-500/10 text-emerald-500"
        />
        <StatCard
          icon={<DollarSign className="w-4 h-4" />}
          value={money(revenue, currency)}
          label="Revenue"
          tone="bg-amber-500/10 text-amber-500"
        />
      </div>

      {/* Quick actions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-dona-fg">Quick Actions</h3>
          <button
            type="button"
            onClick={onViewAllContacts}
            className="text-[10px] text-dona-accent inline-flex items-center gap-0.5 hover:underline"
          >
            View All <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <QuickAction
            icon={<UserPlus className="w-4 h-4" />}
            label="Add Contact"
            tone="bg-dona-accent/10 text-dona-accent"
            onClick={onAddContact}
          />
          <QuickAction
            icon={<Columns3 className="w-4 h-4" />}
            label="Create Pipeline"
            tone="bg-violet-500/10 text-violet-500"
            onClick={onCreatePipeline}
          />
          <QuickAction
            icon={<CheckSquare className="w-4 h-4" />}
            label="Add Task"
            tone="bg-sky-500/10 text-sky-500"
            onClick={onAddTask}
          />
          <QuickAction
            icon={<BarChart3 className="w-4 h-4" />}
            label="View Reports"
            tone="bg-amber-500/10 text-amber-500"
            onClick={onViewReports}
          />
        </div>
      </div>

      {/* Recent contacts */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-dona-fg">Recent Contacts</h3>
          <button
            type="button"
            onClick={onViewAllContacts}
            className="text-[10px] text-dona-accent inline-flex items-center gap-0.5 hover:underline"
          >
            View All <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        {recent.length === 0 ? (
          <div className="dona-card p-4 text-center">
            <p className="text-[11px] text-dona-muted">
              No contacts yet. Add your first contact to get started.
            </p>
          </div>
        ) : (
          <div className="dona-card divide-y divide-dona-border overflow-hidden">
            {recent.map((contact) => (
              <div key={contact.id} className="flex items-center gap-2 px-2.5 py-2">
                <span className="w-8 h-8 rounded-full bg-dona-accent/10 text-dona-accent flex items-center justify-center text-[10px] font-bold shrink-0">
                  {initials(contact) || "?"}
                </span>
                <button
                  type="button"
                  onClick={() => onSelectContact(contact)}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-xs font-medium text-dona-fg truncate">
                    {contact.display_name || contact.phone_e164}
                  </p>
                  <p className="text-[10px] text-dona-muted truncate">
                    {contact.updated_at ? `Active · ${timeAgo(contact.updated_at)}` : "Active"}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenChat(contact)}
                  className="w-7 h-7 rounded-full bg-dona-accent/10 text-dona-accent flex items-center justify-center shrink-0 hover:bg-dona-accent/20"
                  title="Open chat"
                  aria-label={`Open chat with ${contact.display_name || contact.phone_e164}`}
                >
                  <Phone className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectContact(contact)}
                  className="text-dona-muted hover:text-dona-fg shrink-0"
                  title="Contact details"
                  aria-label="Contact details"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI Copilot */}
      <div className="rounded-2xl border border-dona-accent/25 bg-gradient-to-br from-dona-accent/15 via-dona-accent/5 to-transparent p-3 space-y-2">
        <div className="flex items-start gap-2">
          <span className="w-8 h-8 rounded-xl bg-dona-accent/15 text-dona-accent flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-dona-fg">AI Copilot</p>
            <p className="text-[10px] text-dona-muted leading-snug">
              Get insights, prepare replies and more — always draft-only.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenCopilot}
          className="w-full py-1.5 rounded-lg bg-dona-accent hover:bg-dona-accentHover text-white text-[11px] font-medium inline-flex items-center justify-center gap-1"
        >
          Open AI Copilot <ArrowRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
