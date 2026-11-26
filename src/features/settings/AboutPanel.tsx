import { check } from "@tauri-apps/plugin-updater";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Bug,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FolderOpen,
  Github,
  HardDrive,
  Heart,
  Info,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { appHealth, type HealthReport } from "../../lib/ipc";

const REPO = "https://github.com/ma-kahar/DonaBridge";
const RELEASES = `${REPO}/releases/latest`;
const ISSUES = `${REPO}/issues`;
const README = `${REPO}/blob/master/README.md`;

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function openExternal(url: string) {
  void openUrl(url).catch(() => {});
}

function reveal(path: string | undefined) {
  if (!path) return;
  void revealItemInDir(path).catch(() => {});
}

export default function AboutPanel() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void appHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const version = health?.version ?? "0.2.0";
  const build = health?.build_profile ?? "release";

  function systemInfo(): string {
    return [
      `Dona Bridge ${version} (${build})`,
      `Tauri: ${health?.tauri_version ?? "?"}`,
      `WebView2: ${health?.webview_version ?? "?"}`,
      `OS: ${health?.os ?? "?"}`,
      `Database schema: v${health?.schema_version ?? "?"}`,
      `Data folder: ${health?.data_dir ?? "?"}`,
      `Logs: ${health?.log_dir ?? "?"}`,
      `Backups: ${health?.backup_dir ?? "?"}`,
    ].join("\n");
  }

  async function handleCopyInfo() {
    try {
      await navigator.clipboard.writeText(systemInfo());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function handleCheckUpdates() {
    setUpdateBusy(true);
    setUpdateStatus(null);
    try {
      const update = await check();
      if (update?.available) {
        setUpdateStatus(`Version ${update.version} is available. Download it from GitHub Releases.`);
      } else {
        setUpdateStatus("You are on the latest version.");
      }
    } catch {
      setUpdateStatus(
        "Automatic updates are not configured for this build. Download the latest installer from GitHub Releases."
      );
    } finally {
      setUpdateBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Hero */}
      <div className="rounded-xl border border-dona-border bg-gradient-to-br from-dona-panel2 to-dona-panel p-5">
        <div className="flex items-start gap-4">
          <img
            src="/favicon.png"
            alt="Dona Bridge"
            className="w-14 h-14 rounded-2xl border border-dona-border bg-dona-panel object-contain p-1"
          />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-white">Dona Bridge</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-dona-border bg-dona-panel text-gray-300">
                v{version}
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-400">
                {build}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              A multi-account WhatsApp Web workspace with a local CRM, safety net and integrations.
              Everything stays on this PC.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button
                type="button"
                onClick={() => openExternal(RELEASES)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-medium text-white inline-flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Latest release
              </button>
              <button
                type="button"
                onClick={() => openExternal(REPO)}
                className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
              >
                <Github className="w-3.5 h-3.5" />
                Source code
              </button>
              <button
                type="button"
                onClick={() => void handleCheckUpdates()}
                disabled={updateBusy}
                className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${updateBusy ? "animate-spin" : ""}`} />
                Check for updates
              </button>
            </div>
            {updateStatus && (
              <p className="text-[11px] text-gray-300 mt-2 break-words">{updateStatus}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* System */}
        <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
          <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
            <Monitor className="w-3.5 h-3.5 text-blue-400" />
            System information
          </p>
          <dl className="text-[11px] space-y-1">
            {[
              ["Version", `v${version} (${build})`],
              ["Tauri", health?.tauri_version ?? "—"],
              ["WebView2", health?.webview_version ?? "—"],
              ["Operating system", health?.os ?? "—"],
              ["Database schema", health ? `v${health.schema_version}` : "—"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-gray-500">{label}</dt>
                <dd className="text-gray-200 text-right break-all">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-dona-border/60 pt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCopyInfo()}
              className="px-2.5 py-1 rounded-lg border border-dona-border hover:bg-white/5 text-[10px] text-gray-200 inline-flex items-center gap-1"
            >
              {copied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied" : "Copy system info"}
            </button>
            <button
              type="button"
              onClick={() => reveal(health?.log_dir)}
              className="px-2.5 py-1 rounded-lg border border-dona-border hover:bg-white/5 text-[10px] text-gray-200 inline-flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" />
              Open logs
            </button>
          </div>
        </div>

        {/* Storage */}
        <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
          <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            Local data
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <p className="text-gray-500">Database</p>
              <p className="text-gray-200">
                {formatBytes(health?.db_bytes ?? 0)}
                {health?.wal_bytes ? ` + ${formatBytes(health.wal_bytes)} WAL` : ""}
              </p>
            </div>
            <div>
              <p className="text-gray-500">Backups</p>
              <p className="text-gray-200">{formatBytes(health?.backups_bytes ?? 0)}</p>
            </div>
            <div>
              <p className="text-gray-500">Accounts</p>
              <p className="text-gray-200">
                {health?.account_count ?? 0} · {health?.group_count ?? 0} groups
              </p>
            </div>
            <div>
              <p className="text-gray-500">WebView2 profiles</p>
              <p className="text-gray-200">
                {health?.webview_profiles ?? 0} · {formatBytes(health?.webview_bytes ?? 0)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => reveal(health?.data_dir)}
              className="px-2.5 py-1 rounded-lg border border-dona-border hover:bg-white/5 text-[10px] text-gray-200 inline-flex items-center gap-1"
            >
              <Database className="w-3 h-3" />
              Data folder
            </button>
            <button
              type="button"
              onClick={() => reveal(health?.backup_dir)}
              className="px-2.5 py-1 rounded-lg border border-dona-border hover:bg-white/5 text-[10px] text-gray-200 inline-flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" />
              Backups
            </button>
          </div>
          <p className="text-[10px] text-gray-500 break-all">
            {health?.data_dir ?? "%LOCALAPPDATA%\\com.makahar.donabridge"}
          </p>
        </div>

        {/* Features */}
        <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
          <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-violet-400" />
            What is inside
          </p>
          <ul className="text-[11px] text-gray-400 space-y-1.5">
            {[
              "Multiple isolated WhatsApp Web accounts in one window",
              "Automatic snapshots, crash recovery and encrypted backups",
              "Local CRM with pipelines, deals, tasks and reports",
              "Signed webhooks and a read-only local API",
              "Optional AI drafts — never sends a message for you",
              "App Lock and per-account PIN protection",
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-500 shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => openExternal(README)}
            className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            <BookOpen className="w-3 h-3" />
            Read the full feature guide
          </button>
        </div>

        {/* Legal & credits */}
        <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
          <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
            Credits &amp; legal
          </p>
          <p className="text-[11px] text-gray-400">
            Built by <span className="text-gray-200">Donatek</span>. Licensed under the MIT
            License.
          </p>
          <p className="text-[10px] text-gray-500">
            Powered by Tauri 2, Rust, React, SQLite and Microsoft WebView2.
          </p>
          <div className="rounded-lg bg-amber-950/30 border border-amber-900/40 px-2.5 py-2 text-[10px] text-amber-200">
            Dona Bridge is an independent client for WhatsApp Web. It is not affiliated with,
            endorsed by or sponsored by WhatsApp or Meta. Messages are only ever drafted — the app
            never sends automatically.
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => openExternal(ISSUES)}
              className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <Bug className="w-3 h-3" />
              Report an issue
            </button>
            <button
              type="button"
              onClick={() => openExternal(`${REPO}/blob/master/LICENSE`)}
              className="text-[10px] text-blue-400 hover:underline inline-flex items-center gap-1"
            >
              <Info className="w-3 h-3" />
              MIT License
            </button>
          </div>
          <p className="text-[10px] text-gray-500 inline-flex items-center gap-1 pt-1">
            <Heart className="w-3 h-3 text-red-400" />
            Made for people who live in WhatsApp.
          </p>
        </div>
      </div>

      {/* Release highlights */}
      <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
        <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5 text-blue-400" />
          Highlights
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-gray-400">
          <span>• Detailed About screen with live system information</span>
          <span>• Crash detection and one-click snapshot restore</span>
          <span>• Encrypted folder and WebDAV backups</span>
          <span>• Portable CRM JSON export/import</span>
          <span>• HMAC-signed webhooks and local API</span>
          <span>• Frameless WhatsApp-green title bar</span>
          <span>• Light/dark theme selector and contrast fixes</span>
        </div>
        <p className="text-[10px] text-gray-500">
          {t("settings.aboutCredit")}
        </p>
      </div>
    </div>
  );
}
