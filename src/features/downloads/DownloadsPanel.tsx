import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clearDownloads,
  type DownloadRecord,
  downloadsFolder,
  listDownloads,
  openDownload,
  removeDownload,
  revealDownload,
} from "../../lib/ipc";
import { useAppStore } from "../../store";

interface DownloadsPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toUpperCase() : "FILE";
}

export default function DownloadsPanel({ open, onClose }: DownloadsPanelProps) {
  const { t } = useTranslation();
  const accounts = useAppStore((s) => s.accounts);
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRecords(await listDownloads());
      setFolder(await downloadsFolder());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void refresh();
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listen("download-finished", () => {
      void refresh();
    }).then((fn) => {
      if (alive) unlisten = fn;
      else fn();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [open, refresh]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) => {
      const account = accounts.find((item) => item.id === record.account_id);
      return (
        record.file_name.toLowerCase().includes(query) ||
        (account?.name.toLowerCase().includes(query) ?? false)
      );
    });
  }, [records, search, accounts]);

  const totalBytes = records.reduce((sum, record) => sum + record.bytes, 0);

  async function handleOpen(record: DownloadRecord) {
    setError(null);
    setBusyId(record.id);
    try {
      await openDownload(record.path);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleReveal(record: DownloadRecord) {
    setError(null);
    try {
      await revealDownload(record.path);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRemove(record: DownloadRecord, deleteFile: boolean) {
    const message = deleteFile
      ? `Delete “${record.file_name}” from disk? This cannot be undone.`
      : `Remove “${record.file_name}” from the download list? The file stays on disk.`;
    if (!window.confirm(message)) return;
    setError(null);
    setBusyId(record.id);
    try {
      await removeDownload(record.id, deleteFile);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleClear() {
    if (!window.confirm("Clear the download history? Files on disk are kept.")) return;
    try {
      await clearDownloads();
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleOpenFolder() {
    try {
      if (!folder) setFolder(await downloadsFolder());
      if (folder) await openDownload(folder);
    } catch (err) {
      setError(String(err));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close downloads"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-3xl h-[80vh] rounded-2xl border border-dona-border bg-dona-panel shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-dona-border shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white inline-flex items-center gap-2">
              <Download className="w-4 h-4 text-blue-400" />
              Downloads
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-dona-border text-gray-400">
                {records.length} files · {formatBytes(totalBytes)}
              </span>
            </p>
            <p className="text-[10px] text-gray-500 truncate">
              Saved to {folder || "…"}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void refresh()}
              title="Refresh"
              aria-label="Refresh downloads"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => void handleOpenFolder()}
              className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open folder
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="p-1.5 rounded-lg text-dona-muted hover:text-dona-fg hover:bg-white/5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-b border-dona-border shrink-0">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search downloads…"
              className="w-full rounded-lg bg-dona-dark border border-dona-border pl-8 pr-3 py-1.5 text-xs text-gray-200"
            />
          </div>
          {records.length > 0 && (
            <button
              type="button"
              onClick={() => void handleClear()}
              className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-300"
            >
              Clear history
            </button>
          )}
        </div>

        {error && (
          <p className="mx-5 mt-3 text-[11px] text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-2.5 py-2 break-words">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center gap-3 py-10">
              <div className="w-14 h-14 rounded-2xl bg-dona-panel2 border border-dona-border flex items-center justify-center">
                <Download className="w-6 h-6 text-gray-500" />
              </div>
              <p className="text-sm font-medium text-white">
                {records.length === 0 ? "No downloads yet" : "No matching downloads"}
              </p>
              <p className="text-[11px] text-gray-400 max-w-sm">
                PDFs, images and documents you download in WhatsApp appear here and are saved in
                <span className="text-gray-200"> Downloads\Dona Bridge</span>.
              </p>
              <button
                type="button"
                onClick={() => void handleOpenFolder()}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-medium text-white inline-flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open downloads folder
              </button>
            </div>
          ) : (
            filtered.map((record) => {
              const account = accounts.find((item) => item.id === record.account_id);
              const disabled = busyId === record.id || !record.path || !record.success;
              return (
                <div
                  key={record.id}
                  className="rounded-xl border border-dona-border bg-dona-dark p-3 flex items-center gap-3"
                >
                  <div className="relative w-10 h-10 rounded-lg bg-dona-panel2 border border-dona-border flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-blue-400" />
                    <span className="absolute -bottom-1 -right-1 text-[7px] font-bold px-1 py-0.5 rounded bg-dona-panel border border-dona-border text-gray-400">
                      {extensionOf(record.file_name)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate" title={record.file_name}>
                      {record.file_name}
                    </p>
                    <p className="text-[10px] text-gray-500 truncate">
                      {account?.name ?? "Unknown account"} · {formatBytes(record.bytes)} ·{" "}
                      {new Date(record.created_at).toLocaleString()}
                    </p>
                    <p className="text-[10px] truncate inline-flex items-center gap-1">
                      {record.success ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-amber-500" />
                      )}
                      <span className={record.success ? "text-emerald-500" : "text-amber-500"}>
                        {record.success ? "Downloaded" : "Failed"}
                      </span>
                      {record.path && (
                        <span className="text-gray-600 truncate">· {record.path}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleOpen(record)}
                      title="Open file"
                      aria-label={`Open ${record.file_name}`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleReveal(record)}
                      title="Show in folder"
                      aria-label={`Show ${record.file_name} in folder`}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === record.id}
                      onClick={() => void handleRemove(record, false)}
                      title="Remove from list"
                      aria-label={`Remove ${record.file_name} from the list`}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-white/5 disabled:opacity-30"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busyId === record.id || !record.path}
                      onClick={() => void handleRemove(record, true)}
                      title="Delete file"
                      aria-label={`Delete ${record.file_name}`}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-white/5 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="px-5 py-2.5 border-t border-dona-border text-[10px] text-gray-500 flex items-center justify-between gap-2 shrink-0">
          <span className="truncate">{folder || "Downloads\\Dona Bridge"}</span>
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className="text-blue-400 hover:underline inline-flex items-center gap-1 shrink-0"
          >
            <FolderOpen className="w-3 h-3" />
            Open folder
          </button>
        </div>
      </div>
    </div>
  );
}
