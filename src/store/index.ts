import { create } from "zustand";

export interface Account {
  id: string;
  name: string;
  color: string;
  iconText: string;
  category: string;
  muted: boolean;
  sortOrder: number;
  unreadCount: number;
  avatarDataUrl?: string | null;
  hasLock?: boolean;
  groupId?: string | null;
}

export type AccountsStatus = "idle" | "loading" | "ready" | "error";
export type SessionState = "connected" | "logged_out" | "loading";

export interface AccountGroup {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

interface AppState {
  accounts: Account[];
  groups: AccountGroup[];
  accountsStatus: AccountsStatus;
  accountsError: string | null;
  activeAccountId: string | null;
  sessionStates: Record<string, SessionState>;
  theme: "dark" | "light";
  setAccounts: (accounts: Account[]) => void;
  setGroups: (groups: AccountGroup[]) => void;
  setAccountsStatus: (status: AccountsStatus, error?: string | null) => void;
  setActiveAccount: (id: string | null) => void;
  setSessionState: (id: string, state: SessionState) => void;
  updateUnread: (id: string, count: number) => void;
  toggleTheme: () => void;
}

const savedTheme: "dark" | "light" =
  (typeof localStorage !== "undefined"
    ? (localStorage.getItem("dona_theme") as "dark" | "light" | null)
    : null) ?? "dark";

export const useAppStore = create<AppState>((set) => ({
  accounts: [],
  groups: [],
  accountsStatus: "idle",
  accountsError: null,
  activeAccountId: null,
  sessionStates: {},
  theme: savedTheme,
  setAccounts: (accounts) => set({ accounts }),
  setGroups: (groups) => set({ groups }),
  setAccountsStatus: (accountsStatus, accountsError = null) =>
    set({ accountsStatus, accountsError }),
  setActiveAccount: (id) => set({ activeAccountId: id }),
  setSessionState: (id, state) =>
    set((s) => ({ sessionStates: { ...s.sessionStates, [id]: state } })),
  updateUnread: (id, count) =>
    set((state) => ({
      accounts: state.accounts.map((a) => (a.id === id ? { ...a, unreadCount: count } : a)),
    })),
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === "dark" ? "light" : "dark";
      localStorage.setItem("dona_theme", next);
      // Apply to <html>
      document.documentElement.classList.toggle("dark", next === "dark");
      document.documentElement.classList.toggle("light", next === "light");
      return { theme: next };
    }),
}));

// Apply saved theme on load
document.documentElement.classList.toggle("dark", savedTheme === "dark");
document.documentElement.classList.toggle("light", savedTheme === "light");
