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
}

interface AppState {
  accounts: Account[];
  activeAccountId: string | null;
  theme: "dark" | "light";
  setAccounts: (accounts: Account[]) => void;
  setActiveAccount: (id: string | null) => void;
  updateUnread: (id: string, count: number) => void;
  toggleTheme: () => void;
}

const savedTheme: "dark" | "light" =
  (typeof localStorage !== "undefined"
    ? (localStorage.getItem("dona_theme") as "dark" | "light" | null)
    : null) ?? "dark";

export const useAppStore = create<AppState>((set) => ({
  accounts: [],
  activeAccountId: null,
  theme: savedTheme,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccountId: id }),
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
