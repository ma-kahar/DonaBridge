import { Eye, RefreshCw, SendHorizontal, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  aiGetConfig,
  aiReadActiveChat,
  aiSaveConfig,
  aiSuggestReply,
  crmInsertDraft,
} from "../../lib/ipc";
import EmojiPickerPopover from "../../components/EmojiPickerPopover";
import WaMessage from "../../components/WaMessage";

interface CopilotPanelProps {
  accountId: string;
  chatContext: { contact: string; messages: string[] } | null;
}

export default function CopilotPanel({ accountId, chatContext }: CopilotPanelProps) {
  const { t, i18n } = useTranslation();
  const [tone, setTone] = useState<"friendly" | "professional" | "concise">("friendly");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const prevContactRef = useRef<string | null>(null);
  const prevMsgCountRef = useRef<number>(0);

  // Auto-read + auto-suggest when new messages arrive (if autoMode on)
  useEffect(() => {
    if (!autoMode || !chatContext || loading) return;
    const { contact, messages } = chatContext;
    const isNewContact = contact !== prevContactRef.current;
    const hasNewMessages = messages.length > prevMsgCountRef.current;
    if (isNewContact || hasNewMessages) {
      prevContactRef.current = contact;
      prevMsgCountRef.current = messages.length;
      void handleSuggestInternal(contact, messages);
    }
  }, [chatContext, autoMode]);

  async function handleReadChat() {
    setError(null);
    await aiReadActiveChat(accountId);
  }

  async function handleSuggestInternal(contact: string, messages: string[]) {
    setLoading(true);
    setError(null);
    setNeedsConsent(false);
    // Detect language from messages — use UI language as default
    const detectedLang = i18n.language || "en";
    try {
      const reply = await aiSuggestReply(contact, messages, tone, detectedLang);
      setDraft(reply);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("CLOUD_CONSENT_REQUIRED")) {
        setNeedsConsent(true);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSuggest() {
    if (!chatContext) return;
    prevContactRef.current = chatContext.contact;
    prevMsgCountRef.current = chatContext.messages.length;
    await handleSuggestInternal(chatContext.contact, chatContext.messages);
  }

  async function handleAllowCloud() {
    const cfg = await aiGetConfig();
    await aiSaveConfig({ ...cfg, cloud_consent: true });
    setNeedsConsent(false);
    await handleSuggest();
  }

  async function handleInsertDraft() {
    if (!draft.trim()) return;
    await crmInsertDraft(accountId, draft);
  }

  return (
    <div className="space-y-3">
      {/* Read chat + Auto mode */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleReadChat}
          className="flex-1 py-2 px-3 rounded-lg bg-dona-panel border border-dona-border hover:bg-white/5 text-xs text-white flex items-center justify-center gap-1.5 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {t("copilot.readActiveChat")}
        </button>
        <button
          type="button"
          onClick={() => setAutoMode((v) => !v)}
          title={autoMode ? "Auto-suggest ON (click to disable)" : "Enable auto-suggest on new messages"}
          className={`px-3 py-2 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
            autoMode
              ? "bg-blue-600 border-blue-500 text-white"
              : "bg-dona-panel border-dona-border text-gray-400 hover:text-white"
          }`}
        >
          <Zap className="w-3.5 h-3.5" />
          Auto
        </button>
      </div>

      {autoMode && (
        <p className="text-[11px] text-blue-300 bg-blue-950/40 border border-blue-800/50 rounded px-2 py-1">
          ⚡ Auto-suggest is ON — a reply draft will be generated automatically when new messages arrive.
        </p>
      )}

      {!chatContext ? (
        <p className="text-[11px] text-gray-500 text-center py-4">{t("copilot.noContext")}</p>
      ) : (
        <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5 space-y-2">
          <p className="text-xs font-medium text-white truncate">{chatContext.contact || "Chat"}</p>
          <p className="text-[11px] text-gray-400">
            {chatContext.messages.length} messages in memory
          </p>
          {/* Last 3 messages preview */}
          <div className="space-y-1">
            {chatContext.messages.slice(-3).map((m, i) => (
              <div key={i} className="text-[11px] text-gray-300 bg-black/20 rounded px-2 py-1 truncate">
                {m}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tone selector */}
      <div>
        <label htmlFor="copilot-tone" className="block text-[11px] text-gray-400 mb-1">
          {t("copilot.toneLabel")}
        </label>
        <select
          id="copilot-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value as "friendly" | "professional" | "concise")}
          className="w-full rounded-lg bg-dona-panel border border-dona-border px-2.5 py-1.5 text-xs text-white"
        >
          <option value="friendly">{t("copilot.toneFriendly")}</option>
          <option value="professional">{t("copilot.toneProfessional")}</option>
          <option value="concise">{t("copilot.toneConcise")}</option>
        </select>
      </div>

      <button
        type="button"
        disabled={!chatContext || loading}
        onClick={handleSuggest}
        className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-medium text-white flex items-center justify-center gap-1.5 transition-colors"
      >
        {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {loading ? t("common.loading") : t("copilot.suggestReply")}
      </button>

      {needsConsent && (
        <div className="rounded-lg bg-amber-950/60 border border-amber-700/60 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-200">{t("copilot.cloudConsentTitle")}</p>
          <p className="text-[11px] text-amber-100/80">{t("copilot.cloudConsentBody")}</p>
          <button
            type="button"
            onClick={handleAllowCloud}
            className="w-full py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-xs font-medium text-white"
          >
            {t("copilot.allowCloud")}
          </button>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400 break-words">{error}</p>}

      {draft && (
        <div className="space-y-2">
          {/* WhatsApp-formatted preview */}
          <div className="rounded-lg bg-dona-panel border border-dona-border p-2.5">
            <p className="text-[10px] text-gray-500 mb-1">Preview</p>
            <WaMessage body={draft} showLinkPreview={false} />
          </div>
          <div className="flex gap-1 items-start">
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-lg bg-dona-panel border border-dona-border p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <EmojiPickerPopover onSelect={(emoji) => setDraft((d) => d + emoji)} />
          </div>
          <button
            type="button"
            onClick={handleInsertDraft}
            className="w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium text-white flex items-center justify-center gap-1.5"
          >
            <SendHorizontal className="w-3.5 h-3.5" />
            {t("crm.insertDraft")}
          </button>
        </div>
      )}

      <p className="text-[11px] text-gray-500">{t("copilot.draftOnly")}</p>
    </div>
  );
}
