import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import type { Message, ReactionGroup, Room } from '../../../api';
import EventCard from '../../../components/EventCard';
import PollCard from '../../../components/PollCard';
import FileMessage from '../../../components/FileMessage';
import LinkPreview, { extractFirstUrl } from '../../../components/LinkPreview';
import EmojiPicker from '../../../components/EmojiPicker';
import { cn } from '../../../utils/cn';
import { formatDateLabel, getDateKey, isSystemMessage, renderMessageContent, HIDE_CONTEXT_ATTACH } from '../utils';
import { getOrgTheme, type OrgThemeId } from '../../../utils/orgTheme';

export type ChatBubbleListHandle = {
  /** 맨 아래로 스크롤 (아래로 가기 버튼에서 사용) */
  scrollToBottom: () => void;
};

type ChatBubbleListProps = {
  /** 오래된 → 최신 순. 그대로 Virtuoso의 data로 쓰인다. */
  displayMessages: Message[];
  firstUnreadMessageId: string | null;
  isDark: boolean;
  /** 내 메시지 말풍선 배경색 테마 (라이트 모드에서만 적용) */
  accentTheme?: OrgThemeId;
  myId?: string;
  room?: Room;
  hoveredMsg: string | null;
  highlightedMsgId: string | null;
  emojiPickerMsg: string | null;
  setHoveredMsg: Dispatch<SetStateAction<string | null>>;
  setHighlightedMsgId: Dispatch<SetStateAction<string | null>>;
  setContextMenu: Dispatch<SetStateAction<{ x: number; y: number; message: Message } | null>>;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  setReplyTo: Dispatch<SetStateAction<Message | null>>;
  setEmojiPickerMsg: Dispatch<SetStateAction<string | null>>;
  handleReaction: (messageId: string, emoji: string) => void | Promise<void>;
  /** 이전 페이지(과거 메시지) 로드 여부 판단용 — 늘어나면 맨 앞에 메시지가 추가된 것으로 본다 */
  pageCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onAtBottomStateChange: (atBottom: boolean) => void;
};

/** Virtuoso의 firstItemIndex는 "지금까지 맨 앞에서 몇 개가 늘었는지"를 역산할 수 있을 만큼
 * 충분히 큰 값에서 시작해야 한다(공식 문서의 prepend 패턴) — 이 방 안에서 무한 스크롤로
 * 불러올 수 있는 과거 메시지 총량보다 넉넉히 크면 된다. */
const FIRST_ITEM_INDEX_START = 1_000_000;

const isStandaloneSystemMessage = (message: Message) =>
  isSystemMessage(message.content) && !message.fileUrl && message.eventTitle == null && !message.poll;

function MessageActionButton({
  isDark,
  isActive,
  onClick,
  title,
  icon,
}: {
  isDark: boolean;
  isActive: boolean;
  onClick: () => void;
  title: string;
  icon: React.ReactNode;
}) {
  const idleColor = isDark ? '#cbd5e1' : '#334155';
  const accentColor = isDark ? 'var(--color-brand-light)' : 'var(--color-brand-dark)';
  const hoverBg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const activeBg = isDark ? 'rgba(124,165,255,0.12)' : 'rgba(var(--color-brand-dark-rgb),0.1)';
  const color = isActive ? accentColor : idleColor;
  const bg = isActive ? activeBg : 'transparent';
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 30,
        height: 30,
        padding: 0,
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: bg,
        color,
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isActive ? activeBg : hoverBg;
        e.currentTarget.style.color = accentColor;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isActive ? activeBg : 'transparent';
        e.currentTarget.style.color = isActive ? accentColor : idleColor;
      }}
    >
      {icon}
    </button>
  );
}

const ChatBubbleList = forwardRef<ChatBubbleListHandle, ChatBubbleListProps>(function ChatBubbleList({
  displayMessages,
  firstUnreadMessageId,
  isDark,
  accentTheme = 'default',
  myId,
  room,
  hoveredMsg,
  highlightedMsgId,
  emojiPickerMsg,
  setHoveredMsg,
  setHighlightedMsgId,
  setContextMenu,
  showToast,
  setReplyTo,
  setEmojiPickerMsg,
  handleReaction,
  pageCount,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onAtBottomStateChange,
}, ref) {
  const [alwaysShowActions, setAlwaysShowActions] = useState(false);
  // 내 메시지 말풍선 배경색 테마. 다크 모드는 대비 문제로 항상 기존 색 유지.
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const hoverNoneQuery = window.matchMedia('(hover: none)');
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    const updateActionVisibilityMode = () => setAlwaysShowActions(hoverNoneQuery.matches || coarsePointerQuery.matches);

    updateActionVisibilityMode();
    hoverNoneQuery.addEventListener?.('change', updateActionVisibilityMode);
    coarsePointerQuery.addEventListener?.('change', updateActionVisibilityMode);
    window.addEventListener('resize', updateActionVisibilityMode);

    return () => {
      hoverNoneQuery.removeEventListener?.('change', updateActionVisibilityMode);
      coarsePointerQuery.removeEventListener?.('change', updateActionVisibilityMode);
      window.removeEventListener('resize', updateActionVisibilityMode);
    };
  }, []);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [firstItemIndex, setFirstItemIndex] = useState(FIRST_ITEM_INDEX_START);
  const prevPageCountRef = useRef(pageCount);
  const prevLengthRef = useRef(displayMessages.length);

  // 과거 메시지 페이지가 추가로 로드돼 배열 맨 앞에 메시지가 붙은 경우에만
  // firstItemIndex를 줄인다 — Virtuoso가 이 값으로 스크롤 위치를 알아서 보존한다
  // (예전의 scrollHeight 수동 보정 로직을 대체).
  useEffect(() => {
    const addedCount = displayMessages.length - prevLengthRef.current;
    if (pageCount > prevPageCountRef.current && addedCount > 0) {
      setFirstItemIndex((v) => v - addedCount);
    }
    prevPageCountRef.current = pageCount;
    prevLengthRef.current = displayMessages.length;
  }, [pageCount, displayMessages.length]);

  useImperativeHandle(ref, () => ({
    scrollToBottom: () => {
      if (displayMessages.length === 0) return;
      virtuosoRef.current?.scrollToIndex({ index: displayMessages.length - 1, align: 'end', behavior: 'auto' });
    },
  }), [displayMessages.length]);

  const jumpToMessage = (targetId: string) => {
    const idx = displayMessages.findIndex((mm) => mm.id === targetId);
    if (idx === -1) return;
    setHighlightedMsgId(null);
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'smooth' });
    setTimeout(() => {
      setHighlightedMsgId(targetId);
      setTimeout(() => setHighlightedMsgId(null), 2000);
    }, 400);
  };

  if (displayMessages.length === 0) return null;

  const initialUnreadIndex = firstUnreadMessageId
    ? displayMessages.findIndex((m) => m.id === firstUnreadMessageId)
    : -1;
  const initialTopMostItemIndex = initialUnreadIndex !== -1
    ? { index: initialUnreadIndex, align: 'center' as const }
    : displayMessages.length - 1;

  const renderMessage = (m: Message, idx: number) => {
        const elements: React.ReactNode[] = [];
        const prevMsg = idx > 0 ? displayMessages[idx - 1] : null;
        const curDateKey = getDateKey(m.createdAt);
        const prevDateKey = prevMsg ? getDateKey(prevMsg.createdAt) : null;
        const isMine = m.senderId === myId;
        const shouldGroupWithPrev = Boolean(
          prevMsg &&
          prevDateKey === curDateKey &&
          prevMsg.senderId === m.senderId &&
          !isStandaloneSystemMessage(prevMsg) &&
          m.id !== firstUnreadMessageId
        );
        const showSenderIdentity = !isMine && !shouldGroupWithPrev;
        if (idx === 0 || curDateKey !== prevDateKey) {
          elements.push(
            <div key={`date-${curDateKey}-${m.id}`} className="flex items-center justify-center py-3">
              <span className="text-xs text-white bg-black/25 py-1 px-3.5 rounded-xl">
                {formatDateLabel(new Date(m.createdAt))}
              </span>
            </div>
          );
        }
        if (m.id === firstUnreadMessageId) {
          elements.push(
            <div key={`unread-${m.id}`} className="flex items-center justify-center py-2.5 px-4 mx-4 my-2 border-l-4 border-slate-900 rounded-lg animate-[unread-divider-pulse_2s_ease-in-out_3] bg-blue-500/10">
              <span className={cn('text-xs font-semibold', isDark ? 'text-blue-100' : 'text-slate-900')}>
                새 메시지
              </span>
            </div>
          );
        }
        if (isStandaloneSystemMessage(m)) {
          elements.push(
            <div key={m.id} className="flex items-center justify-center py-1.5">
              <span className="text-xs text-white bg-black/25 py-1 px-3.5 rounded-xl text-center">
                {m.content}
              </span>
            </div>
          );
          return elements;
        }
        if (m.deletedAt) {
          elements.push(
            <div key={m.id} className={cn('flex flex-col items-start w-full', isMine && 'items-end')}>
              <div className="flex items-start gap-2 w-full">
                {!isMine && (
                  showSenderIdentity ? (
                    <div className="w-[34px] h-[34px] shrink-0" aria-hidden>
                      <span className={cn('w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600')}>
                        {m.sender?.name?.trim()?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  ) : (
                    <div className="w-[34px] h-[34px] shrink-0" aria-hidden />
                  )
                )}
                <div className={cn('w-fit max-w-[75%] min-w-0', isMine && 'ml-auto')}>
                  <div
                    className={cn(
                      'min-w-[80px] py-2.5 px-3.5 rounded-2xl rounded-tl',
                      isMine
                        ? (useCustomAccent ? 'text-white rounded-tl-2xl rounded-tr' : 'bg-brand-dark/80 text-white rounded-tl-2xl rounded-tr')
                        : isDark ? 'bg-slate-700 text-slate-200' : 'bg-white text-slate-800',
                      'opacity-50 italic',
                    )}
                    style={isMine && useCustomAccent ? { background: orgTheme.accent } : undefined}
                  >
                    <span className="whitespace-pre-wrap break-words text-[15px] leading-snug">[삭제된 메시지]</span>
                  </div>
                </div>
              </div>
            </div>
          );
          return elements;
        }

        const isHovered = hoveredMsg === m.id;
        const isHighlighted = highlightedMsgId === m.id;
        elements.push(
          <div
            key={m.id}
            id={`msg-${m.id}`}
            className={cn('flex flex-col items-start w-full', isMine && 'items-end')}
            onMouseEnter={() => setHoveredMsg(m.id)}
            onMouseLeave={() => setHoveredMsg(null)}
            onTouchStart={() => setHoveredMsg(m.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, message: m });
            }}
          >
            {showSenderIdentity && (
              <div className={cn('text-xs mb-1 ml-[42px] max-w-[calc(75%-8px)] truncate', isDark ? 'text-slate-300' : 'text-slate-600')}>
                {m.sender.name}
              </div>
            )}

            {!HIDE_CONTEXT_ATTACH && (m.contextFilePath || m.contextBranch) && (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  const str = m.contextFilePath
                    ? m.contextFilePath + (m.contextLine ? `:${m.contextLine}` : '')
                    : (m.contextBranch || '');
                  if (str && navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(str).then(() => showToast('복사되었습니다.', 'success'));
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  borderRadius: 8,
                  background: isDark ? 'rgba(91,141,239,0.15)' : 'rgba(var(--color-brand-dark-rgb),0.1)',
                  color: isDark ? '#bfdbfe' : 'var(--color-brand-dark)',
                  marginBottom: 4,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  maxWidth: '85%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title="클릭하여 복사 (IDE에서 파일:라인 형식)"
              >
                📍 {[m.contextFilePath, m.contextLine ? `:${m.contextLine}` : null, m.contextBranch ? ` (${m.contextBranch})` : null].filter(Boolean).join('')}
              </div>
            )}
            {m.replyTo && (
              <div
                className={cn('w-full flex', isMine ? 'justify-end' : 'justify-start')}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className={cn(
                    'mb-1.5 py-2 px-3 rounded-[10px] flex flex-col gap-0.5 max-w-[85%] overflow-hidden cursor-pointer',
                    isMine ? 'mr-0' : 'ml-[42px]',
                    isDark ? 'bg-slate-700/70' : 'bg-slate-100/90',
                  )}
                onClick={() => jumpToMessage(m.replyTo!.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    jumpToMessage(m.replyTo!.id);
                  }
                }}
                >
                  <span className={cn('text-[11px] font-semibold truncate', isDark ? 'text-slate-200' : 'text-slate-500')}>
                    {m.replyTo.sender?.name}
                  </span>
                  <span className={cn('text-[13px] leading-snug line-clamp-2 truncate break-words', isDark ? 'text-slate-100' : 'text-slate-600')}>
                    {m.replyTo.content}
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-start gap-2 w-full">
              {!isMine && (
                showSenderIdentity ? (
                  <div className="w-[34px] h-[34px] shrink-0" aria-hidden>
                    <span className={cn('w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-bold', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-600')}>
                      {m.sender?.name?.trim()?.[0]?.toUpperCase() || '?'}
                    </span>
                  </div>
                ) : (
                  <div className="w-[34px] h-[34px] shrink-0" aria-hidden />
                )
              )}
              <div className={cn('w-fit max-w-[75%] min-w-0', isMine && 'ml-auto')}>
                <div className="relative">
                  <div
                    className={cn(
                      isHighlighted && 'message-bubble-highlight',
                      'min-w-[80px] py-2.5 px-3.5 rounded-2xl rounded-tl shadow-sm',
                      isMine
                        ? (useCustomAccent ? 'text-white rounded-tl-2xl rounded-tr shadow-sm' : 'bg-brand-dark text-white rounded-tl-2xl rounded-tr shadow-sm')
                        : isDark ? 'bg-slate-700 text-slate-200' : 'bg-white text-slate-800',
                    )}
                    style={isMine && useCustomAccent ? { background: orgTheme.accent } : undefined}
                  >
                    {m.poll ? (
                      <PollCard poll={m.poll} myId={myId} isMine={isMine} />
                    ) : m.eventTitle != null ? (
                      <EventCard title={m.eventTitle} startAt={m.eventStartAt!} endAt={m.eventEndAt!} description={m.eventDescription ?? undefined} isMine={isMine} />
                    ) : m.fileUrl ? (
                      <FileMessage message={m} />
                    ) : (
                      <>
                        <span className="whitespace-pre-wrap break-words text-[15px] leading-snug">
                        {renderMessageContent(m.content, isDark, isMine)}
                      </span>
                        {extractFirstUrl(m.content) && (
                          <LinkPreview url={extractFirstUrl(m.content)!} isDark={isDark} />
                        )}
                      </>
                    )}
                    {m.editedAt && <span className="text-[10px] opacity-60 mt-1 block">(수정됨)</span>}
                  </div>
                  {(isHovered || alwaysShowActions) && !m.deletedAt && (
                    <div
                      className={cn(
                        'absolute bottom-0 flex items-center gap-0.5',
                        isMine ? 'right-full mr-1.5' : 'left-full ml-1.5',
                      )}
                    >
                      <MessageActionButton
                        isDark={isDark}
                        isActive={false}
                        onClick={() => setReplyTo(m)}
                        title="답장"
                        icon={
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 10l7-7v4c8 0 11 4 11 11-2-5-5-7-11-7v4l-7-5z" />
                          </svg>
                        }
                      />
                      <div style={{ position: 'relative' }}>
                        <MessageActionButton
                          isDark={isDark}
                          isActive={emojiPickerMsg === m.id}
                          onClick={() => setEmojiPickerMsg(emojiPickerMsg === m.id ? null : m.id)}
                          title="반응"
                          icon={
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                              <line x1="9" y1="9" x2="9.01" y2="9" />
                              <line x1="15" y1="9" x2="15.01" y2="9" />
                            </svg>
                          }
                        />
                      </div>
                    </div>
                  )}
                  {emojiPickerMsg === m.id && (
                    <EmojiPicker
                      onSelect={(emoji) => handleReaction(m.id, emoji)}
                      onClose={() => setEmojiPickerMsg(null)}
                      anchorBelow
                      alignRight={isMine}
                    />
                  )}
                </div>
                <div className={cn('flex items-center gap-1.5 mt-1 px-0.5 flex-wrap', isMine ? 'justify-end' : 'justify-start')}>
                  <span className={cn('text-[11px]', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    {new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {isMine && room && (() => {
                    const memberCount = room.members?.length ?? 0;
                    if (memberCount <= 2) return null;
                    const totalReaders = memberCount - 1;
                    const readCount = m.readCount ?? 0;
                    const unreadCount = Math.max(0, totalReaders - readCount);
                    if (unreadCount === 0) return null;
                    return (
                      <span className={cn('text-[11px] font-bold', isDark ? 'text-brand-light' : 'text-brand-dark')}>
                        {unreadCount}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>

            {m.reactions && m.reactions.length > 0 && (
              <div className={cn('flex gap-1 flex-wrap mt-1', isMine ? 'ml-auto' : 'ml-[42px]')}>
                {m.reactions.map((r: ReactionGroup) => (
                  <button
                    key={r.emoji}
                    type="button"
                    onClick={() => handleReaction(m.id, r.emoji)}
                    className={cn(
                      'border rounded-xl py-0.5 px-2 text-[13px] cursor-pointer flex items-center gap-1',
                      myId && r.userIds.includes(myId)
                        ? (isDark ? 'border-blue-400 bg-blue-400/15' : 'border-blue-600 bg-blue-600/10')
                        : (isDark ? 'border-slate-600 bg-transparent' : 'border-slate-200 bg-transparent'),
                    )}
                  >
                    {r.emoji} {r.count}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
        return elements;
  };

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: '100%' }}
      className="overflow-x-hidden"
      data={displayMessages}
      computeItemKey={(_, m) => m.id}
      // Virtuoso가 넘기는 index는 firstItemIndex만큼 오프셋돼 있어 displayMessages의
      // 실제 배열 위치가 아니다 — 로컬 배열 인덱스로 되돌려야 renderMessage의
      // prevMsg 조회(날짜 구분선·연속 메시지 묶음)가 정상 동작한다.
      itemContent={(index, m) => <div className="px-5 pb-2.5">{renderMessage(m, index - firstItemIndex)}</div>}
      firstItemIndex={firstItemIndex}
      initialTopMostItemIndex={initialTopMostItemIndex}
      followOutput={(isAtBottom) => {
        const newestIsMine = displayMessages[displayMessages.length - 1]?.senderId === myId;
        return (isAtBottom || newestIsMine) ? 'auto' : false;
      }}
      atBottomStateChange={onAtBottomStateChange}
      startReached={() => {
        if (hasNextPage && !isFetchingNextPage) onLoadMore();
      }}
      components={{
        Header: () => isFetchingNextPage ? (
          <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 13, color: isDark ? '#64748b' : '#94a3b8' }}>
            이전 메시지 불러오는 중...
          </div>
        ) : null,
      }}
    />
  );
});

export default ChatBubbleList;
