import { create } from 'zustand';

/**
 * 화면 잠금 상태는 모든 창(메인·채팅·칸반 등 별도 BrowserWindow)이 공유한다.
 * 같은 origin의 localStorage와 'storage' 이벤트로 동기화한다 — 한 창에서 잠기면 다른 창도
 * 즉시 잠기고, 어느 창에서든 입력이 있으면 "마지막 활동" 시각이 갱신된다.
 * 잠금 상태를 저장하므로 앱을 껐다 켜도 잠긴 채로 시작한다.
 */
export const LOCK_KEY = 'emax_screen_locked';
export const ACTIVITY_KEY = 'emax_last_activity';

function readLocked(): boolean {
  try {
    return localStorage.getItem(LOCK_KEY) === '1';
  } catch {
    return false;
  }
}

type ScreenLockState = {
  locked: boolean;
  lock: () => void;
  unlock: () => void;
};

export const useScreenLockStore = create<ScreenLockState>((set) => ({
  locked: readLocked(),
  lock: () => {
    try {
      localStorage.setItem(LOCK_KEY, '1');
    } catch {
      /* 저장 실패해도 이 창은 잠근다 */
    }
    set({ locked: true });
  },
  unlock: () => {
    try {
      localStorage.removeItem(LOCK_KEY);
      // 해제 직후 곧바로 다시 잠기지 않도록 활동 시각을 지금으로 맞춘다
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    set({ locked: false });
  },
}));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LOCK_KEY) useScreenLockStore.setState({ locked: e.newValue === '1' });
  });
}

/** 마지막 활동 후 minutes분이 지났는지. minutes가 0 이하이면 항상 false(사용 안 함). */
export function isIdleExpired(lastActivityMs: number, nowMs: number, minutes: number): boolean {
  if (!(minutes > 0)) return false;
  return nowMs - lastActivityMs >= minutes * 60_000;
}

export function readLastActivity(): number | null {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writeLastActivity(ms: number): void {
  try {
    localStorage.setItem(ACTIVITY_KEY, String(ms));
  } catch {
    /* ignore */
  }
}
