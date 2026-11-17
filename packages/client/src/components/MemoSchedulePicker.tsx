import { useId, useState } from 'react';
import { cn } from '../utils/cn';

const pad = (number: number) => String(number).padStart(2, '0');
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const summary = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'full', timeStyle: 'short',
});
const monthLabel = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long' });
const fullDate = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'full' });

function dateKey(date: Date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0')).join('-');
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  isDark: boolean;
};

export default function MemoSchedulePicker({ value, onChange, isDark }: Props) {
  const id = useId();
  const today = new Date();
  const [expanded, setExpanded] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  const [initialTime, setInitialTime] = useState(() => `${pad(today.getHours())}:${pad(today.getMinutes())}`);
  const [month, setMonth] = useState(() => {
    const date = value ? new Date(value) : today;
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [scheduledDay, time] = value.split('T');
  const [hour, minute] = (time || initialTime).split(':');
  const todayKey = dateKey(today);
  const selectedDay = scheduledDay || todayKey;
  const offset = month.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const canGoBack = dateKey(month) > dateKey(new Date(today.getFullYear(), today.getMonth(), 1));
  const selectedDate = value ? new Date(value) : null;
  const pastSelection = selectedDate && selectedDate <= today;
  const validTime = timeDraft !== null && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeDraft);
  const canApplyTime = validTime && new Date(`${selectedDay}T${timeDraft}`) > today;
  const controlStyle = cn(
    'rounded-lg border px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
    isDark ? 'border-slate-700 bg-slate-900 text-slate-100' : 'border-slate-200 bg-white text-slate-800',
  );

  function changeMonth(delta: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1));
  }

  function selectDate(day: Date) {
    const key = dateKey(day);
    onChange(`${key}T${hour}:${minute}`);
  }

  return (
    <div className={cn('min-w-0 w-full rounded-xl border', isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50')}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2">
        <div className="min-w-0 flex-[1_1_10rem]">
          <span className="block text-sm font-semibold">예약 시간</span>
          <span className={cn('block text-xs', isDark ? 'text-slate-300' : 'text-slate-600')}>
            {selectedDate ? summary.format(selectedDate) : '즉시 발송'}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          {value && (
            <button type="button" className="rounded-lg px-2 py-2 text-xs text-inherit hover:bg-slate-500/15"
              onClick={() => {
                onChange('');
                setTimeDraft(null);
                setMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setExpanded(false);
              }}>
              예약 해제
            </button>
          )}
          <button type="button" className={cn(controlStyle, 'whitespace-nowrap text-xs')} aria-controls={id}
            aria-expanded={expanded} onClick={() => {
              if (!expanded && !value) {
                const now = new Date();
                setInitialTime(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
                setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              }
              setTimeDraft(null);
              setExpanded(!expanded);
            }}>
            {expanded ? '닫기' : value ? '변경' : '예약 설정'}
          </button>
        </div>
      </div>
      {expanded && (
        <div id={id} className="border-t border-slate-500/20 px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" aria-label="이전 달" disabled={!canGoBack} onClick={() => changeMonth(-1)}
              className={cn(controlStyle, 'disabled:opacity-35')}>‹</button>
            <span aria-live="polite" className="text-sm font-semibold">{monthLabel.format(month)}</span>
            <button type="button" aria-label="다음 달" onClick={() => changeMonth(1)} className={controlStyle}>›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((day) => <span key={day} className="py-1 text-xs text-slate-500">{day}</span>)}
            {Array.from({ length: offset }, (_, index) => <span key={'empty-' + index} aria-hidden />)}
            {Array.from({ length: days }, (_, index) => {
              const day = new Date(month.getFullYear(), month.getMonth(), index + 1);
              const key = dateKey(day);
              const selected = key === selectedDay;
              return (
                <button key={key} type="button" aria-label={fullDate.format(day)} aria-pressed={selected}
                  aria-current={key === todayKey ? 'date' : undefined}
                  disabled={key < todayKey} onClick={() => selectDate(day)}
                  className={cn('min-h-9 min-w-0 rounded-lg border-none text-sm focus-visible:outline focus-visible:outline-brand disabled:opacity-35',
                    selected ? 'bg-brand-dark font-semibold text-white' : 'bg-transparent text-inherit enabled:hover:bg-slate-500/15',
                    key === todayKey && !selected && 'ring-1 ring-inset ring-brand')}>
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-3 border-t border-slate-500/20 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2" role="group" aria-label="발송 시간">
              <span className="text-sm font-medium">발송 시간</span>
              <button type="button" className={cn(controlStyle, 'inline-flex min-w-0 items-center gap-2 tabular-nums hover:bg-slate-500/10')}
                aria-label="발송 시간 편집" aria-expanded={timeDraft !== null} aria-controls={id + '-time'}
                onClick={() => setTimeDraft(timeDraft === null ? time || initialTime : null)}>
                <span aria-hidden="true" className="text-base leading-none">◷</span>
                {time || initialTime}
              </button>
            </div>
            {timeDraft !== null && (
              <div id={id + '-time'} className={cn('mt-2 rounded-xl border p-3',
                isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-white')}>
                <label className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                  24시간 형식
                  <input
                    type="text"
                    autoFocus
                    aria-label="발송 시간 입력"
                    aria-invalid={timeDraft.length === 5 && !canApplyTime}
                    placeholder="HH:mm"
                    maxLength={5}
                    value={timeDraft}
                    className={cn(controlStyle, 'w-24 text-center tabular-nums')}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setTimeDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setTimeDraft(null);
                      }
                      if (event.key === 'Enter' && canApplyTime) {
                        event.preventDefault();
                        onChange(`${selectedDay}T${timeDraft}`);
                        setTimeDraft(null);
                      }
                    }}
                  />
                </label>
                {!canApplyTime && (
                  <p role="status" className="mb-0 mt-2 text-xs text-red-500">
                    {validTime ? '현재 시각 이후로 설정해 주세요.' : '시간을 24시간 형식으로 입력해 주세요.'}
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" className={controlStyle} onClick={() => setTimeDraft(null)}>닫기</button>
                  <button type="button" disabled={!canApplyTime}
                    className="rounded-lg bg-brand-dark px-3 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    onClick={() => {
                      onChange(`${selectedDay}T${timeDraft}`);
                      setTimeDraft(null);
                    }}>적용</button>
                </div>
              </div>
            )}
          </div>
          {timeDraft === null && pastSelection && <p role="status" className="mb-0 mt-2 text-xs text-red-500">현재 시각 이후로 설정해 주세요.</p>}
        </div>
      )}
    </div>
  );
}
