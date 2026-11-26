import {
  CheckCircle2,
  CloudUpload,
  Copy,
  Download,
  EyeOff,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  KeyRound,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { check as checkForUpdates } from "@tauri-apps/plugin-updater";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AccountGroupDto,
  type AiProfile,
  type ApiSettings,
  type AutoBackupSettings,
  type HealthReport,
  type McpStatus,
  type WebDavSettings,
  type WebDavTestResult,
  type WebhookSettings,
  type WebhookTestResult,
  aiDeleteProfile,
  aiDetectModels,
  aiListProfiles,
  aiSetActiveProfile,
  aiUpsertProfile,
  appHealth,
  apiSettings,
  autoBackupSettings,
  backupEncrypted,
  backupRecoveryCode,
  clearDndSchedule,
  createAutoBackupNow,
  crmExportDealsCsv,
  crmExportJson,
  crmExportTasksCsv,
  crmHasData,
  crmImportJson,
  createSnapshot,
  deleteAccountGroup,
  exportDiagnostics,
  listAccountGroups,
  mcpRotateToken,
  mcpStart,
  mcpStatus,
  mcpStop,
  restoreEncrypted,
  restoreSnapshot,
  rotateApiToken,
  rotateWebhookSecret,
  saveAutoBackupSettings,
  saveApiSettings,
  apiToken,
  setBackupRecoveryCode,
  securityClearPin,
  securityLockStatus,
  securitySetPin,
  setDndSchedule,
  testWebhook,
  upsertAccountGroup,
  saveWebdavSettings,
  webdavSettings,
  webdavTest,
  webdavUploadNow,
  webhookSecret,
  webhookSettings,
  saveWebhookSettings,
} from "../../lib/ipc";
import { type Account, useAppStore } from "../../store";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onEditAccount: (account: Account) => void;
}

type SettingsTab = "general" | "accounts" | "ai" | "security" | "data" | "integrations" | "mcp";

const WEBHOOK_EVENT_GROUPS: { label: string; events: string[] }[] = [
  {
    label: "Contacts",
    events: ["contact.created", "contact.updated", "contact.deleted"],
  },
  {
    label: "Deals",
    events: ["deal.created", "deal.updated", "deal.deleted"],
  },
  {
    label: "Tasks",
    events: ["task.created", "task.updated", "task.deleted"],
  },
];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const PROVIDER_DEFAULTS: Record<string, { model: string; base_url: string }> = {
  ollama: { model: "llama3.2", base_url: "http://localhost:11434" },
  openai: { model: "gpt-4o-mini", base_url: "https://api.openai.com" },
  anthropic: { model: "claude-3-5-haiku-latest", base_url: "https://api.anthropic.com" },
  deepseek: { model: "deepseek-chat", base_url: "https://api.deepseek.com" },
  kimi: { model: "moonshot-v1-8k", base_url: "https://api.moonshot.cn" },
  openrouter: { model: "anthropic/claude-3.5-haiku", base_url: "https://openrouter.ai/api" },
  custom: { model: "gpt-4o-mini", base_url: "https://api.example.com" },
};

export default function SettingsModal({ open, onClose, onEditAccount }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const [tab, setTab] = useState<SettingsTab>("general");

  const [hasPin, setHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [mcp, setMcp] = useState<McpStatus>({ running: false, port: null, has_token: false });
  const [dndTimes, setDndTimes] = useState<Record<string, { start: string; end: string }>>({});
  const [dndStatus, setDndStatus] = useState<string | null>(null);
  const [backupPass, setBackupPass] = useState("");
  const [restorePath, setRestorePath] = useState("");
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [autoBackup, setAutoBackup] = useState<AutoBackupSettings | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [showRecoveryCode, setShowRecoveryCode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [crmBusy, setCrmBusy] = useState(false);
  const [crmStatus, setCrmStatus] = useState<string | null>(null);
  const [crmAccountId, setCrmAccountId] = useState("");
  const [webhook, setWebhook] = useState<WebhookSettings | null>(null);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<string | null>(null);
  const [webhookTest, setWebhookTest] = useState<WebhookTestResult | null>(null);
  const [webhookSecretValue, setWebhookSecretValue] = useState<string | null>(null);
  const [webdav, setWebdav] = useState<WebDavSettings | null>(null);
  const [webdavPassword, setWebdavPassword] = useState("");
  const [webdavBusy, setWebdavBusy] = useState(false);
  const [webdavStatus, setWebdavStatus] = useState<string | null>(null);
  const [webdavTestResult, setWebdavTestResult] = useState<WebDavTestResult | null>(null);
  const [api, setApi] = useState<ApiSettings | null>(null);
  const [apiBusy, setApiBusy] = useState(false);
  const [apiStatus, setApiStatus] = useState<string | null>(null);
  const [apiSecretValue, setApiSecretValue] = useState<string | null>(null);

  const [groups, setGroups] = useState<AccountGroupDto[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#25D366");

  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);

  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  // Multi-profile AI state
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [editingProfileId, setEditingProfileId] = useState("");
  const [profileName, setProfileName] = useState("Local Ollama");
  const [provider, setProvider] = useState("ollama");
  const [model, setModel] = useState("llama3.2");
  const [baseUrl, setBaseUrl] = useState("http://localhost:11434");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectStatus, setDetectStatus] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);

  useEffect(() => {
    if (!open) return;
    void securityLockStatus().then((s) => setHasPin(s.has_pin));
    void mcpStatus().then(setMcp);
    void aiListProfiles().then(setProfiles);
    void listAccountGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
    void isAutostartEnabled()
      .then(setAutostartEnabled)
      .catch((err) => setAutostartError(String(err)));
  }, [open]);

  // The health report walks the WebView2 profile folders, so only load it when
  // the Data tab is actually open.
  useEffect(() => {
    if (!open || tab !== "data") return;
    void appHealth()
      .then(setHealth)
      .catch((err) => setBackupStatus(String(err)));
    void autoBackupSettings()
      .then(setAutoBackup)
      .catch((err) => setBackupStatus(String(err)));
    void webdavSettings()
      .then(setWebdav)
      .catch((err) => setWebdavStatus(String(err)));
  }, [open, tab]);

  useEffect(() => {
    if (crmAccountId) return;
    const preferred =
      accounts.find((account) => account.id === activeAccountId) ?? accounts[0];
    if (preferred) setCrmAccountId(preferred.id);
  }, [accounts, activeAccountId, crmAccountId]);

  useEffect(() => {
    if (!open || tab !== "integrations") return;
    void webhookSettings()
      .then(setWebhook)
      .catch((err) => setWebhookStatus(String(err)));
    void apiSettings()
      .then(setApi)
      .catch((err) => setApiStatus(String(err)));
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;  function handleProviderChange(nextProvider: string) {
    setProvider(nextProvider);
    const def = PROVIDER_DEFAULTS[nextProvider];
    if (def) {
      setModel(def.model);
      setBaseUrl(def.base_url);
    }
    setDetectedModels([]);
    setDetectStatus(null);
  }

  async function handleDetectModels() {
    setDetecting(true);
    setDetectStatus(null);
    try {
      const models = await aiDetectModels(
        provider,
        baseUrl,
        editingProfileId || undefined,
        apiKeyInput || undefined
      );
      setDetectedModels(models);
      if (models.length > 0 && !models.includes(model)) {
        setModel(models[0]);
      }
      setDetectStatus(
        models.length > 0
          ? t("settings.detectSuccess", { count: models.length })
          : t("settings.detectEmpty")
      );
    } catch (err) {
      setDetectStatus(String(err));
    } finally {
      setDetecting(false);
    }
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    const updated = await aiUpsertProfile(
      {
        id: editingProfileId,
        name: profileName.trim() || provider,
        provider,
        model: model.trim(),
        base_url: baseUrl.trim(),
        active: profiles.length === 0,
        has_key: false,
      },
      apiKeyInput.trim() || undefined
    );
    setProfiles(updated);
    setEditingProfileId("");
    setApiKeyInput("");
    setDetectStatus(null);
  }

  function startEditProfile(p: AiProfile) {
    setEditingProfileId(p.id);
    setProfileName(p.name);
    setProvider(p.provider);
    setModel(p.model);
    setBaseUrl(p.base_url);
    setApiKeyInput("");
    setDetectedModels([]);
    setDetectStatus(null);
  }

  async function handleSetPin(e: FormEvent) {
    e.preventDefault();
    if (pinInput.trim().length < 4) return;
    await securitySetPin(pinInput.trim());
    setPinInput("");
    setHasPin(true);
  }

  function applyGroups(list: AccountGroupDto[]) {
    setGroups(list);
    useAppStore.getState().setGroups(
      list.map((g) => ({ id: g.id, name: g.name, color: g.color, sortOrder: g.sort_order }))
    );
  }

  async function handleAddGroup(e: FormEvent) {
    e.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const saved = await upsertAccountGroup({
        id: "",
        name,
        color: newGroupColor,
        sort_order: groups.length,
      });
      applyGroups([...groups, saved]);
      setNewGroupName("");
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      await deleteAccountGroup(id);
      applyGroups(groups.filter((g) => g.id !== id));
      useAppStore.setState((state) => ({
        accounts: state.accounts.map((account) =>
          account.groupId === id ? { ...account, groupId: null } : account
        ),
      }));
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  async function handleToggleAutostart(next: boolean) {
    setAutostartBusy(true);
    setAutostartError(null);
    try {
      if (next) {
        await enableAutostart();
      } else {
        await disableAutostart();
      }
      setAutostartEnabled(next);
    } catch (err) {
      setAutostartError(String(err));
    } finally {
      setAutostartBusy(false);
    }
  }

  async function handleCheckUpdates() {
    setUpdateBusy(true);
    setUpdateStatus("Checking for updates…");
    try {
      const update = await checkForUpdates();
      if (!update) {
        setUpdateStatus("You are running the latest version.");
        return;
      }
      setUpdateStatus(`Version ${update.version} is available — downloading…`);
      await update.downloadAndInstall();
      setUpdateStatus("Update installed. Restart Dona Bridge to finish.");
    } catch (err) {
      const message = String(err);
      if (/not configured|no updater|endpoint|pubkey/i.test(message)) {
        setUpdateStatus("Update server is not configured in this build.");
      } else {
        setUpdateStatus(message);
      }
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleBackup() {
    if (!backupPass.trim()) return;
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const destination = await saveDialog({
        title: "Save Dona Bridge backup",
        defaultPath: `dona-backup-${new Date().toISOString().slice(0, 10)}.donabk`,
        filters: [{ name: "Dona Bridge backup", extensions: ["donabk"] }],
      });
      if (!destination) return;
      const result = await backupEncrypted(backupPass, destination);
      setBackupStatus(
        `Backup saved: ${result.accounts} accounts, ${formatBytes(result.bytes)} → ${result.path}`
      );
    } catch (err) {
      setBackupStatus(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestore() {
    if (!backupPass.trim()) return;
    setBackupBusy(true);
    setBackupStatus(null);
    try {
      const picked = await openDialog({
        title: "Choose a Dona Bridge backup",
        multiple: false,
        directory: false,
        filters: [{ name: "Dona Bridge backup", extensions: ["donabk"] }],
      });
      const path = typeof picked === "string" ? picked : restorePath;
      if (!path) return;
      setRestorePath(path);

      const confirmed = window.confirm(
        "Restore replaces all current accounts, CRM data and settings with this backup, then restarts Dona Bridge. A copy of the current database is kept in the backups folder. Continue?"
      );
      if (!confirmed) return;

      const result = await restoreEncrypted(path, backupPass);
      setBackupStatus(
        `Restore prepared (${result.accounts} accounts). Dona Bridge is restarting…`
      );
    } catch (err) {
      setBackupStatus(String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  function revealPath(path: string | undefined) {
    if (!path) return;
    void revealItemInDir(path).catch((err) => setBackupStatus(String(err)));
  }

  async function handleCreateSnapshot() {
    try {
      const path = await createSnapshot();
      setBackupStatus(`Snapshot created: ${path}`);
      setHealth(await appHealth());
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  async function handleRestoreSnapshot(path: string) {
    const confirmed = window.confirm(
      "Restore this automatic snapshot? All current accounts, CRM data and settings will be replaced, then Dona Bridge restarts. A pre-restore copy is kept in the backups folder."
    );
    if (!confirmed) return;
    try {
      await restoreSnapshot(path);
      setBackupStatus("Snapshot restored. Dona Bridge is restarting…");
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  async function handleExportDiagnostics() {
    try {
      const path = await exportDiagnostics();
      setBackupStatus(`Diagnostics exported: ${path}`);
      revealPath(path);
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  function updateAutoBackup(patch: Partial<AutoBackupSettings>) {
    setAutoBackup((current) => (current ? { ...current, ...patch } : current));
  }

  async function handleChooseBackupFolder() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Choose a folder for encrypted backups",
    });
    if (typeof picked === "string") updateAutoBackup({ folder: picked });
  }

  async function handleSaveAutoBackup() {
    if (!autoBackup) return;
    setAutoBusy(true);
    try {
      const saved = await saveAutoBackupSettings(autoBackup);
      setAutoBackup(saved);
      setBackupStatus("Automatic backup settings saved.");
    } catch (err) {
      setBackupStatus(String(err));
    } finally {
      setAutoBusy(false);
    }
  }

  async function handleAutoBackupNow() {
    if (!autoBackup) return;
    setAutoBusy(true);
    try {
      const result = await createAutoBackupNow();
      setBackupStatus(
        `Encrypted backup created (${result.accounts} accounts, ${formatBytes(result.bytes)}): ${result.path}`
      );
      setAutoBackup(await autoBackupSettings());
    } catch (err) {
      setBackupStatus(String(err));
    } finally {
      setAutoBusy(false);
    }
  }

  async function handleShowRecoveryCode() {
    try {
      const code = await backupRecoveryCode();
      setRecoveryCode(code);
      setShowRecoveryCode(true);
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  async function handleUseRecoveryCode() {
    const code = recoveryInput.trim();
    if (code.length < 8) return;
    try {
      await setBackupRecoveryCode(code);
      setRecoveryInput("");
      setBackupStatus(
        "Recovery code saved. Existing backups in this folder can now be restored."
      );
      setAutoBackup(await autoBackupSettings());
    } catch (err) {
      setBackupStatus(String(err));
    }
  }

  function crmStamp() {
    return new Date().toISOString().slice(0, 10);
  }

  function safeName(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  }

  async function handleExportCrmJson() {
    const path = await saveDialog({
      title: "Export CRM data",
      defaultPath: `dona-crm-${crmStamp()}.json`,
      filters: [{ name: "Dona CRM JSON", extensions: ["json"] }],
    });
    if (!path) return;
    setCrmBusy(true);
    setCrmStatus(null);
    try {
      const result = await crmExportJson(path);
      setCrmStatus(
        `Exported ${result.rows} rows (${formatBytes(result.bytes)}) to ${result.path}`
      );
      revealPath(result.path);
    } catch (err) {
      setCrmStatus(String(err));
    } finally {
      setCrmBusy(false);
    }
  }

  async function handleImportCrmJson() {
    const picked = await openDialog({
      multiple: false,
      title: "Import CRM data",
      filters: [{ name: "Dona CRM JSON", extensions: ["json"] }],
    });
    if (typeof picked !== "string") return;
    const hasData = await crmHasData().catch(() => true);
    const confirmed = window.confirm(
      hasData
        ? "Importing replaces ALL current CRM data (contacts, deals, tasks, notes, tags, templates and pipelines). Accounts, WhatsApp sessions and settings are not touched. A safety snapshot is saved first. Continue?"
        : "Import this CRM data? A safety snapshot is saved first. Continue?"
    );
    if (!confirmed) return;
    setCrmBusy(true);
    setCrmStatus(null);
    try {
      const summary = await crmImportJson(picked);
      setCrmStatus(
        `Imported ${summary.contacts} contacts, ${summary.deals} deals, ${summary.tasks} tasks and ${summary.notes} notes (${summary.total_rows} rows). A safety snapshot was saved.`
      );
      window.dispatchEvent(new Event("dona:crm-changed"));
      setHealth(await appHealth());
    } catch (err) {
      setCrmStatus(String(err));
    } finally {
      setCrmBusy(false);
    }
  }

  async function handleExportDealsCsv() {
    if (!crmAccountId) {
      setCrmStatus("Choose an account first.");
      return;
    }
    const account = accounts.find((item) => item.id === crmAccountId);
    const path = await saveDialog({
      title: "Export deals",
      defaultPath: `deals-${safeName(account?.name ?? "account")}-${crmStamp()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    setCrmBusy(true);
    setCrmStatus(null);
    try {
      const result = await crmExportDealsCsv(crmAccountId, path);
      setCrmStatus(`Exported ${result.rows} deal(s) to ${result.path}`);
      revealPath(result.path);
    } catch (err) {
      setCrmStatus(String(err));
    } finally {
      setCrmBusy(false);
    }
  }

  async function handleExportTasksCsv() {
    if (!crmAccountId) {
      setCrmStatus("Choose an account first.");
      return;
    }
    const account = accounts.find((item) => item.id === crmAccountId);
    const path = await saveDialog({
      title: "Export tasks",
      defaultPath: `tasks-${safeName(account?.name ?? "account")}-${crmStamp()}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;
    setCrmBusy(true);
    setCrmStatus(null);
    try {
      const result = await crmExportTasksCsv(crmAccountId, path);
      setCrmStatus(`Exported ${result.rows} task(s) to ${result.path}`);
      revealPath(result.path);
    } catch (err) {
      setCrmStatus(String(err));
    } finally {
      setCrmBusy(false);
    }
  }

  function toggleWebhookEvent(event: string) {
    setWebhook((current) => {
      if (!current) return current;
      const events = current.events.includes(event)
        ? current.events.filter((item) => item !== event)
        : [...current.events, event];
      return { ...current, events };
    });
  }

  async function handleSaveWebhook() {
    if (!webhook) return;
    setWebhookBusy(true);
    setWebhookStatus(null);
    try {
      const saved = await saveWebhookSettings(webhook);
      setWebhook(saved);
      setWebhookStatus(saved.enabled ? "Webhooks enabled." : "Webhook settings saved.");
    } catch (err) {
      setWebhookStatus(String(err));
    } finally {
      setWebhookBusy(false);
    }
  }

  async function handleTestWebhook() {
    if (!webhook) return;
    setWebhookBusy(true);
    setWebhookStatus(null);
    setWebhookTest(null);
    try {
      const saved = await saveWebhookSettings(webhook);
      setWebhook(saved);
      const result = await testWebhook();
      setWebhookTest(result);
      setWebhook(await webhookSettings());
    } catch (err) {
      setWebhookStatus(String(err));
    } finally {
      setWebhookBusy(false);
    }
  }

  async function handleRevealWebhookSecret() {
    try {
      const value = await webhookSecret();
      setWebhookSecretValue(value);
      if (!value) {
        setWebhookStatus("Save the webhook settings first to create a signing secret.");
      }
    } catch (err) {
      setWebhookStatus(String(err));
    }
  }

  async function handleRotateWebhookSecret() {
    const confirmed = window.confirm(
      "Rotate the signing secret? Update your endpoint with the new secret, otherwise its signature checks will fail."
    );
    if (!confirmed) return;
    try {
      const value = await rotateWebhookSecret();
      setWebhookSecretValue(value);
      setWebhookStatus("New signing secret created. Copy it into your endpoint now.");
      setWebhook(await webhookSettings());
    } catch (err) {
      setWebhookStatus(String(err));
    }
  }

  async function persistWebdav() {
    if (!webdav) return null;
    const saved = await saveWebdavSettings(
      webdav,
      webdavPassword.trim() ? webdavPassword : null
    );
    setWebdav(saved);
    setWebdavPassword("");
    return saved;
  }

  async function handleSaveWebdav() {
    setWebdavBusy(true);
    setWebdavStatus(null);
    setWebdavTestResult(null);
    try {
      await persistWebdav();
      setWebdavStatus("WebDAV settings saved.");
    } catch (err) {
      setWebdavStatus(String(err));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function handleTestWebdav() {
    setWebdavBusy(true);
    setWebdavStatus(null);
    setWebdavTestResult(null);
    try {
      await persistWebdav();
      setWebdavTestResult(await webdavTest());
      setWebdav(await webdavSettings());
    } catch (err) {
      setWebdavStatus(String(err));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function handleUploadWebdav() {
    setWebdavBusy(true);
    setWebdavStatus(null);
    setWebdavTestResult(null);
    try {
      await persistWebdav();
      const result = await webdavUploadNow();
      setWebdavStatus(
        `Uploaded ${result.file} (${formatBytes(result.bytes)}) — HTTP ${result.status}`
      );
      setWebdav(await webdavSettings());
    } catch (err) {
      setWebdavStatus(String(err));
    } finally {
      setWebdavBusy(false);
    }
  }

  async function persistApi() {
    if (!api) return null;
    const saved = await saveApiSettings(api, null);
    setApi(saved);
    return saved;
  }

  async function handleSaveApi() {
    setApiBusy(true);
    setApiStatus(null);
    try {
      const saved = await persistApi();
      setApiStatus(
        saved?.running
          ? `Local API running on http://127.0.0.1:${saved.port}/v1`
          : "Local API stopped."
      );
    } catch (err) {
      setApiStatus(String(err));
    } finally {
      setApiBusy(false);
    }
  }

  async function handleRevealApiToken() {
    try {
      const value = await apiToken();
      setApiSecretValue(value);
      if (!value) {
        setApiStatus("Save the API settings first to create a token.");
      }
    } catch (err) {
      setApiStatus(String(err));
    }
  }

  async function handleRotateApiToken() {
    const confirmed = window.confirm(
      "Rotate the API token? Clients using the old token will get 401 until you update them."
    );
    if (!confirmed) return;
    setApiBusy(true);
    setApiStatus(null);
    try {
      const value = await rotateApiToken();
      setApiSecretValue(value);
      setApi(await apiSettings());
      setApiStatus("New API token created. Update your client.");
    } catch (err) {
      setApiStatus(String(err));
    } finally {
      setApiBusy(false);
    }
  }

  const navItems: { id: SettingsTab; label: string; icon: typeof Globe }[] = [
    { id: "general", label: t("settings.tabGeneral"), icon: Globe },
    { id: "accounts", label: t("settings.tabAccounts"), icon: Users },
    { id: "data", label: t("settings.tabData"), icon: HardDrive },
    { id: "integrations", label: "Integrations", icon: Webhook },
    { id: "ai", label: t("settings.aiProvider"), icon: KeyRound },
    { id: "security", label: t("settings.appLock"), icon: ShieldCheck },
    { id: "mcp", label: "MCP", icon: Server },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-4xl h-[82vh] rounded-2xl bg-dona-panel border border-dona-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dona-border shrink-0">
          <h2 className="text-lg font-semibold text-white">{t("settings.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-dona-muted hover:text-dona-fg"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: Left Sidebar + Right Scrollable Content */}
        <div className="flex-1 flex min-h-0">
          <nav className="w-48 border-r border-dona-border bg-dona-dark/60 p-3 space-y-1 shrink-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    tab === item.id
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {tab === "general" && (
              <div className="space-y-5 max-w-md">
                <div>
                  <label htmlFor="settings-lang" className="block text-xs text-gray-300 mb-1.5">
                    {t("settings.language")}
                  </label>
                  <select
                    id="settings-lang"
                    value={i18n.language}
                    onChange={(e) => void i18n.changeLanguage(e.target.value)}
                    className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-sm text-white"
                  >
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                    <option value="bn">বাংলা</option>
                  </select>
                </div>

                <div className="border-t border-dona-border pt-4 space-y-2">
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <span>
                      <span className="block text-sm text-white">
                        {t("settings.startWithWindows")}
                      </span>
                      <span className="block text-[11px] text-gray-400">
                        {t("settings.startWithWindowsHint")}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={autostartEnabled}
                      disabled={autostartBusy}
                      onChange={(e) => void handleToggleAutostart(e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                  </label>
                  {autostartError && (
                    <p className="text-[11px] text-red-400 break-words">{autostartError}</p>
                  )}
                </div>

                <div className="border-t border-dona-border pt-4 space-y-2">
                  <p className="text-sm text-white">{t("settings.updates")}</p>
                  <p className="text-[11px] text-gray-400">{t("settings.updatesHint")}</p>
                  <button
                    type="button"
                    disabled={updateBusy}
                    onClick={() => void handleCheckUpdates()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${updateBusy ? "animate-spin" : ""}`} />
                    {t("settings.checkUpdates")}
                  </button>
                  {updateStatus && (
                    <p className="text-[11px] text-gray-300 break-words">{updateStatus}</p>
                  )}
                </div>

                <p className="text-xs text-gray-400 pt-4 border-t border-dona-border">
                  {t("settings.aboutCredit")}
                </p>
              </div>
            )}

            {tab === "accounts" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">{t("settings.accountsHint")}</p>

                {/* Account groups */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-3 space-y-2">
                  <p className="text-xs font-semibold text-white">{t("accounts.groups")}</p>
                  <p className="text-[11px] text-gray-400">{t("accounts.groupsHint")}</p>
                  <div className="flex flex-wrap gap-2">
                    {groups.map((group) => (
                      <span
                        key={group.id}
                        style={{ borderColor: group.color }}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] text-gray-200"
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: group.color }}
                        />
                        {group.name}
                        <button
                          type="button"
                          onClick={() => void handleDeleteGroup(group.id)}
                          className="text-red-400 hover:text-red-300"
                          title={t("common.delete")}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {groups.length === 0 && (
                      <span className="text-[11px] text-gray-500">{t("accounts.noGroups")}</span>
                    )}
                  </div>
                  <form onSubmit={handleAddGroup} className="flex items-center gap-2">
                    <input
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      placeholder={t("accounts.groupNamePlaceholder")}
                      className="flex-1 rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white"
                    />
                    <input
                      type="color"
                      value={newGroupColor}
                      onChange={(e) => setNewGroupColor(e.target.value)}
                      aria-label={t("accounts.groupColor")}
                      className="h-8 w-8 rounded border border-dona-border bg-transparent p-0.5"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
                    >
                      {t("accounts.addGroup")}
                    </button>
                  </form>
                </div>

                {dndStatus && <p className="text-[11px] text-emerald-400">{dndStatus}</p>}
                {accounts.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    {t("onboarding.addFirstAccount")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {accounts.map((acc) => {
                      const dnd = dndTimes[acc.id] ?? { start: "22:00", end: "07:00" };
                      return (
                      <div
                        key={acc.id}
                        className="flex flex-col gap-2.5 rounded-xl bg-dona-dark border border-dona-border p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0"
                              style={{ backgroundColor: acc.color }}
                            >
                              {acc.avatarDataUrl ? (
                                <img
                                  src={acc.avatarDataUrl}
                                  alt={acc.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                acc.iconText || acc.name[0]
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-white truncate">{acc.name}</p>
                              <p className="text-[11px] text-gray-400">
                                {acc.category} {acc.hasLock ? "· 🔒" : ""} {acc.muted ? "· 🔇" : ""}
                                {acc.groupId
                                  ? ` · ${groups.find((g) => g.id === acc.groupId)?.name ?? ""}`
                                  : ""}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onEditAccount(acc);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-200 inline-flex items-center gap-1 shrink-0"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            {t("common.edit")}
                          </button>
                        </div>

                        {/* Do-Not-Disturb Quiet Hours */}
                        <div className="flex items-center gap-1.5 pt-2 border-t border-dona-border/60 text-[11px]">
                          <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <input
                            type="time"
                            value={dnd.start}
                            onChange={(e) =>
                              setDndTimes((prev) => ({
                                ...prev,
                                [acc.id]: { ...dnd, start: e.target.value },
                              }))
                            }
                            className="rounded bg-dona-panel border border-dona-border px-1.5 py-0.5 text-white"
                          />
                          <span className="text-gray-500">–</span>
                          <input
                            type="time"
                            value={dnd.end}
                            onChange={(e) =>
                              setDndTimes((prev) => ({
                                ...prev,
                                [acc.id]: { ...dnd, end: e.target.value },
                              }))
                            }
                            className="rounded bg-dona-panel border border-dona-border px-1.5 py-0.5 text-white"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              void setDndSchedule(acc.id, dnd.start, dnd.end).then(() =>
                                setDndStatus(`DND saved for ${acc.name} (${dnd.start}–${dnd.end})`)
                              );
                            }}
                            className="ml-auto px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white"
                          >
                            {t("common.save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void clearDndSchedule(acc.id).then(() =>
                                setDndStatus(`DND cleared for ${acc.name}`)
                              );
                            }}
                            className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === "ai" && (
              <div className="space-y-5">
                {/* Saved AI Profiles (only 1 active, keys never displayed) */}
                {profiles.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                      {t("settings.savedProfiles")}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {profiles.map((p) => (
                        <div
                          key={p.id}
                          className={`rounded-xl border p-3 flex items-center justify-between gap-2 ${
                            p.active
                              ? "bg-blue-950/40 border-blue-500"
                              : "bg-dona-dark border-dona-border"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-white truncate">
                                {p.name}
                              </span>
                              {p.active && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">
                                  Active
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-gray-400 truncate">
                              {p.provider} · {p.model} ·{" "}
                              {p.has_key ? t("settings.keySaved") : t("settings.keyNotSaved")}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!p.active && (
                              <button
                                type="button"
                                onClick={() => void aiSetActiveProfile(p.id).then(setProfiles)}
                                className="p-1.5 rounded hover:bg-white/10 text-emerald-400"
                                title={t("settings.setActive")}
                              >
                                <CheckCircle2 className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEditProfile(p)}
                              className="p-1.5 rounded hover:bg-white/10 text-gray-300"
                              title={t("common.edit")}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void aiDeleteProfile(p.id).then(setProfiles)}
                              className="p-1.5 rounded hover:bg-white/10 text-red-400"
                              title={t("common.delete")}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Add / Edit AI Profile Form */}
                <form
                  onSubmit={handleSaveProfile}
                  className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      {editingProfileId ? t("common.edit") : t("settings.addProfile")}
                    </span>
                    {editingProfileId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingProfileId("");
                          setApiKeyInput("");
                        }}
                        className="text-xs text-gray-400 hover:text-white"
                      >
                        {t("common.cancel")}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder={t("settings.profileNamePlaceholder")}
                      className="rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                    />
                    <select
                      value={provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                    >
                      <option value="ollama">Ollama (Local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="kimi">Kimi (Moonshot)</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="custom">Custom (OpenAI-compatible)</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder={t("settings.baseUrlLabel")}
                      className="rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                    />
                    {provider !== "ollama" && (
                      <input
                        type="password"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={
                          editingProfileId ? "•••••••• (leave blank to keep)" : "API Key (sk-...)"
                        }
                        className="rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                      />
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {detectedModels.length > 0 ? (
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="flex-1 rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                      >
                        {detectedModels.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={t("settings.modelLabel")}
                        className="flex-1 rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                      />
                    )}
                    <button
                      type="button"
                      disabled={detecting}
                      onClick={() => void handleDetectModels()}
                      className="px-3 py-2 rounded-lg border border-dona-border hover:bg-white/5 text-xs text-gray-200 inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${detecting ? "animate-spin" : ""}`} />
                      {t("settings.detectModels")}
                    </button>
                  </div>

                  {detectStatus && <p className="text-[11px] text-blue-300">{detectStatus}</p>}

                  <button
                    type="submit"
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white inline-flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("common.save")}
                  </button>
                </form>
              </div>
            )}

            {tab === "security" && (
              <div className="space-y-4 max-w-md">
                <p className="text-xs text-gray-400">{t("lock.subtitle")}</p>
                {hasPin ? (
                  <div className="flex items-center justify-between bg-dona-dark rounded-lg px-4 py-3 border border-dona-border">
                    <span className="text-xs text-emerald-400">{t("settings.pinEnabled")}</span>
                    <button
                      type="button"
                      onClick={() => void securityClearPin().then(() => setHasPin(false))}
                      className="text-xs text-red-400 hover:underline"
                    >
                      {t("settings.clearPin")}
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSetPin} className="flex gap-2">
                    <input
                      type="password"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      placeholder={t("settings.pinPlaceholder")}
                      className="flex-1 rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="submit"
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium text-white"
                    >
                      {t("settings.setPin")}
                    </button>
                  </form>
                )}

              </div>
            )}

            {tab === "data" && (
              <div className="space-y-5 max-w-xl">
                {/* Storage & health */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white">
                      {t("settings.storageHealth")}
                    </p>
                    <button
                      type="button"
                      onClick={() => void appHealth().then(setHealth)}
                      className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                      title={t("common.refresh")}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {health ? (
                    <>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                        <div className="col-span-2">
                          <dt className="text-gray-500">{t("settings.dataFolder")}</dt>
                          <dd className="text-gray-200 break-all">{health.data_dir}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.database")}</dt>
                          <dd className="text-gray-200">
                            {formatBytes(health.db_bytes + health.wal_bytes)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.backupsSize")}</dt>
                          <dd className="text-gray-200">{formatBytes(health.backups_bytes)}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.accounts")}</dt>
                          <dd className="text-gray-200">
                            {health.account_count} · {health.group_count} {t("settings.groups")}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.webviewProfiles")}</dt>
                          <dd className="text-gray-200">
                            {health.webview_profiles} · {formatBytes(health.webview_bytes)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.version")}</dt>
                          <dd className="text-gray-200">
                            {health.version} ({health.os})
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">{t("settings.logs")}</dt>
                          <dd className="text-gray-200">{health.log_dir}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => revealPath(health.db_path)}
                          className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <HardDrive className="w-3.5 h-3.5" />
                          {t("settings.showDatabase")}
                        </button>
                        <button
                          type="button"
                          onClick={() => revealPath(health.log_dir)}
                          className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          {t("settings.showLogs")}
                        </button>
                        <button
                          type="button"
                          onClick={() => revealPath(health.data_dir)}
                          className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          {t("settings.showDataFolder")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-gray-500">{t("common.loading")}</p>
                  )}
                </div>

                {/* CRM data portability */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    CRM data
                  </p>
                  <p className="text-[11px] text-gray-400">
                    Export every contact, deal, task, note, tag, template and pipeline as one JSON
                    file, or move it to another Dona Bridge PC. Importing replaces CRM data only —
                    accounts, WhatsApp sessions and settings stay as they are.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={crmBusy}
                      onClick={() => void handleExportCrmJson()}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CRM (JSON)
                    </button>
                    <button
                      type="button"
                      disabled={crmBusy}
                      onClick={() => void handleImportCrmJson()}
                      className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Import CRM (JSON)
                    </button>
                  </div>

                  <div className="border-t border-dona-border/60 pt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] text-gray-400">Spreadsheet export for</span>
                      <select
                        value={crmAccountId}
                        onChange={(event) => setCrmAccountId(event.target.value)}
                        className="rounded-lg bg-dona-panel border border-dona-border px-2 py-1 text-[11px] text-gray-200"
                      >
                        {accounts.length === 0 && <option value="">No accounts</option>}
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={crmBusy || !crmAccountId}
                        onClick={() => void handleExportDealsCsv()}
                        className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200"
                      >
                        Export deals CSV
                      </button>
                      <button
                        type="button"
                        disabled={crmBusy || !crmAccountId}
                        onClick={() => void handleExportTasksCsv()}
                        className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200"
                      >
                        Export tasks CSV
                      </button>
                    </div>
                  </div>

                  {crmStatus && (
                    <p className="text-[11px] text-emerald-400 break-all">{crmStatus}</p>
                  )}
                </div>

                {/* Recovery & safety */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-white">Recovery &amp; safety</p>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        health?.integrity_ok
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-red-500/10 text-red-400 border-red-500/30"
                      }`}
                    >
                      {health?.integrity_ok ? "Database OK" : "Check failed"}
                    </span>
                  </div>

                  {health?.unclean_shutdown && (
                    <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded-lg px-2.5 py-2">
                      The previous session didn’t close normally. Committed data is safe — you
                      can restore the latest automatic snapshot below if anything looks missing.
                    </p>
                  )}

                  {health?.recovery_notice && (
                    <p className="text-[11px] text-red-300 bg-red-950/30 border border-red-900/40 rounded-lg px-2.5 py-2 break-words">
                      {health.recovery_notice}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCreateSnapshot()}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-medium text-white inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Create snapshot
                    </button>
                    <button
                      type="button"
                      onClick={() => revealPath(health ? `${health.data_dir}\\backups` : undefined)}
                      className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open backups
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExportDiagnostics()}
                      className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Export diagnostics
                    </button>
                  </div>

                  <p className="text-[10px] text-gray-500">
                    Automatic snapshots run at startup, every 6 hours and on a clean exit. The
                    newest 14 are kept in the backups folder.
                  </p>

                  {health && health.snapshots.length > 0 && (
                    <ul className="space-y-1.5">
                      {health.snapshots.slice(0, 5).map((snapshot) => (
                        <li
                          key={snapshot.path}
                          className="flex items-center justify-between gap-2 rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5"
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] text-gray-200 truncate">
                              {snapshot.created_at
                                ? new Date(snapshot.created_at).toLocaleString()
                                : snapshot.path.split("\\").pop()}
                            </p>
                            <p className="text-[10px] text-gray-500">
                              {formatBytes(snapshot.bytes)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleRestoreSnapshot(snapshot.path)}
                            className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-[10px] font-medium text-white inline-flex items-center gap-1 shrink-0"
                          >
                            <RotateCcw className="w-3 h-3" />
                            Restore
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {backupStatus && (
                    <p className="text-[11px] text-emerald-400 break-all">{backupStatus}</p>
                  )}
                </div>

                {/* Automatic encrypted folder backups */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
                      <CloudUpload className="w-3.5 h-3.5 text-emerald-400" />
                      Automatic encrypted backups
                    </p>
                    {autoBackup && (
                      <label className="inline-flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoBackup.enabled}
                          onChange={(e) => updateAutoBackup({ enabled: e.target.checked })}
                          className="w-3.5 h-3.5 accent-blue-600"
                        />
                        Enabled
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Encrypted before writing. Point it at a OneDrive, Google Drive or Mega sync
                    folder, or an external drive, and it is uploaded by that client automatically.
                  </p>

                  {!autoBackup ? (
                    <p className="text-[11px] text-gray-500">{t("common.loading")}</p>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <input
                          readOnly
                          value={autoBackup.folder}
                          placeholder="Choose a folder…"
                          className="flex-1 min-w-0 rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                        />
                        <button
                          type="button"
                          onClick={() => void handleChooseBackupFolder()}
                          className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1 shrink-0"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Choose
                        </button>
                      </div>
                      {!autoBackup.folder && autoBackup.suggested_folder && (
                        <button
                          type="button"
                          onClick={() =>
                            updateAutoBackup({ folder: autoBackup.suggested_folder ?? "" })
                          }
                          className="text-[10px] text-blue-400 hover:underline text-left break-all"
                        >
                          Use suggested folder: {autoBackup.suggested_folder}
                        </button>
                      )}

                      <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Back up every</span>
                          <select
                            value={autoBackup.interval_hours}
                            onChange={(e) =>
                              updateAutoBackup({ interval_hours: Number(e.target.value) })
                            }
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2 py-1.5 text-[11px] text-gray-200"
                          >
                            <option value={6}>6 hours</option>
                            <option value={12}>12 hours</option>
                            <option value={24}>24 hours</option>
                            <option value={168}>7 days</option>
                          </select>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Keep</span>
                          <select
                            value={autoBackup.keep}
                            onChange={(e) => updateAutoBackup({ keep: Number(e.target.value) })}
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2 py-1.5 text-[11px] text-gray-200"
                          >
                            <option value={7}>7 backups</option>
                            <option value={14}>14 backups</option>
                            <option value={30}>30 backups</option>
                          </select>
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={autoBusy}
                          onClick={() => void handleSaveAutoBackup()}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={autoBusy || !autoBackup.folder}
                          onClick={() => void handleAutoBackupNow()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          Backup now
                        </button>
                        {autoBackup.has_key && (
                          <button
                            type="button"
                            onClick={() => void handleShowRecoveryCode()}
                            className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Recovery code
                          </button>
                        )}
                      </div>

                      <div className="border-t border-dona-border/60 pt-2 space-y-1">
                        <p className="text-[10px] text-gray-400">
                          Restoring on another PC? Paste the recovery code created there.
                        </p>
                        <div className="flex gap-2">
                          <input
                            type="password"
                            value={recoveryInput}
                            onChange={(e) => setRecoveryInput(e.target.value)}
                            placeholder="Recovery code"
                            className="flex-1 min-w-0 rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                          />
                          <button
                            type="button"
                            disabled={recoveryInput.trim().length < 8}
                            onClick={() => void handleUseRecoveryCode()}
                            className="px-2.5 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 shrink-0"
                          >
                            Use code
                          </button>
                        </div>
                      </div>

                      {showRecoveryCode && recoveryCode && (                        <div className="rounded-lg bg-amber-950/30 border border-amber-900/40 p-2.5 space-y-1.5">
                          <p className="text-[10px] text-amber-200">
                            Save this code somewhere safe. It is the password needed to restore
                            these backups on another PC. Without it the files cannot be opened.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-[10px] text-amber-100 break-all">
                              {recoveryCode}
                            </code>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(recoveryCode)}
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Copy recovery code"
                              aria-label="Copy recovery code"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowRecoveryCode(false)}
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Hide recovery code"
                              aria-label="Hide recovery code"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="text-[10px] text-gray-500 space-y-0.5">
                        <p>
                          Last backup:{" "}
                          {autoBackup.last_backup_at
                            ? new Date(autoBackup.last_backup_at).toLocaleString()
                            : "never"}
                        </p>
                        <p>
                          {autoBackup.count} backup(s) · {formatBytes(autoBackup.bytes)}
                        </p>
                        {autoBackup.last_error && (
                          <p className="text-red-400 break-words">
                            Last error: {autoBackup.last_error}
                          </p>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500">
                        Backups include accounts, CRM data, templates and settings — not WhatsApp
                        sessions. Restore with “Restore from backup…” below using the recovery
                        code.
                      </p>
                    </>
                  )}
                </div>

                {/* WebDAV backup */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
                      <CloudUpload className="w-3.5 h-3.5 text-emerald-400" />
                      WebDAV backup
                    </p>
                    {webdav && (
                      <label className="inline-flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={webdav.enabled}
                          onChange={(event) =>
                            setWebdav((current) =>
                              current ? { ...current, enabled: event.target.checked } : current
                            )
                          }
                          className="w-3.5 h-3.5 accent-blue-600"
                        />
                        Enabled
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Upload an encrypted backup to a WebDAV folder (Nextcloud, ownCloud, HiDrive,
                    NAS). The file is encrypted on this PC before it is sent, so the server only
                    stores ciphertext. The target folder must already exist.
                  </p>

                  {!webdav ? (
                    <p className="text-[11px] text-gray-500">{t("common.loading")}</p>
                  ) : (
                    <>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-gray-400">Folder URL</span>
                        <input
                          value={webdav.url}
                          onChange={(event) =>
                            setWebdav((current) =>
                              current ? { ...current, url: event.target.value } : current
                            )
                          }
                          placeholder="https://cloud.example.com/remote.php/dav/files/you/DonaBridge"
                          className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Username</span>
                          <input
                            value={webdav.username}
                            onChange={(event) =>
                              setWebdav((current) =>
                                current ? { ...current, username: event.target.value } : current
                              )
                            }
                            placeholder="you@example.com"
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Password / app password</span>
                          <input
                            type="password"
                            value={webdavPassword}
                            onChange={(event) => setWebdavPassword(event.target.value)}
                            placeholder={webdav.has_password ? "Saved — leave blank to keep" : "Password"}
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Upload every</span>
                          <select
                            value={webdav.interval_hours}
                            onChange={(event) =>
                              setWebdav((current) =>
                                current
                                  ? { ...current, interval_hours: Number(event.target.value) }
                                  : current
                              )
                            }
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2 py-1.5 text-[11px] text-gray-200"
                          >
                            <option value={6}>6 hours</option>
                            <option value={12}>12 hours</option>
                            <option value={24}>24 hours</option>
                            <option value={168}>7 days</option>
                          </select>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[10px] text-gray-400">Keep on server</span>
                          <select
                            value={webdav.keep}
                            onChange={(event) =>
                              setWebdav((current) =>
                                current ? { ...current, keep: Number(event.target.value) } : current
                              )
                            }
                            className="w-full rounded-lg bg-dona-panel border border-dona-border px-2 py-1.5 text-[11px] text-gray-200"
                          >
                            <option value={7}>7 backups</option>
                            <option value={14}>14 backups</option>
                            <option value={30}>30 backups</option>
                          </select>
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={webdavBusy}
                          onClick={() => void handleSaveWebdav()}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={webdavBusy || !webdav.url.trim()}
                          onClick={() => void handleUploadWebdav()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <CloudUpload className="w-3.5 h-3.5" />
                          Back up now
                        </button>
                        <button
                          type="button"
                          disabled={webdavBusy || !webdav.url.trim()}
                          onClick={() => void handleTestWebdav()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Test connection
                        </button>
                      </div>

                      {webdavTestResult && (
                        <p
                          className={`text-[11px] break-all ${
                            webdavTestResult.ok ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {webdavTestResult.ok
                            ? `Connection OK — HTTP ${webdavTestResult.status ?? "?"}`
                            : (webdavTestResult.error ?? "Connection failed")}
                        </p>
                      )}

                      {webdavStatus && (
                        <p className="text-[11px] text-emerald-400 break-all">{webdavStatus}</p>
                      )}

                      {webdav.last_at && (
                        <p className="text-[10px] text-gray-500 break-words">
                          Last attempt: {new Date(webdav.last_at).toLocaleString()} ·{" "}
                          {webdav.last_status || "no status"}
                          {webdav.last_file && ` · ${webdav.last_file}`}
                          {webdav.last_error && (
                            <span className="text-red-400"> — {webdav.last_error}</span>
                          )}
                        </p>
                      )}

                      <p className="text-[10px] text-gray-500">
                        Files are named <code>dona-YYYYMMDD-HHMMSS-xxxxxx.donabk</code> and the
                        newest {webdav.keep} are kept on the server. Restore them with “Restore from
                        backup…” below and your recovery code.
                      </p>
                    </>
                  )}
                </div>

                {/* Encrypted backup & restore */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <p className="text-xs font-semibold text-white">{t("settings.backupTitle")}</p>
                  <p className="text-[11px] text-gray-400">{t("settings.backupHint")}</p>
                  <input
                    type="password"
                    value={backupPass}
                    onChange={(e) => setBackupPass(e.target.value)}
                    placeholder={t("settings.backupPassword")}
                    className="w-full rounded-lg bg-dona-panel border border-dona-border px-3 py-2 text-xs text-white"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!backupPass.trim() || backupBusy}
                      onClick={() => void handleBackup()}
                      className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("settings.createBackup")}
                    </button>
                    <button
                      type="button"
                      disabled={!backupPass.trim() || backupBusy}
                      onClick={() => void handleRestore()}
                      className="px-3 py-2 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-xs text-gray-200 inline-flex items-center gap-1.5"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {t("settings.restoreBackup")}
                    </button>
                  </div>
                  {backupStatus && (
                    <p className="text-[11px] text-emerald-400 break-all">{backupStatus}</p>
                  )}
                  <p className="text-[11px] text-gray-500">{t("settings.backupPortable")}</p>
                </div>

                {/* CRM & workspace JSON backup */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-2">
                  <p className="text-xs font-semibold text-white">{t("settings.crmJsonTitle")}</p>
                  <p className="text-[11px] text-gray-400">{t("settings.crmJsonHint")}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const data: Record<string, string> = {};
                        for (let i = 0; i < localStorage.length; i++) {
                          const key = localStorage.key(i);
                          if (key?.startsWith("dona_")) {
                            data[key] = localStorage.getItem(key) ?? "";
                          }
                        }
                        const blob = new Blob([JSON.stringify(data, null, 2)], {
                          type: "application/json",
                        });
                        const url = URL.createObjectURL(blob);
                        const anchor = document.createElement("a");
                        anchor.href = url;
                        anchor.download = `donabridge-crm-backup-${new Date()
                          .toISOString()
                          .slice(0, 10)}.json`;
                        anchor.click();
                        URL.revokeObjectURL(url);
                        setBackupStatus("CRM & workspace JSON exported.");
                      }}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white inline-flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      {t("settings.exportJson")}
                    </button>
                    <label className="flex-1 py-1.5 px-3 rounded-lg border border-dona-border hover:bg-white/5 text-xs text-gray-200 inline-flex items-center justify-center gap-1.5 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      {t("settings.importJson")}
                      <input
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          void file.text().then((txt) => {
                            try {
                              const parsed = JSON.parse(txt) as Record<string, string>;
                              for (const [key, value] of Object.entries(parsed)) {
                                if (key.startsWith("dona_")) localStorage.setItem(key, value);
                              }
                              setBackupStatus(
                                "Workspace JSON restored. Reopen the CRM to see changes."
                              );
                            } catch {
                              setBackupStatus("Invalid JSON backup file.");
                            }
                          });
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}

            {tab === "integrations" && (
              <div className="space-y-4 max-w-2xl">
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
                      <Webhook className="w-3.5 h-3.5 text-emerald-400" />
                      Outbound webhooks
                    </p>
                    <label className="inline-flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={webhook?.enabled ?? false}
                        onChange={(event) =>
                          setWebhook((current) =>
                            current ? { ...current, enabled: event.target.checked } : current
                          )
                        }
                        className="w-3.5 h-3.5 accent-blue-600"
                      />
                      Enabled
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Send CRM changes to n8n, Zapier, Make or your own endpoint. Every request is
                    signed with HMAC-SHA256 so your endpoint can verify it came from Dona Bridge.
                    Nothing leaves this PC until you enable it.
                  </p>

                  {!webhook ? (
                    <p className="text-[11px] text-gray-500">{t("common.loading")}</p>
                  ) : (
                    <>
                      <label className="block space-y-1">
                        <span className="text-[10px] text-gray-400">Endpoint URL</span>
                        <input
                          value={webhook.url}
                          onChange={(event) =>
                            setWebhook((current) =>
                              current ? { ...current, url: event.target.value } : current
                            )
                          }
                          placeholder="https://hooks.example.com/dona"
                          className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-[11px] text-gray-200"
                        />
                      </label>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {WEBHOOK_EVENT_GROUPS.map((group) => (
                          <div key={group.label} className="space-y-1">
                            <p className="text-[10px] uppercase tracking-wider text-gray-500">
                              {group.label}
                            </p>
                            {group.events.map((event) => (
                              <label
                                key={event}
                                className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={webhook.events.includes(event)}
                                  onChange={() => toggleWebhookEvent(event)}
                                  className="w-3.5 h-3.5 accent-blue-600"
                                />
                                {event.split(".")[1]}
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={webhookBusy}
                          onClick={() => void handleSaveWebhook()}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={webhookBusy || !webhook.url.trim()}
                          onClick={() => void handleTestWebhook()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <Webhook className="w-3.5 h-3.5" />
                          Send test delivery
                        </button>
                        <button
                          type="button"
                          disabled={webhookBusy}
                          onClick={() => void handleRevealWebhookSecret()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Show secret
                        </button>
                        <button
                          type="button"
                          disabled={webhookBusy}
                          onClick={() => void handleRotateWebhookSecret()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Rotate secret
                        </button>
                      </div>

                      {webhookSecretValue && (
                        <div className="rounded-lg bg-amber-950/30 border border-amber-900/40 p-2.5 space-y-1.5">
                          <p className="text-[10px] text-amber-200">
                            Signing secret — copy it into your endpoint. Without it the endpoint
                            cannot verify deliveries.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-[10px] text-amber-100 break-all">
                              {webhookSecretValue}
                            </code>
                            <button
                              type="button"
                              onClick={() =>
                                void navigator.clipboard?.writeText(webhookSecretValue)
                              }
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Copy secret"
                              aria-label="Copy signing secret"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setWebhookSecretValue(null)}
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Hide secret"
                              aria-label="Hide signing secret"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {webhookTest && (
                        <div
                          className={`rounded-lg border p-2.5 space-y-1 ${
                            webhookTest.ok
                              ? "bg-emerald-950/30 border-emerald-900/40"
                              : "bg-red-950/30 border-red-900/40"
                          }`}
                        >
                          <p
                            className={`text-[11px] ${
                              webhookTest.ok ? "text-emerald-300" : "text-red-300"
                            }`}
                          >
                            {webhookTest.ok
                              ? `Test delivered — HTTP ${webhookTest.status ?? "?"}`
                              : (webhookTest.error ?? "Test failed")}
                          </p>
                          {webhookTest.response && (
                            <p className="text-[10px] text-gray-400 break-all">
                              Response: {webhookTest.response}
                            </p>
                          )}
                        </div>
                      )}

                      {webhookStatus && (
                        <p className="text-[11px] text-emerald-400 break-all">{webhookStatus}</p>
                      )}

                      {webhook.last_at && (
                        <p className="text-[10px] text-gray-500 break-words">
                          Last delivery: {new Date(webhook.last_at).toLocaleString()} ·{" "}
                          {webhook.last_status || "no status"}
                          {webhook.last_error && (
                            <span className="text-red-400"> — {webhook.last_error}</span>
                          )}
                        </p>
                      )}

                      <details className="text-[10px] text-gray-500">
                        <summary className="cursor-pointer text-gray-400">
                          Signature format &amp; example request
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all bg-dona-panel border border-dona-border rounded-lg p-2 text-[10px] text-gray-300">
{`POST <your URL>
Content-Type: application/json
X-Dona-Event: contact.updated
X-Dona-Timestamp: 1700000000
X-Dona-Signature: sha256=<HMAC_SHA256(secret, timestamp + "." + body)>
X-Dona-Delivery: <uuid>

{"event":"contact.updated","sent_at":"...","data":{"contact":{...}}}`}
                        </pre>
                      </details>
                    </>
                  )}
                </div>

                {/* Read-only local API */}
                <div className="rounded-xl bg-dona-dark border border-dona-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white inline-flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-emerald-400" />
                      Local API
                    </p>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        api?.running
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-white/5 text-gray-400 border-dona-border"
                      }`}
                    >
                      {api?.running ? `Running on :${api.port}` : "Stopped"}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    A read-only JSON API for scripts, dashboards and automation. It listens on
                    127.0.0.1 only and every request needs a Bearer token, so nothing is exposed to
                    your network. Changes are still made in Dona Bridge itself.
                  </p>

                  {!api ? (
                    <p className="text-[11px] text-gray-500">{t("common.loading")}</p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={api.enabled}
                            onChange={(event) =>
                              setApi((current) =>
                                current ? { ...current, enabled: event.target.checked } : current
                              )
                            }
                            className="w-3.5 h-3.5 accent-blue-600"
                          />
                          Enabled
                        </label>
                        <label className="inline-flex items-center gap-2 text-[10px] text-gray-400">
                          Port
                          <input
                            type="number"
                            min={1024}
                            max={65535}
                            value={api.port}
                            onChange={(event) =>
                              setApi((current) =>
                                current
                                  ? { ...current, port: Number(event.target.value) || 0 }
                                  : current
                              )
                            }
                            className="w-24 rounded-lg bg-dona-panel border border-dona-border px-2 py-1 text-[11px] text-gray-200"
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={apiBusy}
                          onClick={() => void handleSaveApi()}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-[11px] font-medium text-white"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          disabled={apiBusy}
                          onClick={() => void handleRevealApiToken()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Show token
                        </button>
                        <button
                          type="button"
                          disabled={apiBusy}
                          onClick={() => void handleRotateApiToken()}
                          className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-[11px] text-gray-200 inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Rotate token
                        </button>
                      </div>

                      {apiSecretValue && (
                        <div className="rounded-lg bg-amber-950/30 border border-amber-900/40 p-2.5 space-y-1.5">
                          <p className="text-[10px] text-amber-200">
                            API token — send it as <code>Authorization: Bearer &lt;token&gt;</code>.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 text-[10px] text-amber-100 break-all">
                              {apiSecretValue}
                            </code>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(apiSecretValue)}
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Copy API token"
                              aria-label="Copy API token"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setApiSecretValue(null)}
                              className="text-amber-200 hover:text-white shrink-0"
                              title="Hide API token"
                              aria-label="Hide API token"
                            >
                              <EyeOff className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {apiStatus && (
                        <p className="text-[11px] text-emerald-400 break-all">{apiStatus}</p>
                      )}

                      <details className="text-[10px] text-gray-500">
                        <summary className="cursor-pointer text-gray-400">
                          Endpoints &amp; authentication
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all bg-dona-panel border border-dona-border rounded-lg p-2 text-[10px] text-gray-300">
{`Base URL: http://127.0.0.1:${api.port}/v1
Authorization: Bearer <token>

GET /health
GET /accounts
GET /contacts?account_id=...
GET /contacts/{id}/timeline
GET /deals?account_id=...[&pipeline_id=...]
GET /tasks?account_id=...
GET /report?account_id=...[&pipeline_id=...]
GET /templates[?account_id=...]

curl -H "Authorization: Bearer <token>" http://127.0.0.1:${api.port}/v1/accounts`}
                        </pre>
                      </details>
                    </>
                  )}
                </div>
              </div>
            )}

            {tab === "mcp" && (
              <div className="space-y-4 max-w-md">
                <p className="text-sm font-medium text-white">{t("settings.mcpTitle")}</p>
                <p className="text-xs text-gray-400">
                  {mcp.running && mcp.port
                    ? t("settings.mcpRunning", { port: mcp.port })
                    : t("settings.mcpStopped")}
                </p>
                <div className="flex gap-2">
                  {mcp.running ? (
                    <button
                      type="button"
                      onClick={() => void mcpStop().then(setMcp)}
                      className="px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-xs text-white"
                    >
                      {t("settings.mcpStop")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void mcpStart().then(setMcp)}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white"
                    >
                      {t("settings.mcpStart")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void mcpRotateToken()}
                    className="px-4 py-2 rounded-lg border border-dona-border hover:bg-white/5 text-xs text-gray-200"
                  >
                    {t("settings.mcpRotate")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
