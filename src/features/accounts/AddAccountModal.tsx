import { ImagePlus, Lock, Trash2, X } from "lucide-react";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { accountClearPin, accountSetPin, deleteAccount, upsertAccount } from "../../lib/ipc";
import { type Account, useAppStore } from "../../store";

const COLOR_PRESETS = ["#3B82F6", "#8B5CF6", "#EC4899", "#F59E0B", "#06B6D4", "#6366F1"];

interface AddAccountModalProps {
  open: boolean;
  editingAccount?: Account | null;
  onClose: () => void;
}

export default function AddAccountModal({ open, editingAccount, onClose }: AddAccountModalProps) {
  const { t } = useTranslation();
  const { accounts, activeAccountId, setAccounts, setActiveAccount } = useAppStore();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"personal" | "business">("business");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [iconText, setIconText] = useState("");
  const [muted, setMuted] = useState(false);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState("");
  const [hasLock, setHasLock] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editingAccount) {
      setName(editingAccount.name);
      setCategory(editingAccount.category === "personal" ? "personal" : "business");
      setColor(editingAccount.color || COLOR_PRESETS[0]);
      setIconText(editingAccount.iconText || "");
      setMuted(editingAccount.muted);
      setAvatarDataUrl(editingAccount.avatarDataUrl ?? null);
      setHasLock(Boolean(editingAccount.hasLock));
      setPinInput("");
    } else {
      setName("");
      setCategory("business");
      setColor(COLOR_PRESETS[0]);
      setIconText("");
      setMuted(false);
      setAvatarDataUrl(null);
      setHasLock(false);
      setPinInput("");
    }
  }, [open, editingAccount]);

  if (!open) return null;

  function handleAvatarPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 128, 128);
        setAvatarDataUrl(canvas.toDataURL("image/jpeg", 0.85));
      };
      if (typeof reader.result === "string") {
        img.src = reader.result;
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      const id = editingAccount ? editingAccount.id : "";
      const initials = (iconText.trim() || trimmed.slice(0, 2)).toUpperCase().slice(0, 2);
      const saved = await upsertAccount({
        id,
        name: trimmed,
        color,
        icon_text: initials,
        category,
        muted,
        sort_order: editingAccount ? editingAccount.sortOrder : accounts.length,
        avatar_data_url: avatarDataUrl ?? "",
      });

      let updatedLock = hasLock;
      if (pinInput.trim().length >= 4) {
        await accountSetPin(saved.id, pinInput.trim());
        updatedLock = true;
      }

      const nextAccount: Account = {
        id: saved.id,
        name: saved.name,
        color: saved.color,
        iconText: saved.icon_text,
        category: saved.category,
        muted: saved.muted,
        sortOrder: saved.sort_order,
        unreadCount: editingAccount?.unreadCount ?? 0,
        avatarDataUrl: saved.avatar_data_url ?? avatarDataUrl,
        hasLock: updatedLock,
      };

      if (editingAccount) {
        setAccounts(accounts.map((a) => (a.id === nextAccount.id ? nextAccount : a)));
      } else {
        setAccounts([...accounts, nextAccount]);
        setActiveAccount(nextAccount.id);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingAccount) return;
    await deleteAccount(editingAccount.id);
    const remaining = accounts.filter((a) => a.id !== editingAccount.id);
    setAccounts(remaining);
    if (activeAccountId === editingAccount.id) {
      setActiveAccount(remaining[0]?.id ?? null);
    }
    onClose();
  }

  async function handleClearPin() {
    if (!editingAccount) return;
    await accountClearPin(editingAccount.id);
    setHasLock(false);
    setAccounts(accounts.map((a) => (a.id === editingAccount.id ? { ...a, hasLock: false } : a)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl bg-dona-panel border border-dona-border p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">
            {editingAccount ? t("accounts.editAccount") : t("accounts.addAccount")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white/50 hover:text-white transition-colors"
            aria-label={t("common.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Avatar preview & upload */}
          <div className="flex items-center gap-4">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-base font-bold text-white overflow-hidden shrink-0 border border-dona-border"
              style={{ backgroundColor: color }}
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                (iconText.trim() || name.trim().slice(0, 2) || "DB").toUpperCase()
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dona-dark border border-dona-border hover:bg-white/5 text-xs text-gray-200">
                <ImagePlus className="w-3.5 h-3.5" />
                {t("accounts.uploadPhoto")}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarPick}
                  className="hidden"
                />
              </label>
              {avatarDataUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarDataUrl(null)}
                  className="text-xs text-red-400 hover:underline"
                >
                  {t("common.delete")}
                </button>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="acc-name" className="block text-sm text-gray-300 mb-1">
              {t("accounts.nameLabel")}
            </label>
            <input
              id="acc-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("accounts.namePlaceholder")}
              className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="acc-category" className="block text-sm text-gray-300 mb-1">
                {t("accounts.categoryLabel")}
              </label>
              <select
                id="acc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as "personal" | "business")}
                className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="business">{t("accounts.categoryBusiness")}</option>
                <option value="personal">{t("accounts.categoryPersonal")}</option>
              </select>
            </div>

            <div>
              <label htmlFor="acc-initials" className="block text-sm text-gray-300 mb-1">
                {t("accounts.initialsLabel")}
              </label>
              <input
                id="acc-initials"
                type="text"
                maxLength={2}
                value={iconText}
                onChange={(e) => setIconText(e.target.value)}
                placeholder={name.trim().slice(0, 2).toUpperCase() || "DB"}
                className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-2 text-white uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <span className="block text-sm text-gray-300 mb-2">{t("accounts.colorLabel")}</span>
            <div className="flex gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColor(preset)}
                  className={`w-8 h-8 rounded-full transition-transform ${
                    color === preset
                      ? "ring-2 ring-white scale-110"
                      : "opacity-75 hover:opacity-100"
                  }`}
                  style={{ backgroundColor: preset }}
                  aria-label={preset}
                />
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={muted}
              onChange={(e) => setMuted(e.target.checked)}
              className="rounded border-dona-border"
            />
            {t("accounts.muteNotifications")}
          </label>

          {/* Per-account PIN lock */}
          <div className="border-t border-dona-border pt-3 space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
              <Lock className="w-3.5 h-3.5 text-blue-400" />
              {t("accounts.accountLock")}
            </span>
            {hasLock ? (
              <div className="flex items-center justify-between bg-dona-dark rounded-lg px-3 py-1.5">
                <span className="text-xs text-emerald-400">{t("settings.pinEnabled")}</span>
                <button
                  type="button"
                  onClick={() => void handleClearPin()}
                  className="text-xs text-red-400 hover:underline"
                >
                  {t("settings.clearPin")}
                </button>
              </div>
            ) : (
              <input
                type="password"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder={t("settings.pinPlaceholder")}
                className="w-full rounded-lg bg-dona-dark border border-dona-border px-3 py-1.5 text-xs text-white"
              />
            )}
          </div>

          <div className="flex items-center justify-between pt-2">
            {editingAccount ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1 text-xs text-red-400 hover:underline"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t("accounts.deleteAccount")}
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:bg-white/10 transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
              >
                {saving ? t("common.loading") : t("common.save")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
