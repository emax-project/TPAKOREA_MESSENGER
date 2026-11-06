import { memo, useState } from 'react';
import type { CSSProperties, Dispatch, ReactNode, SetStateAction } from 'react';
import { electronNoDragClass } from '../../../components/MacElectronDragBar';
import {
  electronDragStyle,
  electronNoDragStyle,
  isMacElectron,
} from '../../../utils/electronChrome';
import { openGroupware } from '../../../utils/groupware';

/** 메일 버튼: 관리자가 지정한 주소가 있으면 그곳을, 없으면 기존처럼 그룹웨어를 연다. */
function openMailSite(url?: string) {
  const target = url?.trim();
  if (!target) {
    openGroupware();
    return;
  }
  const openExternal = window.electronAPI?.openExternal;
  if (openExternal) void openExternal(target);
  else window.open(target, '_blank', 'noopener,noreferrer');
}
import { cn } from '../../../utils/cn';
import { useAuthStore, useThemeStore } from '../../../store';
import { getBaseUrl, type UserAffiliation } from '../../../api';
import { getOrgTheme } from '../../../utils/orgTheme';
import ProfileMenu from './ProfileMenu';

type ActivePanel = 'none' | 'notifications' | 'memo' | 'rooms' | 'schedule' | 'settings' | 'notepad';

type StatusOption = { id: string; label: string };

type LeftSidebarProps = {
  isDark: boolean;
  activePanel: ActivePanel;
  setActivePanel: Dispatch<SetStateAction<ActivePanel>>;
  unreadNotificationCount: number;
  unreadMemoCount: number;
  totalUnreadCount: number;
  onNavigateHome: () => void;
  statusOptions?: StatusOption[];
  currentStatus?: string;
  renderStatusIcon?: (status: string, size?: number) => ReactNode;
  onSetStatus?: (status: string) => void;
  affiliations?: UserAffiliation[];
  onSwitchAffiliation?: (departmentId: string) => void;
  currentDeptLabel?: string;
  onLock?: () => void;
  onLogout: () => void;
  onQuit?: () => void;
  externalSiteUrl?: string;
  onOpenExternalSite?: () => void;
  /** 관리자가 지정한 메일 주소. 비어 있으면 메일 버튼은 그룹웨어를 연다. */
  mailSiteUrl?: string;
};

/** 조직도 메뉴 아이콘. 회사 CI 대신 조직 계층 구조를 직관적으로 드러내는 트리 모양을 쓴다. */
function OrgTreeIcon({ isDark, active = false }: { isDark: boolean; active?: boolean }) {
  const color = active ? (isDark ? 'var(--color-brand-light)' : '#0F172A') : (isDark ? '#e2e8f0' : '#334155');
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="3" width="6" height="5" rx="1.2" />
      <rect x="2" y="16" width="6" height="5" rx="1.2" />
      <rect x="16" y="16" width="6" height="5" rx="1.2" />
      <path d="M12 8v4M12 12H5v4M12 12h7v4" />
    </svg>
  );
}

/** 메모장 아이콘. 접힌 종이 모양 + 글줄 (쪽지 아이콘과 헷갈리지 않게 별도 형태) */
function NotepadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function Badge({ children }: { children: string }) {
  const isDark = useThemeStore((s) => s.isDark);
  const accentTheme = useThemeStore((s) => s.accentTheme);
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';
  return (
    <span
      className={cn(
        'absolute top-0.5 right-0.5 min-w-4 h-4 px-0.5 rounded-full text-white font-bold flex items-center justify-center text-[10px]',
        !useCustomAccent && 'bg-brand',
      )}
      style={useCustomAccent ? { background: orgTheme.accent } : undefined}
    >
      {children}
    </span>
  );
}

function LeftSidebar({
  isDark,
  activePanel,
  setActivePanel,
  unreadNotificationCount,
  unreadMemoCount,
  totalUnreadCount,
  onNavigateHome,
  statusOptions = [],
  currentStatus = '온라인',
  renderStatusIcon,
  onSetStatus,
  affiliations = [],
  onSwitchAffiliation,
  currentDeptLabel,
  onLock,
  onLogout,
  onQuit,
  externalSiteUrl,
  onOpenExternalSite,
  mailSiteUrl,
}: LeftSidebarProps) {
  const macDrag = isMacElectron();
  const user = useAuthStore((s) => s.user);
  const [menuOpen, setMenuOpen] = useState(false);

  const togglePanel = (panel: Exclude<ActivePanel, 'none'>) => {
    setActivePanel((prev) => (prev === panel ? 'none' : panel));
  };

  const btnStyle = (active: boolean): CSSProperties => ({
    width: 40,
    height: 40,
    padding: 0,
    border: 'none',
    borderRadius: 10,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: active ? (isDark ? '#334155' : '#f1f5f9') : 'transparent',
    // 좌측 사이드바는 기존 디자인을 그대로 유지하되, 선택된 아이콘만 진한 검정으로
    // 표현해 선택 상태를 더 명확히 드러낸다(다크 모드는 대비를 위해 기존 밝은
    // 브랜드색 유지).
    color: active ? (isDark ? 'var(--color-brand-light)' : '#0F172A') : (isDark ? '#94a3b8' : '#64748b'),
  });

  const avatarSrc = user?.avatarUrl
    ? `${getBaseUrl()}${user.avatarUrl}`
    : `${import.meta.env.BASE_URL}emax-logo.png`;

  return (
    <aside
      className={cn(
        'relative shrink-0 flex flex-col items-center py-2 gap-1 border-r',
        macDrag ? 'w-[78px]' : 'w-[56px]',
        macDrag && 'pt-1',
        macDrag && 'electron-drag',
        isDark ? 'bg-slate-800 border-r-slate-600' : 'bg-white border-r-slate-200',
      )}
      style={macDrag ? electronDragStyle : undefined}
      aria-label="메인 메뉴"
    >
      <button
        type="button"
        onClick={onNavigateHome}
        className={cn(
          electronNoDragClass,
          'flex items-center justify-center w-10 h-10 border-none bg-transparent p-0 m-0 cursor-pointer rounded-[10px]',
          activePanel === 'none' && (isDark ? 'bg-slate-700 ring-1 ring-brand/40' : 'bg-slate-100 ring-1 ring-brand/30'),
        )}
        style={macDrag ? electronNoDragStyle : undefined}
        title="조직도"
      >
        <OrgTreeIcon isDark={isDark} active={activePanel === 'none'} />
      </button>

      <div className={cn('w-8 h-px my-1', isDark ? 'bg-slate-600' : 'bg-slate-200')} />

      <nav className="flex flex-col items-center gap-1">
        <button
          type="button"
          style={{ ...btnStyle(false), ...(macDrag ? electronNoDragStyle : {}) }}
          onClick={() => openGroupware()}
          title="그룹웨어 바로가기"
          className={electronNoDragClass}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>

        <button type="button" style={{ ...btnStyle(activePanel === 'rooms'), ...(macDrag ? electronNoDragStyle : {}) }} onClick={() => togglePanel('rooms')} title="대화" className={cn(electronNoDragClass, 'relative')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {totalUnreadCount > 0 && (
            <Badge>{totalUnreadCount > 9 ? '9+' : String(totalUnreadCount)}</Badge>
          )}
        </button>

        <button
          type="button"
          style={{ ...btnStyle(false), ...(macDrag ? electronNoDragStyle : {}) }}
          onClick={() => openMailSite(mailSiteUrl)}
          title={mailSiteUrl ? `메일\n${mailSiteUrl}` : '메일'}
          className={electronNoDragClass}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
        </button>

        <button type="button" style={{ ...btnStyle(activePanel === 'memo'), ...(macDrag ? electronNoDragStyle : {}) }} onClick={() => togglePanel('memo')} title="쪽지" className={cn(electronNoDragClass, 'relative')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
            {/* 쪽지를 꼬아 묶은 모양 (지정 아이콘 원본 형태 그대로, 박스X는 더 두껍고 위아래 폭을 넓게) */}
            <g strokeWidth={2}>
              <path d="M6,1 L18,1 L18,12.5 Z" />
              <path d="M6,1 L18,1 L6,12.5 Z" />
            </g>
            <g strokeWidth={1.6}>
              <path d="M6,12.5 L1,18 L5,22 L12,18.2 Z" />
              <path d="M18,12.5 L12,18.2 L19,22 L23,18 Z" />
            </g>
          </svg>
          {unreadMemoCount > 0 && (
            <Badge>{unreadMemoCount > 9 ? '9+' : String(unreadMemoCount)}</Badge>
          )}
        </button>

        <button
          type="button"
          style={{ ...btnStyle(activePanel === 'notifications'), ...(macDrag ? electronNoDragStyle : {}) }}
          onClick={() => togglePanel('notifications')}
          title="알림"
          className={cn(electronNoDragClass, 'relative')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadNotificationCount > 0 && (
            <Badge>{unreadNotificationCount > 9 ? '9+' : String(unreadNotificationCount)}</Badge>
          )}
        </button>

        <button type="button" style={{ ...btnStyle(activePanel === 'schedule'), ...(macDrag ? electronNoDragStyle : {}) }} onClick={() => togglePanel('schedule')} title="일정" className={electronNoDragClass}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>

        <button type="button" style={{ ...btnStyle(activePanel === 'notepad'), ...(macDrag ? electronNoDragStyle : {}) }} onClick={() => togglePanel('notepad')} title="메모장" className={electronNoDragClass}>
          <NotepadIcon />
        </button>

        {onOpenExternalSite && (
          <button
            type="button"
            style={{ ...btnStyle(false), ...(macDrag ? electronNoDragStyle : {}) }}
            onClick={onOpenExternalSite}
            title={externalSiteUrl ? `링크 접속\n${externalSiteUrl}` : '링크 접속'}
            className={electronNoDragClass}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          </button>
        )}
      </nav>

      <div className="mt-auto flex flex-col items-center pb-1">
        <div className="relative">
          <button
            type="button"
            title={user?.name || '내 프로필'}
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(electronNoDragClass, 'relative h-10 w-10 overflow-visible rounded-full border-none p-0 cursor-pointer')}
            style={macDrag ? electronNoDragStyle : undefined}
          >
            <img src={avatarSrc} alt="" className="h-10 w-10 rounded-full object-cover" />
            {renderStatusIcon && (
              <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-[1px] shadow">
                {renderStatusIcon(currentStatus || '온라인', 12)}
              </span>
            )}
          </button>
          {menuOpen && (
            <ProfileMenu
              isDark={isDark}
              name={user?.name || '내 프로필'}
              avatarSrc={avatarSrc}
              currentStatus={currentStatus || '온라인'}
              statusOptions={statusOptions}
              renderStatusIcon={renderStatusIcon ?? (() => null)}
              onSetStatus={(s) => onSetStatus?.(s)}
              affiliations={affiliations}
              onSwitchAffiliation={onSwitchAffiliation}
              currentDeptLabel={currentDeptLabel}
              onLock={onLock}
              onLogout={onLogout}
              onQuit={onQuit}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      </div>
    </aside>
  );
}

export default memo(LeftSidebar);
