import { getCurrentWindow } from "@tauri-apps/api/window";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../lib/ipc";
import { useAppStore } from "../store";

function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function RestoreGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3.2 1.2h5.6v5.6" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M1.2 3.2h5.6v5.6H1.2z" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/**
 * Frameless-window title bar (`decorations: false`).
 *
 * The whole strip is a drag region; the built-in Tauri drag handler also
 * maximises on double click. Window buttons call the Tauri window API and are
 * rendered inert when the app runs in a plain browser (pnpm dev preview).
 */
export default function TitleBar({ onOpenAbout }: { onOpenAbout: () => void }) {
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const active = accounts.find((account) => account.id === activeAccountId) ?? null;
  const [maximized, setMaximized] = useState(false);
  const desktop = isTauri();

  useEffect(() => {
    if (!desktop) return;
    const win = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;

    void win
      .isMaximized()
      .then((value) => {
        if (alive) setMaximized(value);
      })
      .catch(() => {});

    void win
      .onResized(() => {
        void win
          .isMaximized()
          .then((value) => {
            if (alive) setMaximized(value);
          })
          .catch(() => {});
      })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      })
      .catch(() => {});

    return () => {
      alive = false;
      unlisten?.();
    };
  }, [desktop]);

  function run(action: (win: ReturnType<typeof getCurrentWindow>) => Promise<unknown>) {
    if (!desktop) return;
    void action(getCurrentWindow()).catch(() => {});
  }

  return (
    <div className="dona-titlebar relative z-[70] shrink-0" data-tauri-drag-region>
      <div className="dona-titlebar__brand flex-1 min-w-0" data-tauri-drag-region>
        <span className="dona-titlebar__logo" data-tauri-drag-region>
          <img src="/favicon.png" alt="" draggable={false} data-tauri-drag-region />
        </span>
        <span className="dona-titlebar__name" data-tauri-drag-region>
          Dona Bridge
        </span>
        {active && (
          <span className="dona-titlebar__account truncate" data-tauri-drag-region>
            <span
              className="dona-titlebar__account-dot"
              style={{ backgroundColor: active.color }}
              aria-hidden="true"
            />
            {active.name}
          </span>
        )}
      </div>

      <div className="dona-titlebar__status" data-tauri-drag-region>
        <span className="dona-titlebar__online" data-tauri-drag-region>
          <span className="dona-titlebar__online-dot" aria-hidden="true" />
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </span>
      </div>

      <div className="dona-titlebar__controls">
        <button
          type="button"
          className="dona-titlebar__btn dona-titlebar__btn--info"
          title="About Dona Bridge"
          aria-label="About Dona Bridge"
          onClick={onOpenAbout}
        >
          <Info className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          className="dona-titlebar__btn"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => run((win) => win.minimize())}
        >
          <MinimizeGlyph />
        </button>
        <button
          type="button"
          className="dona-titlebar__btn"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => run((win) => win.toggleMaximize())}
        >
          {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
        </button>
        <button
          type="button"
          className="dona-titlebar__btn dona-titlebar__btn--close"
          title="Close"
          aria-label="Close"
          onClick={() => run((win) => win.close())}
        >
          <CloseGlyph />
        </button>
      </div>
    </div>
  );
}
