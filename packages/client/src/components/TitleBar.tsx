/**
 * Electron 창용 타이틀/드래그 영역 (Windows·Linux).
 * Mac은 트래픽 라이트 줄에 도구 버튼을 올리는 용도로도 사용.
 */
import { cn } from '../utils/cn';
import {
  electronDragStyle,
  electronNoDragStyle,
  MAC_TOP_INSET,
  MAC_TRAFFIC_LIGHTS_WIDTH,
} from '../utils/electronChrome';

export function WindowChromeTools({
  isDark = false,
  showPin = false,
  pinned = false,
  onTogglePin,
  showSettings = false,
  onSettings,
  showDivider = false,
}: {
  isDark?: boolean;
  showPin?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  showSettings?: boolean;
  onSettings?: () => void;
  showDivider?: boolean;
}) {
  if (!showPin && !showSettings) return null;

  const toolBtn = cn(
    'electron-no-drag h-7 w-7 shrink-0 border-none rounded-md p-0 flex items-center justify-center cursor-pointer',
    isDark ? 'bg-transparent text-slate-200 hover:bg-slate-600' : 'bg-transparent text-slate-700 hover:bg-slate-100',
  );

  return (
    <div className="electron-no-drag flex items-center gap-0.5 self-center" style={electronNoDragStyle}>
      {showPin && (
        <button type="button" className={toolBtn} onClick={onTogglePin} aria-label="화면 고정" title={pinned ? '고정 해제' : '이 위치에 고정'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
        </button>
      )}
      {showSettings && (
        <button type="button" className={toolBtn} onClick={onSettings} aria-label="설정" title="설정">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.7.1 1.41.1 2.11 0H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
          </svg>
        </button>
      )}
      {showDivider && (
        <span
          className={cn('mx-1 h-4 w-px shrink-0', isDark ? 'bg-slate-500' : 'bg-slate-300')}
          aria-hidden
        />
      )}
    </div>
  );
}

export default function TitleBar({
  title,
  isDark = false,
  showMaximize = true,
  showPin = false,
  pinned = false,
  onTogglePin,
  showSettings = false,
  onSettings,
  showLogo = false,
  showBrand = true,
  className,
}: {
  title: string;
  isDark?: boolean;
  showMaximize?: boolean;
  showPin?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  showSettings?: boolean;
  onSettings?: () => void;
  showLogo?: boolean;
  showBrand?: boolean;
  className?: string;
}) {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const platform = api?.platform ?? 'darwin';
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  const barClass = cn(
    'relative shrink-0 h-[38px] min-h-[38px] flex items-stretch border-b select-none',
    isDark ? 'bg-slate-800 border-slate-600' : 'bg-white border-slate-200',
    className,
  );

  const titleClass = cn(
    'brand-title text-[13px] font-semibold pointer-events-none truncate',
    isDark ? 'text-slate-200' : 'text-slate-900',
  );

  const extras = (
    <WindowChromeTools
      isDark={isDark}
      showPin={showPin}
      pinned={pinned}
      onTogglePin={onTogglePin}
      showSettings={showSettings}
      onSettings={onSettings}
      showDivider
    />
  );

  const brand = showBrand ? (
    <span className="flex min-w-0 items-center gap-1.5 self-center">
      {showLogo && (
        <img src={`${import.meta.env.BASE_URL}tpa-icon.png`} alt="" width={16} height={16} className="shrink-0 object-contain" draggable={false} />
      )}
      <span className={cn(titleClass, 'max-w-full')}>{title}</span>
    </span>
  ) : (
    <span className="flex-1" />
  );

  if (isMac) {
    return (
      <div className={cn(barClass, 'z-40 pr-2 electron-drag')} style={electronDragStyle}>
        <div
          className="electron-no-drag h-full shrink-0"
          style={{ ...electronNoDragStyle, width: MAC_TRAFFIC_LIGHTS_WIDTH }}
          aria-hidden
        />
        <div className="flex flex-1 items-center justify-center min-w-0">
          {showBrand ? brand : null}
        </div>
        {extras}
      </div>
    );
  }

  if (isWin) {
    return (
      <div className={cn(barClass, 'pl-3 pr-[148px] gap-1 electron-drag')} style={electronDragStyle}>
        {brand}
        <div className="flex-1" />
        {extras}
      </div>
    );
  }

  const winBtnClass = cn(
    'w-9 h-7 border-none cursor-pointer p-0 flex items-center justify-center shadow-none outline-none appearance-none transition-[background,color] duration-150',
    isDark ? 'bg-slate-700 text-slate-200 hover:bg-slate-600' : 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  );
  const closeBtnClass = cn(winBtnClass, 'hover:!bg-[#e81123] hover:!text-white');

  return (
    <div className={cn(barClass, 'px-3 gap-2 electron-drag')} style={electronDragStyle}>
      {brand}
      <div className="flex-1" />
      {extras}
      <div className="electron-no-drag flex items-center gap-0 self-center rounded-md overflow-hidden" style={electronNoDragStyle}>
        <button type="button" className={winBtnClass} onClick={() => api?.windowMinimize?.()} aria-label="최소화">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 5h8" />
          </svg>
        </button>
        {showMaximize && (
          <button type="button" className={winBtnClass} onClick={() => api?.windowMaximize?.()} aria-label="최대화">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" />
            </svg>
          </button>
        )}
        <button type="button" className={closeBtnClass} onClick={() => api?.windowClose?.()} aria-label="닫기">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l8 8M9 1L1 9" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** 맥 트래픽 라이트 줄 오른쪽 — 핀/설정 (두 번째 타이틀바를 만들지 않음) */
export function MacInsetChromeTools(props: {
  isDark?: boolean;
  showPin?: boolean;
  pinned?: boolean;
  onTogglePin?: () => void;
  showSettings?: boolean;
  onSettings?: () => void;
}) {
  return (
    <div
      className="electron-no-drag pointer-events-auto fixed right-2 z-40 flex items-center"
      style={{ ...electronNoDragStyle, top: 0, height: MAC_TOP_INSET }}
    >
      <WindowChromeTools {...props} />
    </div>
  );
}
