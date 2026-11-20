import { memo, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { MemoItem, OrgUser } from '../../../api';
import UICloseButton from '../../../components/ui/UICloseButton';
import {
  PanelNoDragWrap,
  PanelTitleRow,
  PanelToolbarRow,
  panelTitleRowBg,
  usePanelNoDrag,
} from '../../../components/PanelDragHeader';
import { cn } from '../../../utils/cn';
import { useAuthStore, useThemeStore } from '../../../store';
import { getOrgTheme } from '../../../utils/orgTheme';

export type { MemoItem };

const memoTabs = [
  ['all', '전체쪽지함'], ['inbox', '받은쪽지함'], ['sent', '보낸쪽지함'],
  ['unread', '안읽은쪽지함'], ['favorite', '관심쪽지함'], ['scheduled', '예약쪽지함'],
] as const;
type MemoTab = typeof memoTabs[number][0];
type MemoDirection = 'inbox' | 'sent';

export type MemoDetailActions = {
  onComposeFromMemo: (recipients: OrgUser[], body?: string) => void;
  onChat: (userId: string) => void | Promise<void>;
  onProfile: (user: OrgUser) => void | Promise<void>;
};

type MemoPanelProps = MemoDetailActions & {
  isDark: boolean;
  inbox: MemoItem[];
  sent: MemoItem[];
  panelWrapStyle: (maxWidth: number) => { className: string; style: React.CSSProperties };
  onOpenCompose: () => void;
  onRefresh: () => void;
  onFavorite: (memo: MemoItem) => void | Promise<void>;
  onMarkRead: (memo: MemoItem) => void | Promise<void>;
  onDelete: (memo: MemoItem) => void | Promise<void>;
};

function formatRecipients(memo: MemoItem) {
  return memo.recipients.map((r) => r.user.name).join(', ');
}

function printMemo() {
  if (window.electronAPI?.printMemo) window.electronAPI.printMemo();
  else window.print();
}

function MemoPrintSheet({ memo, bodyFontSize = 14 }: { memo: MemoItem; bodyFontSize?: number }) {
  const date = new Date(memo.createdAt).toLocaleString('ko-KR');
  return createPortal(
    <article className="memo-print-sheet">
      <style>{`
        @media screen { .memo-print-sheet { display: none; } }
        @media print {
          body > :not(.memo-print-sheet) { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; background: white !important; }
          .memo-print-sheet { color: black; overflow-wrap: anywhere; }
        }
      `}</style>
      <h1>{memo.subject}</h1>
      <p>보낸 사람: {memo.sender.name}</p>
      <p>받는 사람: {formatRecipients(memo)}</p>
      <p>{date}</p>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: bodyFontSize }}>{memo.body}</p>
    </article>,
    document.body,
  );
}

function asRecipient(user: MemoItem['sender']): OrgUser {
  return { ...user, email: user.email ?? '' };
}

function forwardText(memo: MemoItem) {
  return [
    `전달: ${memo.subject}`, '',
    `보낸 사람: ${memo.sender.name}`,
    `받는 사람: ${formatRecipients(memo)}`,
    `보낸 시간: ${new Date(memo.createdAt).toLocaleString('ko-KR')}`, '',
    memo.body,
  ].join('\n');
}

function MemoDetail({
  memo,
  tab,
  isDark,
  onBack,
  onDelete,
  onComposeFromMemo,
  onChat,
  onProfile,
}: MemoDetailActions & {
  memo: MemoItem;
  tab: MemoDirection;
  isDark: boolean;
  onBack: () => void;
  onDelete: (memo: MemoItem) => void | Promise<void>;
}) {
  const isInbox = tab === 'inbox';
  const myId = useAuthStore((state) => state.user?.id);
  const [bodyFontSize, setBodyFontSize] = useState(14);
  const sender = { ...memo.sender, email: memo.sender.email ?? '' };
  const replyAllRecipients = [...new Map(
    [memo.sender, ...memo.recipients.map(({ user }) => user)]
      .filter((user) => user.id !== myId)
      .map((user) => [user.id, { ...user, email: user.email ?? '' }]),
  ).values()];
  const date = new Date(memo.createdAt).toLocaleString('ko-KR');
  const fromLabel = isInbox ? memo.sender.name : formatRecipients(memo);
  const metaLabel = isInbox ? '보낸 사람' : '받는 사람';
  const accentTheme = useThemeStore((s) => s.accentTheme);
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PanelTitleRow
        isDark={isDark}
        className={useCustomAccent ? undefined : panelTitleRowBg(isDark)}
        style={useCustomAccent ? { background: orgTheme.headerBg } : undefined}
        left={(
          <button
            type="button"
            onClick={onBack}
            className={cn(
              'border-none bg-transparent p-1 cursor-pointer rounded-md text-sm font-semibold',
              isDark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100',
            )}
          >
            ← 목록
          </button>
        )}
        right={(
          <button
            type="button"
            onClick={() => void onDelete(memo)}
            className={cn(
              'border-none bg-transparent px-2 py-1 cursor-pointer rounded-md text-xs font-semibold',
              isDark ? 'text-red-400 hover:bg-slate-700' : 'text-red-600 hover:bg-red-50',
            )}
          >
            삭제
          </button>
        )}
      />

      <div role="group" aria-label="쪽지 기능" className="flex flex-wrap items-center gap-1 border-b border-slate-500/20 px-2 py-1">
        {[
          ...(isInbox ? [
            { label: '대화하기', action: () => void onChat(sender.id) },
            { label: '회신', action: () => onComposeFromMemo([sender]) },
            { label: '전체회신', action: () => onComposeFromMemo(replyAllRecipients) },
            { label: '프로필', action: () => void onProfile(sender) },
          ] : []),
          { label: '전달', action: () => onComposeFromMemo([], forwardText(memo)) },
          { label: '인쇄', action: printMemo },
        ].map(({ label, action }) => (
          <button key={label} type="button" onClick={action} className={cn(
            'rounded-md border-none bg-transparent px-2 py-1 text-xs font-medium cursor-pointer',
            isDark ? 'text-slate-200 hover:bg-slate-700' : 'text-slate-700 hover:bg-slate-100',
          )}>
            {label}
          </button>
        ))}
        <select aria-label="글자 크기" value={bodyFontSize} onChange={(event) => setBodyFontSize(Number(event.target.value))}
          className={cn('rounded-md border border-slate-500/30 px-1 py-1 text-xs', isDark ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-700')}>
          <option value={12}>작은 글자</option>
          <option value={14}>보통 글자</option>
          <option value={18}>큰 글자</option>
          <option value={22}>아주 큰 글자</option>
        </select>
      </div>
      <MemoPrintSheet memo={memo} bodyFontSize={bodyFontSize} />
      <div className="flex-1 min-h-0 overflow-auto px-5 py-4">
        <h4 className={cn('m-0 mb-3 text-lg font-bold break-words', isDark ? 'text-white' : 'text-slate-900')}>
          {memo.subject}
        </h4>
        <div className={cn('mb-4 space-y-1 text-sm', isDark ? 'text-slate-400' : 'text-slate-500')}>
          <div><span className="font-semibold">{metaLabel}: </span>{fromLabel}</div>
          <div>{date}</div>
        </div>
        <div
          style={{ fontSize: bodyFontSize }}
          className={cn(
            'whitespace-pre-wrap break-words rounded-xl border px-4 py-3 text-sm leading-relaxed',
            isDark ? 'border-slate-700 bg-slate-900 text-slate-200' : 'border-slate-200 bg-white text-slate-800',
          )}
        >
          {memo.body}
        </div>
        {tab === 'sent' && (
          <div className={cn('mt-4 text-xs', isDark ? 'text-slate-500' : 'text-slate-400')}>
            {memo.recipients.map((r) => (
              <span key={r.id} className="mr-3">
                {r.user.name}{r.readAt ? ' (읽음)' : ' (안 읽음)'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function matchesMemoSearch(memo: MemoItem, tab: MemoDirection, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const people =
    tab === 'inbox'
      ? memo.sender.name
      : memo.recipients.map((r) => r.user.name).join(' ');
  return (
    memo.subject.toLowerCase().includes(q) ||
    memo.body.toLowerCase().includes(q) ||
    people.toLowerCase().includes(q)
  );
}

function MemoPanel({
  isDark,
  inbox,
  sent,
  panelWrapStyle,
  onOpenCompose,
  onRefresh,
  onFavorite,
  onComposeFromMemo,
  onChat,
  onProfile,
  onMarkRead,
  onDelete,
}: MemoPanelProps) {
  const wrap = panelWrapStyle(820);
  const accentTheme = useThemeStore((s) => s.accentTheme);
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';
  const { noDragClass, noDragStyle } = usePanelNoDrag();
  const myId = useAuthStore((state) => state.user?.id);
  const [tab, setTab] = useState<MemoTab>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const direction = (memo: MemoItem): MemoDirection => memo.sender.id === myId ? 'sent' : 'inbox';
  const delivered = useMemo(() => [...inbox, ...sent.filter((memo) => !memo.scheduledAt)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [inbox, sent]);
  const lists = {
    all: delivered,
    inbox,
    sent: sent.filter((memo) => !memo.scheduledAt),
    unread: inbox.filter((memo) => !memo.readAt),
    favorite: delivered.filter((memo) => memo.favorite),
    scheduled: sent.filter((memo) => memo.scheduledAt),
  };
  const list = lists[tab];
  const filteredList = list.filter((memo) => matchesMemoSearch(memo, direction(memo), searchQuery));
  const selectedMemo = filteredList.find((memo) => memo.id === selectedId);
  const detailMemo = detailOpen ? [...inbox, ...sent].find((memo) => memo.id === selectedId) : undefined;
  const directTarget = selectedMemo && (direction(selectedMemo) === 'inbox' ? selectedMemo.sender : selectedMemo.recipients[0]?.user);
  const directEnabled = !!directTarget && !selectedMemo?.scheduledAt && selectedMemo?.recipients.length === 1;

  const handleOpen = (memo: MemoItem) => {
    setSelectedId(memo.id);
    setDetailOpen(true);
    if (direction(memo) === 'inbox' && !memo.readAt) void onMarkRead(memo);
  };

  if (detailMemo) {
    return (
      <div className={wrap.className} style={wrap.style}>
        <MemoDetail
          key={detailMemo.id}
          memo={detailMemo}
          onComposeFromMemo={onComposeFromMemo}
          onChat={onChat}
          onProfile={onProfile}
          tab={direction(detailMemo)}
          isDark={isDark}
          onBack={() => setDetailOpen(false)}
          onDelete={async (memo) => {
            await onDelete(memo);
            setSelectedId(null);
            setDetailOpen(false);
          }}
        />
      </div>
    );
  }

  const emptyMessage = (() => {
    if (list.length === 0) {
      return '이 쪽지함에 쪽지가 없습니다';
    }
    if (filteredList.length === 0) return '검색 결과가 없습니다';
    return null;
  })();

  return (
    <div className={wrap.className} style={wrap.style}>
      <PanelTitleRow
        isDark={isDark}
        title="쪽지"
        className={useCustomAccent ? undefined : panelTitleRowBg(isDark)}
        style={useCustomAccent ? { background: orgTheme.headerBg } : undefined}
      />

      <PanelToolbarRow isDark={isDark}>
        <PanelNoDragWrap className="relative shrink-0">
          <select
            aria-label="쪽지함 선택"
            value={tab}
            onChange={(event) => {
              setTab(event.target.value as MemoTab);
              setSelectedId(null);
            }}
            className={cn(
              'appearance-none cursor-pointer rounded-lg border py-1.5 pl-2.5 pr-7 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
              isDark ? 'border-slate-600 bg-slate-800 text-slate-100 [color-scheme:dark]' : 'border-slate-200 bg-white text-slate-800',
            )}
          >
            {memoTabs.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-500">▾</span>
        </PanelNoDragWrap>
        <div className={cn(noDragClass, 'relative flex-1 min-w-0')} style={noDragStyle}>
          <span
            className={cn(
              'pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2',
              isDark ? 'text-slate-400' : 'text-slate-400',
            )}
            aria-hidden
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            placeholder="제목, 내용, 이름 검색"
            aria-label="쪽지 검색"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              'w-full rounded-[6px] border py-1.5 pl-8 pr-2.5 text-[13px] outline-none',
              isDark ? 'border-slate-600 bg-slate-700 text-slate-200 placeholder:text-slate-400' : 'border-slate-200 bg-slate-100 text-slate-900 placeholder:text-slate-400',
            )}
          />
        </div>
        {searchQuery.trim().length > 0 && (
          <PanelNoDragWrap>
            <UICloseButton
              size="sm"
              variant="subtle"
              onClick={() => setSearchQuery('')}
              aria-label="검색어 지우기"
              title="검색어 지우기"
            />
          </PanelNoDragWrap>
        )}
      </PanelToolbarRow>

      <div role="group" aria-label="쪽지함 기능" style={noDragStyle}
        className={cn(noDragClass, 'flex flex-wrap items-center gap-1 px-3 py-2 border-b', isDark ? 'border-slate-700' : 'border-slate-200')}>
        <button type="button" onClick={onOpenCompose} className="rounded-lg border-none bg-brand-dark px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand">
          쪽지 보내기
        </button>
        {[
          { label: '쪽지 갱신', action: onRefresh, enabled: true },
          { label: '대화하기', action: () => directTarget && void onChat(directTarget.id), enabled: directEnabled },
          { label: '회신', action: () => directTarget && onComposeFromMemo([asRecipient(directTarget)]), enabled: directEnabled },
          { label: '전체회신', action: () => directTarget && onComposeFromMemo([asRecipient(directTarget)]), enabled: directEnabled },
          { label: '전달', action: () => selectedMemo && onComposeFromMemo([], forwardText(selectedMemo)), enabled: !!selectedMemo },
          { label: '삭제', action: () => selectedMemo && void onDelete(selectedMemo), enabled: !!selectedMemo },
          { label: '인쇄', action: printMemo, enabled: !!selectedMemo },
        ].map(({ label, action, enabled }) => (
          <button key={label} type="button" disabled={!enabled} onClick={action}
            className={cn('rounded-lg border-none bg-transparent px-2 py-1.5 text-xs font-medium text-inherit enabled:hover:bg-slate-500/15 disabled:cursor-default disabled:opacity-40',
              label === '삭제' && enabled && (isDark ? 'text-red-300' : 'text-red-700'))}>
            {label}
          </button>
        ))}
      </div>
      {selectedMemo && <MemoPrintSheet memo={selectedMemo} />}
      <div className="flex-1 min-h-0 overflow-auto">
        {emptyMessage ? (
          <div className={cn('p-8 text-center text-sm', isDark ? 'text-[#a7adb4]' : 'text-[#5e6470]')}>
            {emptyMessage}
          </div>
        ) : (
          <ul className="list-none m-0 grid gap-2 p-3">
            {filteredList.map((memo) => {
              const selected = selectedId === memo.id;
              const unread = direction(memo) === 'inbox' && !memo.readAt;
              const subtitle = direction(memo) === 'inbox' ? memo.sender.name : formatRecipients(memo);
              return (
                <li key={memo.id} className={cn(
                  'rounded-xl border transition-colors',
                  selected
                    ? (isDark ? 'border-brand-light/60 bg-brand-light/10' : 'border-brand-dark/40 bg-brand-dark/5')
                    : (isDark ? 'border-slate-700 bg-slate-900/40 hover:border-slate-500' : 'border-slate-200 bg-white hover:border-slate-300'),
                )}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedId(memo.id)}
                      onDoubleClick={() => handleOpen(memo)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); handleOpen(memo); }
                      }}
                      className={cn(
                        'flex-1 min-w-0 rounded-l-xl px-3 py-3 border-none text-left cursor-pointer flex items-start gap-2 bg-transparent',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
                      )}
                    >
                      {unread && (
                        <span
                          className={cn('mt-2 w-1.5 h-1.5 rounded-full shrink-0', !useCustomAccent && 'bg-brand')}
                          style={useCustomAccent ? { background: orgTheme.accent } : undefined}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className={cn('text-sm truncate mb-1', unread ? 'font-bold' : 'font-semibold', isDark ? 'text-slate-100' : 'text-slate-900')}>
                          {memo.subject}
                        </div>
                        <div className={cn('text-xs truncate mb-1', isDark ? 'text-slate-400' : 'text-slate-500')}>
                          {subtitle}
                        </div>
                        <div className={cn('text-[11px] truncate', isDark ? 'text-slate-500' : 'text-slate-400')}>
                          {memo.body}
                        </div>
                        <div className={cn('text-[11px] mt-1', isDark ? 'text-slate-500' : 'text-slate-400')}>
                          {new Date(memo.scheduledAt ?? memo.createdAt).toLocaleString('ko-KR')}
                        </div>
                      </div>
                    </button>
                    <button type="button" aria-label={memo.favorite ? '관심 쪽지 해제' : '관심 쪽지 등록'}
                      aria-pressed={!!memo.favorite} onClick={() => void onFavorite(memo)}
                      className={cn('rounded-lg px-2 text-lg leading-8 hover:bg-slate-500/15', memo.favorite ? 'text-amber-500' : 'text-slate-500')} title={memo.favorite ? '관심 쪽지 해제' : '관심 쪽지 등록'}>{memo.favorite ? '★' : '☆'}</button>
                    <button type="button" onClick={() => handleOpen(memo)} aria-label={`${memo.subject} 열기`}
                      className={cn('mr-2 rounded-lg px-2 py-1.5 text-xs font-medium', isDark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100')}>열기</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default memo(MemoPanel);
