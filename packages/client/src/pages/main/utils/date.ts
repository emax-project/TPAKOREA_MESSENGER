export function toLocalInputValue(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function dateKeyWithTime(dateKey: string, time: string): string {
  return dateKey ? `${dateKey}T${time}` : '';
}

/** "오전 9:00" — locale 기본 AM/PM 표기에 기대지 않고 직접 포맷(플랫폼마다 ko-KR 12시간제 기본값이 다를 수 있음) */
export function formatAmPmTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = d.getHours();
  const am = h < 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${am ? '오전' : '오후'} ${h12}:${pad(d.getMinutes())}`;
}

/** Format event time range as "오전 9:00 – 오후 2:30" */
export function formatEventTime(startAt: string, endAt: string): string {
  return `${formatAmPmTime(new Date(startAt))} – ${formatAmPmTime(new Date(endAt))}`;
}

/**
 * 대화목록 마지막 메시지 시각 표기: 오늘이면 시간("오전 9:07"), 그 이전이면 날짜
 * ("10월 13일", 해가 다르면 "2025년 10월 13일")로 표기한다.
 */
export function formatRoomListTimestamp(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (isToday) return formatAmPmTime(d);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    'ko-KR',
    sameYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' },
  );
}

export function normalizeTimeRange(dateKey: string, start?: string, end?: string) {
  const s = start ? new Date(start) : null;
  const e = end ? new Date(end) : null;
  const baseStart = dateKeyWithTime(dateKey, '09:00');
  const baseEnd = dateKeyWithTime(dateKey, '10:00');
  if (!s || Number.isNaN(s.getTime()) || !e || Number.isNaN(e.getTime()) || e.getTime() <= s.getTime()) {
    return { startAt: baseStart, endAt: baseEnd };
  }
  return {
    startAt: dateKeyWithTime(dateKey, toLocalInputValue(s.toISOString()).slice(11)),
    endAt: dateKeyWithTime(dateKey, toLocalInputValue(e.toISOString()).slice(11)),
  };
}
