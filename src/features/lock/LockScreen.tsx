import { Fingerprint, Lock } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { securityUnlockHello, securityUnlockPin } from "../../lib/ipc";

interface LockScreenProps {
  helloAvailable: boolean;
  onUnlocked: () => void;
}

export default function LockScreen({ helloAvailable, onUnlocked }: LockScreenProps) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  async function handlePinSubmit(e: FormEvent) {
    e.preventDefault();
    setError(false);
    const ok = await securityUnlockPin(pin);
    if (ok) {
      setPin("");
      onUnlocked();
    } else {
      setError(true);
    }
  }

  async function handleHello() {
    setError(false);
    const ok = await securityUnlockHello();
    if (ok) {
      onUnlocked();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dona-dark/95 backdrop-blur-md p-4">
      <div className="w-full max-w-sm rounded-2xl bg-dona-panel border border-dona-border p-8 text-center space-y-5 shadow-2xl">
        <div className="mx-auto w-14 h-14 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-400">
          <Lock className="w-7 h-7" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">{t("lock.title")}</h1>
          <p className="text-xs text-gray-400 mt-1">{t("lock.subtitle")}</p>
        </div>

        <form onSubmit={handlePinSubmit} className="space-y-3">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder={t("lock.pinPlaceholder")}
            className="w-full rounded-lg bg-dona-dark border border-dona-border px-4 py-2.5 text-center text-white tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-400">{t("lock.wrongPin")}</p>}
          <button
            type="submit"
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
          >
            {t("lock.unlock")}
          </button>
        </form>

        {helloAvailable && (
          <button
            type="button"
            onClick={handleHello}
            className="w-full py-2.5 rounded-lg border border-dona-border hover:bg-white/5 text-sm text-gray-200 flex items-center justify-center gap-2 transition-colors"
          >
            <Fingerprint className="w-4 h-4" />
            {t("lock.hello")}
          </button>
        )}
      </div>
    </div>
  );
}
