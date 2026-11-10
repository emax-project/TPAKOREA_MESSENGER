import type { PendingSend } from '../hooks/useMessageSender';
import { cn } from '../../../utils/cn';

type Props = {
  items: PendingSend[];
  isDark: boolean;
  onRetry: (key: string) => void;
  onDismiss: (key: string) => void;
};

/** 아직 서버 확인을 못 받았거나 전송에 실패한 메시지를 입력창 위에 보여준다. */
export default function PendingSendBar({ items, isDark, onRetry, onDismiss }: Props) {
  const visible = items.filter((i) => i.status === 'failed' || i.slow);
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 px-3 pt-2" role="status" aria-live="polite">
      {visible.map((item) => (
        <div
          key={item.key}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs',
            item.status === 'failed'
              ? isDark ? 'bg-red-950/60 text-red-200' : 'bg-red-50 text-red-700'
              : isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-100 text-slate-600',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{item.preview}</div>
            <div className="opacity-80">
              {item.status === 'failed' ? `전송 실패 — ${item.error ?? ''}` : '전송 확인 중… 연결되면 자동으로 다시 보냅니다'}
            </div>
          </div>
          {item.status === 'failed' && !item.permanent && (
            <button type="button" onClick={() => onRetry(item.key)} className="shrink-0 cursor-pointer rounded-md border-none bg-black/80 px-2 py-1 text-[11px] font-semibold text-white">
              다시 보내기
            </button>
          )}
          {item.status === 'failed' && (
            <button type="button" onClick={() => onDismiss(item.key)} aria-label="전송 실패 메시지 지우기" className="shrink-0 cursor-pointer border-none bg-transparent px-1 text-[13px] opacity-70">
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
