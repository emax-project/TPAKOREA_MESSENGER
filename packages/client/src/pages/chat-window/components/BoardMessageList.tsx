import type { Dispatch, SetStateAction } from 'react';
import type { Message, ReactionGroup, Room } from '../../../api';
import EventCard from '../../../components/EventCard';
import PollCard from '../../../components/PollCard';
import FileMessage from '../../../components/FileMessage';
import LinkPreview, { extractFirstUrl } from '../../../components/LinkPreview';
import { cn } from '../../../utils/cn';
import { formatDateLabel, getDateKey, isSystemMessage, renderMessageContent, HIDE_CONTEXT_ATTACH } from '../utils';

type BoardMessageListProps = {
  rootPosts: Message[];
  repliesMap: Map<string, Message[]>;
  isDark: boolean;
  myId?: string;
  room?: Room;
  setContextMenu: Dispatch<SetStateAction<{ x: number; y: number; message: Message } | null>>;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  handleReaction: (messageId: string, emoji: string) => void | Promise<void>;
  boardCommentInputs: Record<string, string>;
  setBoardCommentInputs: Dispatch<SetStateAction<Record<string, string>>>;
  /** 서버 확인·재전송을 거치는 전송 함수(ChatWindow의 useMessageSender) */
  onSendMessage: (payload: { roomId: string; content: string; replyToId?: string }) => string;
  roomId?: string;
};

export default function BoardMessageList({
  rootPosts,
  repliesMap,
  isDark,
  myId,
  room,
  setContextMenu,
  showToast,
  handleReaction,
  boardCommentInputs,
  setBoardCommentInputs,
  onSendMessage,
  roomId,
}: BoardMessageListProps) {
  return (
    <>
      {rootPosts.map((m, idx) => {
        const elements: React.ReactNode[] = [];
        const prevMsg = idx > 0 ? rootPosts[idx - 1] : null;
        const curDateKey = getDateKey(m.createdAt);
        const prevDateKey = prevMsg ? getDateKey(prevMsg.createdAt) : null;
        if (idx === 0 || curDateKey !== prevDateKey) {
          elements.push(
            <div key={`date-${curDateKey}-${m.id}`} className="flex items-center justify-center py-3">
              <span className="text-xs text-white bg-black/25 py-1 px-3.5 rounded-xl">
                {formatDateLabel(new Date(m.createdAt))}
              </span>
            </div>
          );
        }
        if (isSystemMessage(m.content) && !m.fileUrl && m.eventTitle == null && !m.poll) {
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
            <div key={m.id} className={cn('w-full max-w-full p-4 rounded-xl flex flex-col gap-3', isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200', 'border shadow-sm')}>
              <div className="flex items-center justify-between gap-2.5 flex-wrap">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={cn('w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold shrink-0', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500')}>
                    {m.sender?.name?.trim()?.[0]?.toUpperCase() || '?'}
                  </span>
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className={cn('text-sm font-semibold', isDark ? 'text-slate-200' : 'text-slate-900')}>
                      {m.sender?.name ?? '알 수 없음'}
                    </span>
                    <span className={cn('text-xs shrink-0', isDark ? 'text-slate-400' : 'text-slate-500')}>
                      {new Date(m.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
              <div className={cn('text-sm whitespace-pre-wrap break-words leading-relaxed opacity-60 italic', isDark ? 'text-slate-200' : 'text-slate-700')}>
                [삭제된 메시지]
              </div>
            </div>
          );
          return elements;
        }
        const replies = repliesMap.get(m.id) || [];
        elements.push(
          <div
            key={m.id}
            id={`msg-${m.id}`}
            className={cn(
              'w-full max-w-full p-4 rounded-xl flex flex-col gap-3 border shadow-sm',
              isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200',
            )}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, message: m }); }}
          >
            <div className="flex items-center justify-between gap-2.5 flex-wrap">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn('w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold shrink-0', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500')}>
                  {m.sender?.name?.trim()?.[0]?.toUpperCase() || '?'}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={cn('text-sm font-semibold', isDark ? 'text-slate-200' : 'text-slate-900')}>
                    {m.sender?.name ?? '알 수 없음'}
                  </span>
                  <span className={cn('text-xs shrink-0', isDark ? 'text-slate-400' : 'text-slate-500')}>
                    {new Date(m.createdAt).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="border-none bg-transparent cursor-pointer p-1.5 rounded-full flex items-center justify-center transition-colors shrink-0"
                onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, message: m }); }}
                title="더보기"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" className={isDark ? 'text-slate-400' : 'text-slate-500'}>
                  <circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" />
                </svg>
              </button>
            </div>
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
                className={cn('text-[11px] py-1 px-2.5 mb-1.5 rounded-md cursor-pointer inline-block', isDark ? 'bg-blue-500/15 text-blue-200' : 'bg-blue-500/10 text-blue-600')}
                title="클릭하여 복사"
              >
                📍 {[m.contextFilePath, m.contextLine ? `:${m.contextLine}` : null, m.contextBranch ? ` (${m.contextBranch})` : null].filter(Boolean).join('')}
              </div>
            )}
            <div className={cn('text-sm whitespace-pre-wrap break-words leading-relaxed pl-0', isDark ? 'text-slate-200' : 'text-slate-700')}>
              {m.poll ? (
                <PollCard poll={m.poll} myId={myId} isMine={m.senderId === myId} />
              ) : m.eventTitle != null ? (
                <EventCard title={m.eventTitle} startAt={m.eventStartAt!} endAt={m.eventEndAt!} description={m.eventDescription ?? undefined} isMine={m.senderId === myId} />
              ) : m.fileUrl ? (
                <FileMessage message={m} />
              ) : (
                <>
                  {renderMessageContent(m.content, isDark)}
                  {extractFirstUrl(m.content) && <LinkPreview url={extractFirstUrl(m.content)!} isDark={isDark} />}
                </>
              )}
              {m.editedAt && <span className="text-[11px] opacity-60 mt-1 block">(수정됨)</span>}
            </div>
            <div className={cn('flex items-center gap-3 flex-wrap pt-2 border-t', isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500', 'text-xs')}>
              {m.senderId === myId && room && (() => {
                const memberCount = room.members?.length ?? 0;
                if (memberCount <= 2) return null;
                const totalReaders = memberCount - 1;
                const readCount = m.readCount ?? 0;
                const unreadCount = Math.max(0, totalReaders - readCount);
                if (unreadCount === 0) return null;
                return (
                  <span className={cn('text-xs font-bold', isDark ? 'text-brand' : 'text-brand')}>{unreadCount}</span>
                );
              })()}
              {m.reactions && m.reactions.length > 0 ? (
                <span className="flex items-center gap-1.5">
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
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleReaction(m.id, '👍')}
                  className={cn(
                    'py-1 px-2.5 border rounded-lg text-xs cursor-pointer shrink-0',
                    isDark ? 'border-slate-600 bg-slate-700 text-slate-400' : 'border-slate-200 bg-slate-50 text-slate-500',
                  )}
                >
                  👍 좋아요
                </button>
              )}
            </div>
            {replies.length > 0 && (
              <div className={cn('border-t pt-3 flex flex-col gap-2.5', isDark ? 'border-slate-700' : 'border-slate-200')}>
                {replies.map((reply) => (
                  <div
                    key={reply.id}
                    id={`msg-${reply.id}`}
                    className={cn('flex items-start gap-2 py-1 border-b pb-2.5', isDark ? 'border-slate-700/40' : 'border-slate-200/60')}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, message: reply }); }}
                  >
                    <span className={cn('w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-200 text-slate-500')}>
                      {reply.sender?.name?.trim()?.[0]?.toUpperCase() || '?'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn('text-[13px] font-semibold', isDark ? 'text-slate-200' : 'text-slate-800')}>
                          {reply.sender?.name ?? '알 수 없음'}
                        </span>
                        <span className={cn('text-[11px]', isDark ? 'text-slate-500' : 'text-slate-400')}>
                          {new Date(reply.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {reply.deletedAt ? (
                        <div className={cn('text-[13px] italic mt-0.5', isDark ? 'text-slate-500' : 'text-slate-400')}>
                          [삭제된 댓글]
                        </div>
                      ) : reply.fileUrl ? (
                        <div className="mt-1"><FileMessage message={reply} /></div>
                      ) : (
                        <div className={cn('text-[13px] leading-relaxed mt-0.5 whitespace-pre-wrap break-words', isDark ? 'text-slate-300' : 'text-slate-700')}>
                          {renderMessageContent(reply.content, isDark)}
                        </div>
                      )}
                      {reply.reactions && reply.reactions.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {reply.reactions.map((r: ReactionGroup) => (
                            <button
                              key={r.emoji}
                              type="button"
                              onClick={() => handleReaction(reply.id, r.emoji)}
                              className={cn(
                                'border rounded-lg py-0.5 px-1.5 text-[11px] cursor-pointer flex items-center gap-1',
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
                  </div>
                ))}
              </div>
            )}
            <div className={cn('flex items-center gap-2 border-t pt-2.5', isDark ? 'border-slate-700' : 'border-slate-200')}>
              <input
                type="text"
                value={boardCommentInputs[m.id] || ''}
                onChange={(e) => setBoardCommentInputs((prev) => ({ ...prev, [m.id]: e.target.value }))}
                placeholder="댓글을 입력하세요..."
                className={cn(
                  'flex-1 py-2 px-3 border rounded-full text-[13px] outline-none',
                  isDark ? 'border-slate-600 bg-slate-950 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-800',
                )}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    if ((e.nativeEvent as KeyboardEvent).isComposing) return;
                    e.preventDefault();
                    const text = (boardCommentInputs[m.id] || '').trim();
                    if (text && roomId) {
                      onSendMessage({ roomId, content: text, replyToId: m.id });
                      setBoardCommentInputs((prev) => ({ ...prev, [m.id]: '' }));
                    }
                  }
                }}
              />
              <button
                type="button"
                className={cn('py-1.5 px-3.5 border-none rounded-2xl text-white text-xs font-semibold cursor-pointer shrink-0', 'bg-brand-dark')}
                onClick={() => {
                  const text = (boardCommentInputs[m.id] || '').trim();
                  if (text && roomId) {
                    onSendMessage({ roomId, content: text, replyToId: m.id });
                    setBoardCommentInputs((prev) => ({ ...prev, [m.id]: '' }));
                  }
                }}
              >
                전송
              </button>
            </div>
          </div>
        );
        return elements;
      })}
    </>
  );
}
