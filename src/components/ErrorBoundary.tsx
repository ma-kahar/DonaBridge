import { AlertTriangle, FolderOpen, RefreshCw, Save } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { appHealth, exportDiagnostics, isTauri } from "../lib/ipc";

interface ErrorBoundaryState {
  error: Error | null;
  busy: boolean;
  status: string | null;
}

/**
 * Last line of defence for the React shell: a render error must never leave a
 * blank window. The user gets Reload, Open logs and Export diagnostics.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, busy: false, status: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Dona Bridge UI error", error, info);
  }

  private openLogs = async () => {
    if (!isTauri()) return;
    try {
      const health = await appHealth();
      if (health) await revealItemInDir(health.log_dir);
    } catch (err) {
      this.setState({ status: String(err) });
    }
  };

  private exportBundle = async () => {
    if (!isTauri()) return;
    this.setState({ busy: true, status: null });
    try {
      const path = await exportDiagnostics();
      this.setState({ status: `Diagnostics saved: ${path}` });
      await revealItemInDir(path);
    } catch (err) {
      this.setState({ status: String(err) });
    } finally {
      this.setState({ busy: false });
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="h-screen w-screen flex items-center justify-center bg-dona-dark text-dona-fg p-6">
        <div className="w-full max-w-lg rounded-2xl border border-dona-border bg-dona-panel p-6 space-y-4 shadow-2xl">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <h1 className="text-base font-semibold">The interface hit an error</h1>
          </div>
          <p className="text-xs text-dona-muted leading-relaxed">
            Your data is safe on this PC. Reload the interface; if it happens again, open the logs
            or export diagnostics and send them to support.
          </p>
          <pre className="text-[10px] text-red-300 bg-dona-dark/60 border border-dona-border rounded-lg p-2 max-h-32 overflow-auto whitespace-pre-wrap break-words">
            {this.state.error.message}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded-lg bg-dona-accent hover:bg-dona-accentHover text-white text-xs font-medium inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload interface
            </button>
            {isTauri() && (
              <>
                <button
                  type="button"
                  onClick={() => void this.openLogs()}
                  className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 text-xs inline-flex items-center gap-1.5"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Open logs
                </button>
                <button
                  type="button"
                  disabled={this.state.busy}
                  onClick={() => void this.exportBundle()}
                  className="px-3 py-1.5 rounded-lg border border-dona-border hover:bg-white/5 disabled:opacity-50 text-xs inline-flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Export diagnostics
                </button>
              </>
            )}
          </div>
          {this.state.status && (
            <p className="text-[10px] text-dona-muted break-all">{this.state.status}</p>
          )}
        </div>
      </div>
    );
  }
}
