import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Socket } from 'socket.io-client';
import { authApi, getBaseUrl, type User } from './api';
import { clearSessionDate, getActiveToken, markSessionToday, removeStoredToken, setStoredToken, setTrustedBaseUrl } from './utils/authSession';
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
          setStoredToken(token);
          setTrustedBaseUrl(getBaseUrl());
          markSessionToday();
        } else {
          removeStoredToken();
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
        removeStoredToken();
        clearSessionDate();
        window.electronAPI?.clearAppCache?.().catch(() => {});
        set({ user: null, token: null, mustChangePassword: false });
      },
    }),
    {
      name: 'auth',
      // token은 암호화 저장소(authSession)가 단일 소스 — localStorage에 평문으로
      // 남기지 않도록 persist 대상에서 제외한다.
      partialize: (state) => ({ user: state.user, mustChangePassword: state.mustChangePassword }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<AuthState> | undefined;
        const activeToken = getActiveToken();
        if (!activeToken) {
          removeStoredToken();
          clearSessionDate();
          return { ...current, ...saved, user: null, token: null, mustChangePassword: false };
        }
        return { ...current, ...saved, token: activeToken };
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

// 메인 창의 socket.io 연결 1개를 메인 창 안에서 공유하기 위한 저장소.
// 대화창을 메인 창 "안"(임베디드)에서 열 때 이 연결을 재사용해, 같은 창 안에서
// 소켓 연결이 중복 생성되는 걸 막는다. 팝업(별도) 대화창은 별도 프로세스라
// 이 저장소를 공유할 수 없으므로 그쪽은 기존처럼 자체 연결을 유지한다.
type MainSocketState = {
  socket: Socket | null;
  setMainSocket: (socket: Socket | null) => void;
};

export const useMainSocketStore = create<MainSocketState>()((set) => ({
  socket: null,
  setMainSocket: (socket) => set({ socket }),
}));
