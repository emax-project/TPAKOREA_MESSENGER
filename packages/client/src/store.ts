import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authApi, type User } from './api';
import { clearSessionDate, isSessionFromToday, markSessionToday } from './utils/authSession';
import type { OrgThemeId } from './utils/orgTheme';

type AuthState = {
  user: User | null;
  token: string | null;
  mustChangePassword: boolean;
  setAuth: (user: User | null, token: string | null, opts?: { mustChangePassword?: boolean }) => void;
  setMustChangePassword: (value: boolean) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      mustChangePassword: false,
      setAuth: (user, token, opts) => {
        if (token) {
          localStorage.setItem('token', token);
          markSessionToday();
        } else {
          localStorage.removeItem('token');
          clearSessionDate();
        }
        set((s) => ({
          user,
          token,
          mustChangePassword:
            opts && 'mustChangePassword' in opts ? !!opts.mustChangePassword : s.mustChangePassword,
        }));
      },
      setMustChangePassword: (value) => set({ mustChangePassword: value }),
      logout: () => {
        authApi.logout().catch(() => {});
        localStorage.removeItem('token');
        clearSessionDate();
        window.electronAPI?.clearAppCache?.().catch(() => {});
        set({ user: null, token: null, mustChangePassword: false });
      },
    }),
    {
      name: 'auth',
      merge: (persisted, current) => {
        const saved = persisted as AuthState | undefined;
        if (saved?.token && !isSessionFromToday()) {
          localStorage.removeItem('token');
          clearSessionDate();
          return { ...current, user: null, token: null, mustChangePassword: false };
        }
        return { ...current, ...saved };
      },
    }
  )
);

type ThemeState = {
  isDark: boolean;
  toggleDark: () => void;
  /** 조직도 상단 영역·선택 부서 강조색 테마. 'default'는 기존 파란색을 그대로 씀. */
  accentTheme: OrgThemeId;
  setAccentTheme: (id: OrgThemeId) => void;
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      toggleDark: () => set((s) => ({ isDark: !s.isDark })),
      accentTheme: 'default',
      setAccentTheme: (id) => set({ accentTheme: id }),
    }),
    { name: 'theme' }
  )
);

// Toast
type Toast = {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error';
};

type ToastState = {
  toasts: Toast[];
  show: (message: string, type?: Toast['type']) => void;
  remove: (id: number) => void;
};

let toastIdCounter = 1;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  show: (message, type = 'info') => {
    const id = toastIdCounter++;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
