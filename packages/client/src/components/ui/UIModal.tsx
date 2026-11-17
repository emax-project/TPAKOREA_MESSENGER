import { useThemeStore } from '../../store';
import { cn } from '../../utils/cn';
import UICloseButton from './UICloseButton';

type Props = {
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
  width?: number;
  title?: string;
  overlayPosition?: 'fixed' | 'absolute';
  zIndex?: number;
  /** false면 바깥 클릭·닫기 버튼을 끈다 (초기 비밀번호 강제 변경 등) */
  closable?: boolean;
};

export default function UIModal({
  children,
  footer,
  onClose,
  width = 420,
  title,
  overlayPosition = 'fixed',
  zIndex = 10001,
  closable = true,
}: Props) {
  const isDark = useThemeStore((s) => s.isDark);
  const close = closable ? onClose : undefined;

  return (
    <div
      className={cn(
        'inset-0 flex items-center justify-center bg-black/50 p-2',
        overlayPosition === 'fixed' ? 'fixed' : 'absolute',
      )}
      style={{ zIndex }}
      onClick={close}
    >
      <div
        className={cn(
          'flex w-full min-w-0 max-w-[calc(100%-1rem)] max-h-[80vh] flex-col rounded-xl border',
          isDark
            ? 'border-slate-700 bg-slate-800 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
            : 'border-slate-200 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.15)]',
        )}
        style={{ maxWidth: `min(${width}px, calc(var(--app-max-width) - 2rem))` }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div
            className={cn(
              'flex shrink-0 items-center justify-between border-b px-5 py-4',
              isDark ? 'border-slate-700' : 'border-slate-200',
            )}
          >
            <h3
              className={cn(
                'm-0 text-lg font-semibold',
                isDark ? 'text-slate-100' : 'text-slate-800',
              )}
            >
              {title}
            </h3>
            {close && <UICloseButton onClick={close} />}
          </div>
        )}
        <div className="min-h-0 overflow-auto p-5">{children}</div>
        {footer && (
          <div className={cn('shrink-0 border-t px-5 py-3', isDark ? 'border-slate-700' : 'border-slate-200')}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
