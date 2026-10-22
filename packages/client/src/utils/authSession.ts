/** 당일 로그인만 유지. PC를 끄고 다음 날 켜면 다시 로그인한다. */
export const LOGIN_DATE_KEY = 'emax_login_date';

export function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isSessionFromToday(): boolean {
  try {
    return localStorage.getItem(LOGIN_DATE_KEY) === todayLocalDate();
  } catch {
    return false;
  }
}

export function markSessionToday(): void {
  try {
    localStorage.setItem(LOGIN_DATE_KEY, todayLocalDate());
  } catch {
    /* ignore */
  }
}

export function clearSessionDate(): void {
  try {
    localStorage.removeItem(LOGIN_DATE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * 저장된 토큰이 오늘 로그인한 세션일 때만 반환.
 * Electron에서는 OS 암호화 API(safeStorage)로 암호화된 파일에 저장하고,
 * 평문 localStorage에는 남기지 않는다(기존에 저장된 평문 토큰은 1회 자동 이전 후 삭제).
 */
export function getActiveToken(): string | null {
  try {
    if (!isSessionFromToday()) return null;
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.readTokenSync) {
      const secure = api.readTokenSync();
      if (secure) return secure;
      const legacy = localStorage.getItem('token');
      if (legacy) {
        api.writeToken?.(legacy).catch(() => {});
        localStorage.removeItem('token');
        return legacy;
      }
      return null;
    }
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

/** 로그인 성공 시 토큰 저장(Electron: 암호화 파일 / 그 외: localStorage) */
export function setStoredToken(token: string): void {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.writeToken) {
      api.writeToken(token).catch(() => {});
      localStorage.removeItem('token');
      return;
    }
    localStorage.setItem('token', token);
  } catch {
    /* ignore */
  }
}

/** 로그아웃·강제 로그아웃 시 저장된 토큰 삭제 */
export function removeStoredToken(): void {
  try {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (api?.clearToken) api.clearToken().catch(() => {});
    localStorage.removeItem('token');
  } catch {
    /* ignore */
  }
}
