import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, getBaseUrl } from '../api';
import type { LoginSuccess } from '../api';
import MfaSetupPanel from '../components/MfaSetupPanel';
import { useScreenLockStore } from '../utils/screenLock';
import { useAuthStore } from '../store';
import TitleBar, { MacInsetChromeTools } from '../components/TitleBar';
import { AuthCard } from '../components/AuthCard';
import UITextInput from '../components/ui/UITextInput';
import { APP_MAX_WIDTH } from '../layout/constants';
import { applyWindowPinClass, isMacElectron } from '../utils/electronChrome';
import { isNotificationPopupEnabled } from '../utils/notificationPopup';

const LOGIN_WINDOW_HEIGHT = 720;
const REMEMBER_EMAIL_KEY = 'emax_remember_email';
const SAVED_EMAIL_KEY = 'emax_saved_email';

function loadRememberedEmail(): { remember: boolean; email: string } {
  try {
    const remember = localStorage.getItem(REMEMBER_EMAIL_KEY) === '1';
    const email = remember ? (localStorage.getItem(SAVED_EMAIL_KEY) || '') : '';
    return { remember, email };
  } catch {
    return { remember: false, email: '' };
  }
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function Login() {
  const remembered = loadRememberedEmail();
  const [email, setEmail] = useState(remembered.email);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // 지원용 정보: 접속 서버와 앱 버전(데스크톱 앱에서만). 로그인 오류 캡처만으로 어떤 설치본이 어디에 붙는지 알 수 있다.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.electronAPI?.getAppInfo?.()
      .then((info) => { if (!cancelled && info?.version) setAppVersion(info.version); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const serverLabel = (() => {
    const base = getBaseUrl();
    if (!base) return typeof window !== 'undefined' ? window.location.host : '';
    try { return new URL(base).host; } catch { return base; }
  })();
  const [rememberEmail, setRememberEmail] = useState(remembered.remember);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 2차 인증 진행 중이면 5분짜리 중간 토큰을 들고 있는다(verify: 코드 입력, setup: 필수 정책에 따른 최초 등록)
  const [mfa, setMfa] = useState<{ kind: 'verify' | 'setup'; token: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [pinned, setPinned] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  useEffect(() => {
    void window.electronAPI?.setWindowUiMode?.('login', APP_MAX_WIDTH, LOGIN_WINDOW_HEIGHT);
    void window.electronAPI?.getAlwaysOnTop?.().then((r) => {
      const on = !!r?.alwaysOnTop;
      setPinned(on);
      applyWindowPinClass(on);
    });
  }, []);

  /** 비밀번호(와 2차 인증)까지 모두 통과한 뒤의 공통 마무리 */
  const completeLogin = ({ user, token, mustChangePassword }: LoginSuccess) => {
    try {
      if (rememberEmail) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, '1');
        localStorage.setItem(SAVED_EMAIL_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY);
        localStorage.removeItem(SAVED_EMAIL_KEY);
      }
    } catch { /* ignore */ }
    setAuth(user, token, { mustChangePassword: !!mustChangePassword });
    // 이전에 잠긴 채 종료됐더라도 새로 로그인했다면 잠금을 풀고 시작한다
    useScreenLockStore.getState().unlock();
    if (isNotificationPopupEnabled()) {
      window.electronAPI?.showNotification('로그인', `${user.name}님 로그인되었습니다.`);
    }
    navigate('/', { replace: true });
  };

  const showError = (err: unknown, fallback: string) => {
    const msg = err instanceof Error ? err.message : '';
    const isNetwork = /fetch|network|connection|refused|Failed to fetch|INVALID_HTTP/i.test(msg) || msg === '';
    setError(isNetwork ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' : msg || fallback);
  };

  const backToCredentials = (message = '') => {
    setMfa(null);
    setMfaCode('');
    setPassword('');
    setError(message);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(email, password);
      if (res.mfaRequired) {
        setMfa({ kind: 'verify', token: res.mfaToken });
        return;
      }
      if (res.mfaSetupRequired) {
        setMfa({ kind: 'setup', token: res.mfaToken });
        return;
      }
      completeLogin(res);
    } catch (err) {
      showError(err, '로그인 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfa || mfa.kind !== 'verify' || !mfaCode.trim()) return;
    setError('');
    setLoading(true);
    try {
      completeLogin(await authApi.mfaVerify(mfa.token, mfaCode.trim()));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'MFA_TOKEN_INVALID') {
        backToCredentials('인증 시간이 만료되었습니다. 처음부터 다시 로그인해 주세요.');
      } else {
        showError(err, '인증에 실패했습니다');
        setMfaCode('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePin = async () => {
    const next = !pinned;
    const r = await window.electronAPI?.setAlwaysOnTop?.(next);
    const on = !!(r?.alwaysOnTop ?? next);
    setPinned(on);
    applyWindowPinClass(on);
  };

  const isElectron = !!window.electronAPI;
  const isMac = isMacElectron();
  const chromeTools = {
    showPin: true,
    pinned,
    onTogglePin: () => { void handleTogglePin(); },
  };

  return (
    <div className="w-full h-full min-h-0 flex flex-col bg-white">
      {isElectron && isMac && <MacInsetChromeTools {...chromeTools} />}
      {isElectron && !isMac && (
        <TitleBar
          title="TPA-Korea"
          showLogo
          showMaximize={false}
          {...chromeTools}
        />
      )}
      <div className="flex-1 flex items-stretch justify-center overflow-y-auto">
        <AuthCard
          title={mfa ? '2차 인증' : '로그인'}
          variant="flush"
        >
          {mfa?.kind === 'setup' ? (
            <div className="w-full">
              <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                관리자가 2차 인증을 필수로 설정했습니다. 등록을 마쳐야 로그인할 수 있습니다.
              </p>
              <MfaSetupPanel
                mfaToken={mfa.token}
                onDone={(login) => {
                  if (login) completeLogin(login);
                  else backToCredentials('등록되었습니다. 다시 로그인해 주세요.');
                }}
                onCancel={() => backToCredentials()}
              />
            </div>
          ) : mfa?.kind === 'verify' ? (
            <form onSubmit={(e) => { void handleMfaSubmit(e); }} className="flex flex-col gap-4 w-full">
              <p className="m-0 text-[13px] leading-relaxed text-slate-600">
                인증 앱에 표시된 6자리 코드를 입력하세요. 휴대폰을 쓸 수 없다면 복구 코드를 입력할 수 있습니다.
              </p>
              <UITextInput
                type="text"
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="6자리 코드 또는 복구 코드"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                autoFocus
                required
                className="!px-4 !py-3 !rounded-xl !border !border-[#e2e8f0] !bg-[#f8fafc] !text-black placeholder:!text-[#64748b]"
              />
              {error && (
                <p className="px-3 py-2 rounded-xl text-[13px] text-red-600 bg-red-50/80" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={loading || !mfaCode.trim()}
                className="w-full py-3.5 rounded-full bg-black text-white font-semibold text-[15px] disabled:opacity-60 transition-opacity"
              >
                {loading ? '확인 중...' : '확인'}
              </button>
              <button type="button" onClick={() => backToCredentials()} className="border-none bg-transparent py-1 text-[13px] text-slate-500 underline">
                처음으로
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            <div className="relative">
              <UITextInput
                type="text"
                placeholder="아이디 또는 이메일"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                className="!px-4 !py-3 !rounded-xl !border !border-[#e2e8f0] !bg-[#f8fafc] !text-black placeholder:!text-[#64748b]"
              />
            </div>
            <div className="relative">
              <UITextInput
                type={showPassword ? 'text' : 'password'}
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="!px-4 !py-3 !pr-12 !rounded-xl !border !border-[#e2e8f0] !bg-[#f8fafc] !text-black placeholder:!text-[#64748b]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#334155] hover:text-[#0f172a] p-1"
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none self-start">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
                className="w-4 h-4 rounded border-[#cbd5e1] accent-black cursor-pointer"
              />
              <span className="text-[13px] text-[#334155]">아이디 저장</span>
            </label>
            {error && (
              <p className="px-3 py-2 rounded-xl text-[13px] text-red-600 bg-red-50/80">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-full bg-black text-white font-semibold text-[15px] disabled:opacity-60 transition-opacity"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
            <p className="m-0 text-center text-[11px] text-[#94a3b8] select-text" data-testid="login-support-info">
              {[appVersion ? `v${appVersion}` : null, serverLabel || null].filter(Boolean).join(' · ')}
            </p>
          </form>
          )}
        </AuthCard>
      </div>
    </div>
  );
}
