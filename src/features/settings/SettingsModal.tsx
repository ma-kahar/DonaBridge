import {
  CheckCircle2,
  Download,
  Globe,
  KeyRound,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AiProfile,
  type McpStatus,
  aiDeleteProfile,
  aiDetectModels,
  aiListProfiles,
  aiSetActiveProfile,
  aiUpsertProfile,
  backupEncrypted,
  clearDndSchedule,
  mcpRotateToken,
  mcpStart,
  mcpStatus,
  mcpStop,
  restoreEncrypted,
  securityClearPin,
  securityLockStatus,
  securitySetPin,
  setDndSchedule,
} from "../../lib/ipc";
import { type Account, useAppStore } from "../../store";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onEditAccount: (account: Account) => void;
}

type SettingsTab = "general" | "accounts" | "ai" | "security" | "mcp";

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
  const [tab, setTab] = useState<SettingsTab>("general");

  const [hasPin, setHasPin] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [mcp, setMcp] = useState<McpStatus>({ running: false, port: null, has_token: false });

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
  }, [open]);

  if (!open) return null;

  function handleProviderChange(nextProvider: string) {
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

  const navItems: { id: SettingsTab; label: string; icon: typeof Globe }[] = [
    { id: "general", label: t("settings.tabGeneral"), icon: Globe },
    { id: "accounts", label: t("settings.tabAccounts"), icon: Users },
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
            className="text-white/50 hover:text-white"
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
              <div className="space-y-4 max-w-md">
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
                <p className="text-xs text-gray-400 pt-4 border-t border-dona-border">
                  {t("settings.aboutCredit")}
                </p>
              </div>
            )}

            {tab === "accounts" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">{t("settings.accountsHint")}</p>
                {accounts.length === 0 ? (
                  <p className="text-sm text-gray-500 py-8 text-center">
                    {t("onboarding.addFirstAccount")}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {accounts.map((acc) => (
                      <div
                        key={acc.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-dona-dark border border-dona-border p-3"
                      >
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
                    ))}
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

                {/* Backup & Restore */}
                <div className="border-t border-dona-border pt-4 space-y-3">
                  <p className="text-xs font-semibold text-white">Encrypted Backup</p>
                  <p className="text-[11px] text-gray-400">
                    Export all app data as a password-protected backup file (.age).
                  </p>
                  <BackupRestorePanel />
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
