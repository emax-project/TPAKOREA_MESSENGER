import { useEffect, useRef, useState, Component, lazy, Suspense, type ReactNode } from 'react';
import { useThemeStore } from './store';
import { getOrgTheme, hexToRgbTriplet } from './utils/orgTheme';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store';
import { authApi } from './api';
import { isSessionFromToday } from './utils/authSession';
import MacTitleBarInset from './components/MacTitleBarInset';
import ElectronSecondaryShell from './components/ElectronSecondaryShell';
import ScreenLockGate from './components/ScreenLockGate';
import { cn } from './utils/cn';
import { isMacElectron } from './utils/electronChrome';

const Login = lazy(() => import('./pages/Login'));
const Main = lazy(() => import('./pages/Main'));
const ChatWindow = lazy(() => import('./pages/ChatWindow'));
const KanbanPage = lazy(() => import('./pages/KanbanPage'));
const GanttPage = lazy(() => import('./pages/GanttPage'));

/** 메인/인증 화면: PC에서도 모바일 maxWidth로 중앙 정렬. 칸반·간트·독립 채팅 창은 전체 폭. */
function MobileShell({ children }: { children: ReactNode }) {
  const isDark = useThemeStore((s) => s.isDark);
  const macChrome = isMacElectron();

  return (
    <div className={cn('app-mobile-shell', macChrome && 'app-mobile-shell--mac')}>
      {macChrome && <MacTitleBarInset isDark={isDark} overlay />}
      {children}
    </div>
  );
}

// Electron: HashRouter — file:// + hash(#/kanban/...) 로 보조 창 라우팅 (MemoryRouter는 초기 hash 미반영)
// BrowserRouter는 file:// 에서 /login 등으로 이동 시 ERR_FILE_NOT_FOUND 발생
const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { error: err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo) { console.error('App ErrorBoundary:', err, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#fff', color: '#1e293b', minHeight: '100vh' }}>
          <h2 style={{ color: '#dc2626' }}>오류가 발생했습니다</h2>
          <pre style={{ background: '#f1f5f9', padding: 16, borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
            {this.state.error.toString()}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '10px 20px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, cursor: 'pointer', fontWeight: 600 }}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function getElectronInitialPath() {
  const hash = window.location.hash?.slice(1);
  if (hash) return hash.startsWith('/') ? hash : `/${hash}`;
  const fromPreload = window.electronAPI?.initialRoute;
  if (fromPreload) return fromPreload;
  return '/';
}

/** Electron 보조 창: 최초 마운트 시 hash/preload 경로로 1회만 동기화 (이후 사용자 내비게이션은 건드리지 않음) */
function ElectronRouteBootstrap() {
  const navigate = useNavigate();
  const didBootstrap = useRef(false);

  useEffect(() => {
    if (!isElectron || didBootstrap.current) return;
    didBootstrap.current = true;
    const expectedPath = getElectronInitialPath();
    if (!expectedPath || expectedPath === '/') return;
    navigate(expectedPath, { replace: true });
  }, [navigate]);

  return null;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const storeToken = useAuthStore((s) => s.token);
  const [authReady, setAuthReady] = useState(() => useAuthStore.persist.hasHydrated());

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setAuthReady(true);
      return;
    }
    return useAuthStore.persist.onFinishHydration(() => setAuthReady(true));
  }, []);

  const token = storeToken ?? (isSessionFromToday() ? localStorage.getItem('token') : null);

  if (!authReady && !token) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#94a3b8', fontSize: 15 }}>
        로딩 중...
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  return (
    <>
      <ScreenLockGate />
      {children}
    </>
  );
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const logout = useAuthStore((s) => s.logout);
  const [forcedLogoutMsg, setForcedLogoutMsg] = useState<string | null>(null);
  const isDark = useThemeStore((s) => s.isDark);
  const accentTheme = useThemeStore((s) => s.accentTheme);

  // 조직도 색상 테마를 --color-brand-dark 커스텀 프로퍼티에 반영해, 이미 이
  // 변수를 참조하는 대화방(링크·답장 미리보기·멘션 배지·업로드 진행바 등)
  // 곳곳의 포인트 컬러도 자동으로 테마를 따르게 한다. 독립 채팅창(별도
  // BrowserWindow/문서)에서도 각자 마운트 시 이 효과가 실행되므로 함께 반영된다.
  // 다크 모드는 대비 문제로 테마 선택과 무관하게 항상 기존 색을 유지한다.
  useEffect(() => {
    const root = document.documentElement;
    const theme = getOrgTheme(accentTheme);
    if (!isDark && theme.id !== 'default') {
      root.style.setProperty('--color-brand-dark', theme.accent);
      root.style.setProperty('--color-brand-dark-rgb', hexToRgbTriplet(theme.accent));
    } else {
      root.style.removeProperty('--color-brand-dark');
      root.style.removeProperty('--color-brand-dark-rgb');
    }
  }, [isDark, accentTheme]);

  useEffect(() => {
    if (!token) return;
    authApi.me()
      .then(({ user }) => setAuth(user, token))
      .catch((err) => {
        // 401은 api.ts의 handleForcedLogout이 자동 처리
        // 네트워크 오류 등 일시적 실패는 조용히 무시
        if (!(err instanceof Error && err.message === 'Unauthorized')) {
          console.warn('[auth/me] 사용자 정보 갱신 실패:', err.message);
        }
      });
  }, [token, setAuth]);

  useEffect(() => {
    if (!window.electronAPI?.onLogout) return;
    const unsubscribe = window.electronAPI.onLogout(() => {
      logout();
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [logout]);

  // Electron: API 401 시 handleForcedLogout이 emax-force-logout 이벤트 발송 → logout() 호출
  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('emax-force-logout', handler);
    return () => window.removeEventListener('emax-force-logout', handler);
  }, [logout]);

  useEffect(() => {
    try {
      const msg = localStorage.getItem('forcedLogoutMessage');
      if (msg) {
        localStorage.removeItem('forcedLogoutMessage');
        setForcedLogoutMsg(msg);
        setTimeout(() => setForcedLogoutMsg(null), 3000);
      }
    } catch {
      // ignore
    }
  }, []);

  // Electron: overflow 제약 해제 + macOS 타이틀바 여백 클래스
  useEffect(() => {
    if (!isElectron) return;
    document.body.classList.add('electron-app');
    if (isMacElectron()) document.body.classList.add('electron-mac');
    return () => {
      document.body.classList.remove('electron-app', 'electron-mac');
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('theme-dark', isDark);
    document.body.classList.toggle('theme-light', !isDark);
  }, [isDark]);

  // 날짜가 바뀌면 세션을 끊고 로그인 화면으로 보낸다
  useEffect(() => {
    const check = () => {
      const auth = useAuthStore.getState();
      if (auth.token && !isSessionFromToday()) auth.logout();
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVis);
    const id = window.setInterval(check, 60_000);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVis);
      window.clearInterval(id);
    };
  }, []);

  // Electron: React 마운트 완료 후 main process에 창 표시 신호 전송
  useEffect(() => {
    if (!window.electronAPI?.notifyAppReady) return;
    const t = setTimeout(() => {
      window.electronAPI!.notifyAppReady();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  const RouterWrapper = isElectron ? HashRouter : BrowserRouter;

  const fallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', color: '#94a3b8', fontSize: 15 }}>
      로딩 중...
    </div>
  );

  return (
    <ErrorBoundary>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%', width: '100%', overflow: 'hidden' }}>
        <RouterWrapper>
          <Suspense fallback={fallback}>
          <ElectronRouteBootstrap />
          <Routes>
        <Route path="/login" element={<MobileShell><Login /></MobileShell>} />
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <MobileShell><Main /></MobileShell>
            </PrivateRoute>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <PrivateRoute>
              <MobileShell><Main /></MobileShell>
            </PrivateRoute>
          }
        />
        <Route
          path="/chat/:roomId"
          element={
            <PrivateRoute>
              <ElectronSecondaryShell>
                <ChatWindow />
              </ElectronSecondaryShell>
            </PrivateRoute>
          }
        />
        <Route
          path="/kanban/:roomId"
          element={
            <PrivateRoute>
              <ElectronSecondaryShell>
                <KanbanPage />
              </ElectronSecondaryShell>
            </PrivateRoute>
          }
        />
        <Route
          path="/gantt/:roomId"
          element={
            <PrivateRoute>
              <ElectronSecondaryShell>
                <GanttPage />
              </ElectronSecondaryShell>
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
          </Suspense>
        {forcedLogoutMsg && (
        <div style={toastStyle(isDark, true)}>
          <span style={toastIconStyle(isDark)}>⚠</span>
          <span>{forcedLogoutMsg}</span>
        </div>
      )}
        </RouterWrapper>
      </div>
    </ErrorBoundary>
  );
}

const toastStyle = (dark: boolean, fading: boolean): React.CSSProperties => ({
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  background: dark ? '#e2e8f0' : '#0f172a',
  color: dark ? '#0f172a' : '#fff',
  padding: '10px 14px',
  borderRadius: 999,
  fontSize: 12,
  boxShadow: dark ? '0 6px 18px rgba(0,0,0,0.25)' : '0 6px 18px rgba(0,0,0,0.2)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  animation: fading ? 'toast-slide 220ms ease-out, toast-fade 220ms ease-in 2.7s' : 'toast-slide 220ms ease-out',
  zIndex: 100000,
});

const toastIconStyle = (dark: boolean): React.CSSProperties => ({
  fontSize: 13,
  color: dark ? '#0f172a' : '#f8fafc',
  lineHeight: 1,
});
