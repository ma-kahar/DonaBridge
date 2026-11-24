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
  setAccounts: (accounts: Account[]) => void;
  setActiveAccount: (id: string | null) => void;
  updateUnread: (id: string, count: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  accounts: [],
  activeAccountId: null,
  setAccounts: (accounts) => set({ accounts }),
  setActiveAccount: (id) => set({ activeAccountId: id }),
  updateUnread: (id, count) =>
    set((state) => ({
      accounts: state.accounts.map((a) => (a.id === id ? { ...a, unreadCount: count } : a)),
    })),
}));
