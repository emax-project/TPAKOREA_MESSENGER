import { useEffect, useRef, useState } from 'react';
import { authApi } from '../api';
import { useAuthStore } from '../store';
import { useScreenLockStore } from '../utils/screenLock';
import UITextInput from './ui/UITextInput';

/**
 * 화면 잠금 오버레이. 잠금 해제는 /auth/verify-password로 현재 세션을 유지한 채 비밀번호만 확인한다.
 * (예전처럼 /auth/login을 다시 호출하면 서버가 기존 세션을 모두 지워 해제 직후 로그아웃된다.)
 * 뒤쪽 화면이 비치지 않도록 불투명하게 덮는다.
 */
export default function AppLockOverlay() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const unlock = useScreenLockStore((s) => s.unlock);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  // StrictMode(개발)는 effect를 마운트→정리→재마운트 순으로 돌리므로, 마운트 때 true로 되돌려야 한다
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;
    setError('');
    setLoading(true);
    try {
      await authApi.verifyPassword(password);
      setPassword('');
      unlock();
    } catch (err) {
      if (!mounted.current) return;
      const msg = err instanceof Error ? err.message : '';
      // 서버가 잠금 안내 문구를 주면 그대로 보여주고, 그 외에는 일반 메시지
      setError(/잠겼|잠시/.test(msg) ? msg : /fetch|network|연결/i.test(msg) ? '서버에 연결할 수 없습니다.' : '비밀번호가 올바르지 않습니다.');
      setPassword('');
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="화면 잠금"
      className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-slate-900"
    >
      <form
        onSubmit={(e) => { void handleUnlock(e); }}
        className="w-[min(360px,90%)] rounded-2xl bg-white p-6 shadow-2xl"
      >
        <h2 className="m-0 text-[17px] font-bold text-slate-900">화면 잠금</h2>
        <p className="mt-1.5 mb-4 text-[13px] text-slate-500">
          {user?.name ? `${user.name}님, ` : ''}잠금을 해제하려면 비밀번호를 입력하세요.
        </p>
        <UITextInput
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
          className="!px-4 !py-3 !rounded-xl !border !border-[#e2e8f0] !bg-[#f8fafc] !text-black"
        />
        {error && <p className="mt-2 mb-0 text-[13px] text-red-600" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={loading || !password}
          className="mt-4 w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white disabled:opacity-60"
        >
          {loading ? '확인 중...' : '잠금 해제'}
        </button>
        <button
          type="button"
          onClick={() => logout()}
          className="mt-2 w-full rounded-full border-none bg-transparent py-2 text-[13px] text-slate-500 underline"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
