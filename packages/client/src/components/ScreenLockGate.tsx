import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { appSettingsApi } from '../api';
import {
  isIdleExpired,
  readLastActivity,
  useScreenLockStore,
  writeLastActivity,
} from '../utils/screenLock';
import AppLockOverlay from './AppLockOverlay';

const CHECK_INTERVAL_MS = 10_000;
const ACTIVITY_WRITE_THROTTLE_MS = 2_000;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'click'] as const;

/**
 * 로그인한 모든 화면(메인·채팅·칸반 창)을 감싸는 화면 잠금 게이트.
 * - 관리자가 정한 시간 동안 입력이 없으면 자동으로 잠근다(어느 창에서든 입력이 있으면 활동으로 본다).
 * - OS 화면 잠금/절전 진입 시에도 잠근다(Electron).
 * - 잠긴 동안에는 앱 화면을 inert 처리해 키보드 포커스도 뒤쪽으로 가지 못하게 한다.
 */
export default function ScreenLockGate() {
  const locked = useScreenLockStore((s) => s.locked);
  const lock = useScreenLockStore((s) => s.lock);

  const { data: policy } = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: appSettingsApi.getSecurity,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
  const minutes = policy?.screenLockMinutes ?? 0;

  // 활동 기록 — 잠겨 있는 동안에는 갱신하지 않는다
  useEffect(() => {
    if (locked) return;
    if (readLastActivity() == null) writeLastActivity(Date.now());
    let lastWrite = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return;
      lastWrite = now;
      writeLastActivity(now);
    };
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true, capture: true }));
    return () => ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, onActivity, { capture: true }));
  }, [locked]);

  // 주기적으로 유휴 시간 확인
  useEffect(() => {
    if (locked || minutes <= 0) return;
    const check = () => {
      const last = readLastActivity();
      if (last != null && isIdleExpired(last, Date.now(), minutes)) lock();
    };
    check(); // 절전 복귀·재실행 직후에 바로 판단
    const id = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [locked, minutes, lock]);

  // OS 화면 잠금·절전 시 앱도 잠근다
  useEffect(() => {
    return window.electronAPI?.onSystemLock?.(() => lock());
  }, [lock]);

  // 메인 프로세스에 알림: 잠금 상태(잠긴 동안 알림에 대화 내용이 보이지 않게), 대화창 수 제한 정책
  useEffect(() => {
    window.electronAPI?.setScreenLocked?.(locked);
  }, [locked]);
  const maxChatWindows = policy?.maxChatWindows;
  useEffect(() => {
    if (typeof maxChatWindows === 'number') window.electronAPI?.setMaxChatWindows?.(maxChatWindows);
  }, [maxChatWindows]);

  // 잠긴 동안 앱 본문을 inert 처리(포커스·클릭·보조기술 접근 차단)
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root || !locked) return;
    root.setAttribute('inert', '');
    return () => root.removeAttribute('inert');
  }, [locked]);

  if (!locked) return null;
  return createPortal(<AppLockOverlay />, document.body);
}
