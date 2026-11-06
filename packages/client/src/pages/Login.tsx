import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api';
import { useAuthStore } from '../store';
import TitleBar, { MacInsetChromeTools } from '../components/TitleBar';
import { AuthCard } from '../components/AuthCard';
import UITextInput from '../components/ui/UITextInput';
import { APP_MAX_WIDTH } from '../layout/constants';
import { applyWindowPinClass, isMacElectron } from '../utils/electronChrome';

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
  const [rememberEmail, setRememberEmail] = useState(remembered.remember);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { user, token, mustChangePassword } = await authApi.login(email, password);
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
      window.electronAPI?.showNotification('로그인', `${user.name}님 로그인되었습니다.`);
      navigate('/', { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const isNetwork = /fetch|network|connection|refused|Failed to fetch|INVALID_HTTP/i.test(msg) || msg === '';
      setError(isNetwork ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.' : msg || '로그인 실패');
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
        <AuthCard title="로그인" variant="flush">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 w-full">
            <div className="relative">
              <UITextInput
                type="text"
                placeholder="아이디 또는 이메일 (예: wtkim)"
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
          </form>
        </AuthCard>
      </div>
    </div>
  );
}
