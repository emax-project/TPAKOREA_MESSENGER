import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Socket } from 'socket.io-client';
import { useAuthStore, useThemeStore, useToastStore } from '../store';
import { roomsApi, filesApi, eventsApi, pollsApi, projectsApi, type Room, type Message } from '../api';
import FileUploadButton from '../components/FileUploadButton';
import InviteModal from '../components/InviteModal';
import RoomSettingsModal from '../components/RoomSettingsModal';
import PollCreateModal from '../components/PollCreateModal';
import ForwardModal from '../components/ForwardModal';
import MentionPopup from '../components/MentionPopup';
import PinnedMessages from '../components/PinnedMessages';
import TaskCreateModal from '../components/TaskCreateModal';
import TitleBar from '../components/TitleBar';
import {
  PANEL_TITLE_ROW,
  PanelDragHeader,
  PanelToolbarRow,
  panelHeaderBorder,
  panelTitleClass,
} from '../components/PanelDragHeader';
import { electronNoDragClass } from '../components/MacElectronDragBar';
import { electronDragStyle, electronNoDragStyle, isMacElectron, isWinElectron } from '../utils/electronChrome';
import ContextAttachModal, { type MessageContext } from '../components/ContextAttachModal';
import BoardEditor from '../components/BoardEditor';
import UICloseButton from '../components/ui/UICloseButton';
import { canEditOrDelete, HIDE_CONTEXT_ATTACH } from './chat-window/utils';
import { getOrgTheme } from '../utils/orgTheme';
import { useChatSocket } from './chat-window/hooks/useChatSocket';
import { useActiveChatPresence } from './chat-window/hooks/useActiveChatPresence';
import { cn } from '../utils/cn';
import ChatBubbleList from './chat-window/components/ChatBubbleList';
import BoardMessageList from './chat-window/components/BoardMessageList';
import ThreadPanel from './chat-window/components/ThreadPanel';

const MAX_DROP_SIZE = 2 * 1024 * 1024 * 1024;
const SCROLL_BOTTOM_THRESHOLD = 80;


type ChatWindowProps = { embedded?: boolean; onOpenInNewWindow?: () => void };

export default function ChatWindow({ embedded, onOpenInNewWindow }: ChatWindowProps = {}) {
  const { roomId } = useParams<{ roomId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const token = useAuthStore((s) => s.token);
  const myId = useAuthStore((s) => s.user?.id);
  const isDark = useThemeStore((s) => s.isDark);
  const accentTheme = useThemeStore((s) => s.accentTheme);
  const orgTheme = getOrgTheme(accentTheme);
  const useCustomAccent = !isDark && orgTheme.id !== 'default';
  const showToast = useToastStore((s) => s.show);
  useEffect(() => {
    if (!embedded) window.electronAPI?.setTitleBarTheme?.(isDark);
  }, [embedded, isDark]);
  const [input, setInput] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileUploading, setFileUploading] = useState(false);
  const [fileUploadProgress, setFileUploadProgress] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareEventOpen, setShareEventOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editingMsg, setEditingMsg] = useState<Message | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: Message } | null>(null);
  const [forwardOpen, setForwardOpen] = useState<string | null>(null);
  const [emojiPickerMsg, setEmojiPickerMsg] = useState<string | null>(null);
  const [pollCreateOpen, setPollCreateOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<string | null>(null);
  const [taskFromMessage, setTaskFromMessage] = useState<{ title: string; messageId: string } | null>(null);
  const [threadOpen, setThreadOpen] = useState<{ parentId: string; parent: Message; replies: Message[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [messageContext, setMessageContext] = useState<MessageContext | null>(null);
  useEffect(() => {
    setInput('');
    setReplyTo(null);
    setEditingMsg(null);
  }, [roomId]);
  const [boardCommentInputs, setBoardCommentInputs] = useState<Record<string, string>>({});
  const [viewportWidth, setViewportWidth] = useState<number>(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  // 임베디드(모바일 셸)이거나 좁은 창에서는 컴팩트 헤더
  const isCompactHeader = embedded || viewportWidth < 980;
  const socketRef = useRef<Socket | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const firstUnreadRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const prevPageCountRef = useRef(0);
  const prevMsgCountRef = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boardEditorRef = useRef<{ focus: () => void } | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const checkAtBottom = () => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
    setShowScrollToBottom(!atBottom);
  };
  const scrollToBottom = () => {
    messagesScrollRef.current?.scrollTo({ top: messagesScrollRef.current.scrollHeight, behavior: 'auto' });
  };
  const queryClient = useQueryClient();

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const { data: roomsList = [] } = useQuery({
    queryKey: ['rooms', myId],
    queryFn: roomsApi.list,
    enabled: !!myId && !!roomId,
  });

  const { data: room, isLoading: roomLoading } = useQuery({
    queryKey: ['rooms', roomId],
    queryFn: async () => {
      if (!roomId) return Promise.reject(new Error('no roomId'));
      // list를 먼저 로드해 viewMode 동기화 (보드뷰가 챗뷰로 보이는 문제 방지)
      const list = myId
        ? await queryClient.ensureQueryData<Room[]>({ queryKey: ['rooms', myId], queryFn: roomsApi.list, staleTime: 0 })
        : queryClient.getQueryData<Room[]>(['rooms', myId]);
      const data = await roomsApi.get(roomId);
      const fromList = list?.find((r) => r.id === roomId)?.viewMode;
      const apiViewMode = (data as Room).viewMode;
      if (fromList === 'board' && apiViewMode !== 'board') {
        return { ...data, viewMode: 'board' as const } as Room;
      }
      return data as Room;
    },
    enabled: !!roomId,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  useChatSocket({
    token,
    roomId,
    embedded,
    room,
    myId,
    socketRef,
    setSocket,
    queryClient,
  });

  type MessagesPage = { messages: Message[]; nextCursor: string | null; hasMore: boolean };

  const {
    data: messagesInfinite,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['rooms', roomId, 'messages'],
    queryFn: ({ pageParam }) => (roomId ? roomsApi.messages(roomId, pageParam as string | undefined) : Promise.resolve({ messages: [], nextCursor: null, hasMore: false })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: MessagesPage) => lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: !!roomId,
  });
  const { data: myEvents = [] } = useQuery({
    queryKey: ['events'],
    queryFn: eventsApi.list,
    enabled: !!token && !!shareEventOpen,
  });
  const messages = useMemo(
    () => (messagesInfinite?.pages ?? []).flatMap((p) => (p?.messages ?? []).filter(Boolean)),
    [messagesInfinite]
  );

  const handleLoadMore = useCallback(() => {
    if (messagesScrollRef.current) {
      prevScrollHeightRef.current = messagesScrollRef.current.scrollHeight;
    }
    fetchNextPage();
  }, [fetchNextPage]);

  const viewModeFromListNow = roomId ? roomsList.find((r) => r.id === roomId)?.viewMode : undefined;
  useEffect(() => {
    if (roomId && room && viewModeFromListNow === 'board' && room?.viewMode !== 'board') {
      queryClient.setQueryData(['rooms', roomId], { ...room, viewMode: 'board' as const });
    }
  }, [roomId, room, viewModeFromListNow, queryClient]);

  useEffect(() => {
    const t = setTimeout(checkAtBottom, 100);
    return () => clearTimeout(t);
  }, [messages.length, roomId]);

  // 스크롤 상단 sentinel - 이전 메시지 로드
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, handleLoadMore]);

  // 이전 페이지 로드 완료 시 스크롤 위치 보정
  useEffect(() => {
    const pageCount = messagesInfinite?.pages?.length ?? 0;
    if (pageCount > prevPageCountRef.current && prevPageCountRef.current > 0) {
      const el = messagesScrollRef.current;
      if (el) {
        const diff = el.scrollHeight - prevScrollHeightRef.current;
        el.scrollTop += diff;
      }
    }
    prevPageCountRef.current = pageCount;
  }, [messagesInfinite?.pages.length]);

  // 채팅창이 열리면 입력 칸에 포커스
  useEffect(() => {
    if (!roomId || !room) return;
    const t = setTimeout(() => {
      if (room?.viewMode === 'board') boardEditorRef.current?.focus();
      else inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(t);
  }, [roomId, room?.id, room?.viewMode]);

  useEffect(() => {
    if (roomId) {
      roomsApi.markRead(roomId).then(() => {
        if (myId) queryClient.invalidateQueries({ queryKey: ['rooms', myId], exact: true });
      }).catch((err) => {
        console.warn('[markRead] 읽음 처리 실패:', err.message);
      });
    }
  }, [roomId, queryClient, myId]);
  useActiveChatPresence(roomId);

  // roomId 변경 시 초기 스크롤 플래그 리셋
  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [roomId]);

  // 첫 번째 안 읽은 메시지 ID (useEffect보다 먼저 선언 필요)
  const displayMessagesForScroll = useMemo(() => [...messages].reverse(), [messages]);
  const firstUnreadMessageId = useMemo(() => {
    if (!room) return null;
    const lastReadAt = room?.lastReadAt ? new Date(room.lastReadAt).getTime() : 0;
    const unreadCount = room?.unreadCount ?? 0;
    if (unreadCount <= 0 || lastReadAt <= 0) return null;
    return displayMessagesForScroll.find((m) => m.senderId !== myId && new Date(m.createdAt).getTime() > lastReadAt)?.id ?? null;
  }, [room, myId, displayMessagesForScroll]);

  // 채팅 열릴 때: 다읽음→맨끝, 안읽음→첫 안읽은 메시지로 스크롤
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el || !room) return;
    const curCount = messages.length;
    const prevCount = prevMsgCountRef.current;
    prevMsgCountRef.current = curCount;

    // 이전 메시지 로드(페이지 추가)일 때는 스크롤 금지 - 위 useEffect에서 보정함
    const pagesLen = messagesInfinite?.pages?.length ?? 0;
    if (pagesLen > 1 && curCount > prevCount && curCount - prevCount >= 10) return;

    // 초기 로드 시에만 진입 스크롤 (room + messages 준비 후)
    if (curCount > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      const run = () => {
        if (firstUnreadMessageId && firstUnreadRef.current) {
          firstUnreadRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      };
      requestAnimationFrame(run);
      const t = setTimeout(run, 250);
      return () => clearTimeout(t);
    }

    // 새 메시지 추가 시에만 스크롤 (반응/수정 등 기존 메시지 업데이트는 제외)
    if (curCount <= prevCount) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD;
    const newestIsMine = messages[0]?.senderId === myId;
    const shouldScroll = (atBottom || newestIsMine) && prevCount > 0;
    if (shouldScroll) {
      const run = () => { el.scrollTop = el.scrollHeight; };
      requestAnimationFrame(run);
      const t = setTimeout(run, 150);
      return () => clearTimeout(t);
    }
  }, [messages.length, room, firstUnreadMessageId, messages, myId, messagesInfinite?.pages?.length]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const t = setTimeout(() => document.addEventListener('click', close), 50);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [contextMenu]);

  const sendMessage = async () => {
    const text = isBoardView
      ? (input === '<p></p>' ? '' : input.trim())
      : input.trim();

    if (editingMsg) {
      if (!text || !roomId) return;
      roomsApi.editMessage(roomId, editingMsg.id, text).then(() => {
        setEditingMsg(null);
        setInput('');
      }).catch(console.error);
      return;
    }

    // 파일 + 메시지 전송
    if (pendingFiles.length > 0) {
      if (!roomId) return;
      setFileUploading(true);
      // 파일별로 독립적으로 시도 — 하나가 실패해도 나머지는 계속 전송한다
      const failed: File[] = [];
      let contentSent = false;
      try {
        for (let i = 0; i < pendingFiles.length; i++) {
          const content = (!contentSent && text) ? text : undefined;
          try {
            await filesApi.upload(roomId, pendingFiles[i], (pct) => {
              setFileUploadProgress(((i / pendingFiles.length) + (pct / 100 / pendingFiles.length)) * 100);
            }, content);
            if (content) contentSent = true;
          } catch (err) {
            console.error('[sendMessage] 파일 전송 실패:', pendingFiles[i].name, err);
            failed.push(pendingFiles[i]);
          }
        }
      } finally {
        setFileUploading(false);
        setFileUploadProgress(0);
      }
      // 실패한 파일만 입력창에 남겨서 다시 보내기로 재시도할 수 있게 한다
      setPendingFiles(failed);
      if (failed.length > 0) {
        showToast(`${failed.map((f) => f.name).join(', ')} 전송 실패 — 다시 보내기를 눌러 재시도해 주세요`, 'error');
      }
      if (contentSent) setInput('');
      setReplyTo(null);
      // 방 목록만 갱신 — ['rooms'] 전체 invalidate 시 messages 캐시가 리페치되며 소켓 prepend가 덮어써질 수 있음
      if (myId) queryClient.invalidateQueries({ queryKey: ['rooms', myId], exact: true });
      return;
    }

    // 텍스트만 전송 (socketRef 사용 - stale closure 방지)
    const s = socketRef.current;
    if (!text || !roomId || !s) return;
    const payload: { roomId: string; content: string; replyToId?: string; context?: { filePath?: string; line?: number; branch?: string } } = {
      roomId,
      content: text,
      replyToId: replyTo?.id || undefined,
    };
    if (messageContext && (messageContext.filePath || messageContext.branch)) {
      payload.context = {
        filePath: messageContext.filePath || undefined,
        line: messageContext.line > 0 ? messageContext.line : undefined,
        branch: messageContext.branch || undefined,
      };
    }
    s.emit('message', payload);
    if (myId) queryClient.invalidateQueries({ queryKey: ['rooms', myId], exact: true });
    setInput('');
    setReplyTo(null);
    setMessageContext(null);
  };

  const handleSearch = async () => {
    if (!roomId || !searchQuery.trim()) { setSearchResults([]); return; }
    try {
      const res = await roomsApi.searchMessages(roomId, searchQuery.trim());
      setSearchResults(res.messages);
    } catch { setSearchResults([]); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Mention detection
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBefore = val.slice(0, cursorPos);
    const atMatch = textBefore.match(/@(\S*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1]);
    } else {
      setMentionQuery(null);
    }
  };

  const handleMentionSelect = (name: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? input.length;
    const textBefore = input.slice(0, cursorPos);
    const textAfter = input.slice(cursorPos);
    const replaced = textBefore.replace(/@\S*$/, `@${name} `);
    setInput(replaced + textAfter);
    setMentionQuery(null);
    inputRef.current?.focus();
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0 || fileUploading) return;
    const valid = droppedFiles.filter((f) => f.size <= MAX_DROP_SIZE);
    if (valid.length > 0) setPendingFiles((prev) => [...prev, ...valid]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (fileUploading) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    let file: File | null = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        file = item.getAsFile();
        break;
      }
    }
    if (!file) return;
    e.preventDefault();
    if (file.size > MAX_DROP_SIZE) return;
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/gif' ? 'gif' : file.type === 'image/webp' ? 'webp' : 'png';
    const namedFile = new File([file], `image-${Date.now()}.${ext}`, { type: file.type });
    setPendingFiles((prev) => [...prev, namedFile]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      sendMessage();
    }
    if (e.key === 'Escape') {
      setReplyTo(null);
      setEditingMsg(null);
      setMentionQuery(null);
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    if (!roomId) return;
    try {
      await roomsApi.toggleReaction(roomId, messageId, emoji);
    } catch (err) {
      console.error(err);
    }
  };

  const handleForward = async (targetRoomId: string) => {
    if (!forwardOpen) return;
    try {
      await roomsApi.forwardMessage(targetRoomId, forwardOpen);
    } catch (err) {
      console.error(err);
    }
    setForwardOpen(null);
  };

  const handleDelete = async (msg: Message) => {
    if (!roomId || !confirm('이 메시지를 삭제하시겠습니까?')) return;
    try {
      await roomsApi.deleteMessage(roomId, msg.id);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePin = async (messageId: string) => {
    if (!roomId) return;
    try {
      await roomsApi.pinMessage(roomId, messageId);
      queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'pins'] });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreatePoll = async (question: string, options: string[], isMultiple: boolean) => {
    if (!roomId) return;
    try {
      await pollsApi.create({ roomId, question, options, isMultiple });
      setPollCreateOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenThread = async (messageId: string) => {
    if (!roomId) return;
    try {
      const data = await roomsApi.thread(roomId, messageId);
      setThreadOpen({ parentId: messageId, parent: data.parent, replies: data.replies });
    } catch (err) {
      console.error(err);
    }
  };

  const viewModeFromState = (location.state as { viewMode?: 'chat' | 'board' })?.viewMode;
  const isBoardView = room?.viewMode === 'board' || viewModeFromListNow === 'board' || viewModeFromState === 'board';

  // 보드뷰: 루트 포스트와 댓글(reply) 분리 - 훅은 early return 전에 호출
  const { rootPosts, repliesMap } = useMemo(() => {
    if (!isBoardView) return { rootPosts: [] as Message[], repliesMap: new Map<string, Message[]>() };
    const reversed = [...messages].reverse();
    const map = new Map<string, Message[]>();
    const roots: Message[] = [];
    for (const m of reversed) {
      if (m.replyToId) {
        const arr = map.get(m.replyToId) || [];
        arr.push(m);
        map.set(m.replyToId, arr);
      } else {
        roots.push(m);
      }
    }
    return { rootPosts: roots, repliesMap: map };
  }, [messages, isBoardView]);

  if (!roomId) {
    if (!embedded) navigate('/', { replace: true });
    return null;
  }

  if (roomLoading || !room) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0 relative', isDark ? 'bg-slate-900' : 'bg-white')}>
        <div className={cn('flex-1 flex items-center justify-center text-base', isDark ? 'text-slate-400' : 'text-slate-500')}>
          채팅방 로딩 중...
        </div>
      </div>
    );
  }

  const displayMessages = displayMessagesForScroll;
  const hasElectron = !!window.electronAPI;
  const members = room?.members ?? [];
  const isCreator = !!(room?.isTopic && room?.createdBy && room.createdBy === myId);
  const canInvite = !room?.isTopic || isCreator;

  const iconBtnClass = (compact: boolean) =>
    cn(
      'shrink-0 rounded-lg border-none cursor-pointer flex items-center justify-center transition-colors',
      embedded ? 'w-7 h-7' : compact ? 'w-8 h-8' : 'w-[34px] h-[34px]',
      isDark ? 'bg-slate-700 text-slate-400' : 'bg-white text-slate-600',
    );

  const chatHeaderActions = (
    <>
      {embedded && onOpenInNewWindow && (
        <button type="button" className={iconBtnClass(isCompactHeader)} onClick={onOpenInNewWindow} title="새 창으로 열기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      )}
      <button type="button" className={iconBtnClass(isCompactHeader)} onClick={() => setSearchOpen(!searchOpen)} title="검색">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
        </svg>
      </button>
      <button
        type="button"
        className={iconBtnClass(isCompactHeader)}
        onClick={() => {
          if (window.electronAPI?.openKanbanWindow) {
            window.electronAPI.openKanbanWindow(roomId!);
          } else {
            window.open(`${window.location.origin}/kanban/${roomId}`, '_blank', 'width=1100,height=750');
          }
        }}
        title="프로젝트 보드"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="10" rx="1" />
        </svg>
      </button>
      {isCreator && (
        <button type="button" className={iconBtnClass(isCompactHeader)} onClick={() => setSettingsOpen(true)} title="방 설정">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>
        </button>
      )}
      {canInvite && (
        <button type="button" className={iconBtnClass(isCompactHeader)} onClick={() => setInviteOpen(true)} title="멤버 초대">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
          </svg>
        </button>
      )}
    </>
  );

  return (
    <div
      className={cn(
        'relative flex flex-col overflow-hidden',
        embedded ? 'flex-1 min-h-0 min-w-0' : 'h-full min-h-0 w-full min-w-0',
        isDark ? 'bg-slate-900' : embedded ? 'bg-slate-50' : 'bg-white',
      )}
    >
      <style>{`
        @keyframes message-bubble-highlight-blink {
          0%, 100% { outline-color: rgba(59, 130, 246, 0.9); }
          50% { outline-color: rgba(59, 130, 246, 0.2); }
        }
        .message-bubble-highlight {
          outline: 2px solid rgba(59, 130, 246, 0.8);
          outline-offset: 2px;
          animation: message-bubble-highlight-blink 0.5s ease-in-out 3;
        }
        @keyframes unread-divider-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
      {!embedded && hasElectron && isWinElectron() && <TitleBar title={room.name} isDark={isDark} />}
      <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
        <div
          className={cn(
            'flex flex-col flex-1 min-w-0 relative',
            isDark ? 'bg-slate-900' : 'bg-white',
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
        {dragOver && (
          <div className="absolute inset-0 z-[100] bg-black/60 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-3">
              <span className="text-white text-base font-semibold">파일을 여기에 놓으세요</span>
            </div>
          </div>
        )}
        {embedded ? (
          <div className={cn('sticky top-0 z-10 shrink-0 border-b', panelHeaderBorder(isDark))}>
            <PanelDragHeader className={cn(PANEL_TITLE_ROW, panelHeaderBorder(isDark), 'h-[40px] min-h-[40px] px-4 border-b-0')}>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <h3 className={cn(panelTitleClass(isDark), 'text-[15px]')} title={room.name}>{room.name}</h3>
                {isBoardView && (
                  <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0', isDark ? 'text-slate-400 bg-white/10' : 'text-slate-500 bg-black/5')}>
                    보드뷰
                  </span>
                )}
              </div>
            </PanelDragHeader>
            <PanelToolbarRow isDark={isDark} compact className="h-[34px] min-h-[34px] justify-end gap-1 px-4 py-0">
              {chatHeaderActions}
            </PanelToolbarRow>
          </div>
        ) : (
        <header
          className={cn(
            'sticky top-0 z-10 flex items-center justify-between gap-2 shrink-0 border-b min-w-0 overflow-hidden',
            isMacElectron() && 'electron-drag',
            isCompactHeader ? 'px-3 py-2 min-h-[52px]' : 'px-5 min-h-[56px]',
            isMacElectron() && (isCompactHeader ? 'pl-[78px]' : 'pl-[86px]'),
            isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50 shadow-sm',
          )}
          style={isMacElectron() ? electronDragStyle : undefined}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pointer-events-none">
            <span className={cn('text-base font-bold truncate', isDark ? 'text-slate-100' : 'text-slate-800')} title={room.name}>
              {room.name}
            </span>
            {isBoardView && (
              <span className={cn('text-[11px] font-semibold px-2 py-0.5 rounded-md shrink-0', isDark ? 'text-slate-400 bg-white/10' : 'text-slate-500 bg-black/5')}>
                보드뷰
              </span>
            )}
          </span>
          <div className={cn(electronNoDragClass, 'flex shrink-0 flex-nowrap items-center gap-1.5')} style={isMacElectron() ? electronNoDragStyle : undefined}>
            {chatHeaderActions}
          </div>
        </header>
        )}

        {searchOpen && (
          <div className={cn('flex gap-1.5 py-2 px-4 border-b', isDark ? 'border-slate-700 bg-slate-800' : 'border-slate-200 bg-slate-50')}>
            <input
              type="text"
              placeholder="메시지 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className={cn('flex-1 px-3 py-2 border rounded-lg text-[13px] outline-none', isDark ? 'border-slate-600 bg-slate-950 text-slate-200' : 'border-slate-200 bg-slate-100 text-slate-800')}
              autoFocus
            />
            <button type="button" onClick={handleSearch} className="h-8 min-h-8 px-3.5 border-none rounded-lg bg-brand text-white text-[13px] cursor-pointer inline-flex items-center justify-center">
              검색
            </button>
            <UICloseButton
              size="md"
              variant="subtle"
              onClick={() => { setSearchOpen(false); setSearchResults([]); setSearchQuery(''); }}
              style={{ width: 32, height: 32, minWidth: 32, minHeight: 32, borderRadius: 8 }}
            />
          </div>
        )}
        {searchResults.length > 0 && (
          <div className={cn('max-h-[200px] overflow-auto border-b', isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white')}>
            {searchResults.map((sr) => (
              <div key={sr.id} className={cn('flex items-center gap-1 py-2 px-4 border-b', isDark ? 'border-slate-700' : 'border-slate-100')}>
                <span style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', marginRight: 8 }}>{sr.sender.name}</span>
                <span style={{ fontSize: 13, color: isDark ? '#e2e8f0' : '#0f172a' }}>{sr.content}</span>
                <span style={{ fontSize: 11, color: isDark ? '#64748b' : '#94a3b8', marginLeft: 'auto', flexShrink: 0 }}>
                  {new Date(sr.createdAt).toLocaleString('ko-KR')}
                </span>
              </div>
            ))}
          </div>
        )}

        {!HIDE_CONTEXT_ATTACH && contextOpen && (
          <ContextAttachModal
            initialContext={messageContext}
            onClose={() => setContextOpen(false)}
            onConfirm={(ctx) => { setMessageContext(ctx); setContextOpen(false); }}
          />
        )}
        {inviteOpen && room && (
          <InviteModal
            roomId={roomId!}
            currentMemberIds={members.map((m: { id: string }) => m.id)}
            onClose={() => setInviteOpen(false)}
            onInvited={(newRoomId: string) => {
              queryClient.refetchQueries({ queryKey: ['rooms'] });
              if (window.electronAPI?.openChatWindow) {
                window.electronAPI.openChatWindow(newRoomId);
              } else {
                window.open(`${window.location.origin}/chat/${newRoomId}`, '_blank', 'width=480,height=680');
              }
            }}
          />
        )}

        {settingsOpen && room && (
          <RoomSettingsModal
            room={room}
            onClose={() => setSettingsOpen(false)}
            onUpdated={() => {
              queryClient.invalidateQueries({ queryKey: ['rooms'] });
              queryClient.invalidateQueries({ queryKey: ['rooms', roomId] });
              setSettingsOpen(false);
            }}
          />
        )}

        <PinnedMessages roomId={roomId!} />

        <div className="relative flex-1 min-h-0 flex flex-col">
          <div
            ref={messagesScrollRef}
            onScroll={checkAtBottom}
            className={cn('flex-1 overflow-x-hidden overflow-y-auto py-4 px-5 flex flex-col gap-2.5', isDark ? 'bg-slate-900' : 'bg-white')}
          >
          <div ref={topSentinelRef} style={{ height: 1 }} />
          {isFetchingNextPage && (
            <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 13, color: isDark ? '#64748b' : '#94a3b8' }}>
              이전 메시지 불러오는 중...
            </div>
          )}
          {isBoardView ? (
            <BoardMessageList
              rootPosts={rootPosts}
              repliesMap={repliesMap}
              isDark={isDark}
              myId={myId}
              room={room}
              setContextMenu={setContextMenu}
              showToast={showToast}
              handleReaction={handleReaction}
              boardCommentInputs={boardCommentInputs}
              setBoardCommentInputs={setBoardCommentInputs}
              socketRef={socketRef}
              roomId={roomId}
            />
          )

          /* ===== 채팅뷰: 기존 말풍선 ===== */
          : (
            <ChatBubbleList
              displayMessages={displayMessages}
              firstUnreadMessageId={firstUnreadMessageId}
              firstUnreadRef={firstUnreadRef}
              isDark={isDark}
              accentTheme={accentTheme}
              myId={myId}
              room={room}
              hoveredMsg={hoveredMsg}
              highlightedMsgId={highlightedMsgId}
              emojiPickerMsg={emojiPickerMsg}
              setHoveredMsg={setHoveredMsg}
              setHighlightedMsgId={setHighlightedMsgId}
              setContextMenu={setContextMenu}
              showToast={showToast}
              setReplyTo={setReplyTo}
              setEmojiPickerMsg={setEmojiPickerMsg}
              handleReaction={handleReaction}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
        {showScrollToBottom && (
          <button
            type="button"
            onClick={scrollToBottom}
            className={cn(
              'absolute bottom-4 right-5 w-10 h-10 rounded-full border-none cursor-pointer flex items-center justify-center z-10 shadow-lg',
              isDark ? 'bg-slate-700 text-slate-200' : 'bg-white text-slate-600',
            )}
            aria-label="맨 아래로"
            title="맨 아래로"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </button>
        )}
        </div>

        {/* Context menu */}
        {contextMenu && (
          <div className={cn('fixed z-[10000] min-w-[120px] p-1 rounded-lg shadow-lg border whitespace-nowrap', isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-200')} style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => { setReplyTo(contextMenu.message); setContextMenu(null); if (isBoardView) boardEditorRef.current?.focus(); else inputRef.current?.focus(); }}>
              답장
            </button>
            <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => { setForwardOpen(contextMenu.message.id); setContextMenu(null); }}>
              전달
            </button>
            <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => { handlePin(contextMenu.message.id); setContextMenu(null); }}>
              고정
            </button>
            <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => { handleOpenThread(contextMenu.message.id); setContextMenu(null); }}>
              스레드 보기
            </button>
            <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => { setTaskFromMessage({ title: contextMenu.message.content, messageId: contextMenu.message.id }); setContextMenu(null); }}>
              태스크로 변환
            </button>
            {canEditOrDelete(contextMenu.message, myId) && (
              <>
                <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer', isDark ? 'text-slate-200' : 'text-slate-800')} onClick={() => {
                  setEditingMsg(contextMenu.message);
                  setInput(contextMenu.message.content);
                  setContextMenu(null);
                  if (isBoardView) boardEditorRef.current?.focus();
                  else inputRef.current?.focus();
                }}>
                  수정
                </button>
                <button type="button" className={cn('block w-full py-2 px-3 border-none bg-transparent rounded-md text-[13px] text-left cursor-pointer text-red-600')} onClick={() => { handleDelete(contextMenu.message); setContextMenu(null); }}>
                  삭제
                </button>
              </>
            )}
          </div>
        )}

        {forwardOpen && <ForwardModal onClose={() => setForwardOpen(null)} onSelect={handleForward} />}
        {pollCreateOpen && <PollCreateModal onClose={() => setPollCreateOpen(false)} onCreate={handleCreatePoll} />}

        {taskFromMessage && roomId && (() => {
          const projectsQuery = queryClient.getQueryData<import('../api').Project[]>(['projects', roomId]);
          const proj = projectsQuery?.[0];
          if (!proj) {
            return (
              <div style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setTaskFromMessage(null)}>
                <div style={{ background: isDark ? '#1e293b' : '#fff', borderRadius: 12, padding: 24, maxWidth: 360, textAlign: 'center' as const }} onClick={(e) => e.stopPropagation()}>
                  <p style={{ fontSize: 14, color: isDark ? '#e2e8f0' : '#0f172a', margin: '0 0 16px' }}>프로젝트가 없습니다. 먼저 칸반 보드에서 프로젝트를 생성해주세요.</p>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                    <button type="button" onClick={() => setTaskFromMessage(null)} style={{ padding: '8px 16px', border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`, borderRadius: 8, background: 'none', color: isDark ? '#94a3b8' : '#64748b', fontSize: 13, cursor: 'pointer' }}>닫기</button>
                    <button type="button" onClick={() => {
                      setTaskFromMessage(null);
                      if (window.electronAPI?.openKanbanWindow) {
                        window.electronAPI.openKanbanWindow(roomId!);
                      } else {
                        window.open(`${window.location.origin}/kanban/${roomId}`, '_blank', 'width=1100,height=750');
                      }
                    }} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: '#475569', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>보드 열기</button>
                  </div>
                </div>
              </div>
            );
          }
          return (
            <TaskCreateModal
              boards={proj.boards}
              members={room?.members || []}
              defaultTitle={taskFromMessage.title}
              onSubmit={async (data) => {
                try {
                  await projectsApi.createTask(proj.id, { ...data, messageId: taskFromMessage.messageId });
                  queryClient.invalidateQueries({ queryKey: ['projects', roomId] });
                  setTaskFromMessage(null);
                } catch (err) {
                  console.error(err);
                }
              }}
              onClose={() => setTaskFromMessage(null)}
            />
          );
        })()}

        {shareEventOpen && (
          <div className="absolute inset-0 z-[200] bg-black/40 flex items-center justify-center" onClick={() => setShareEventOpen(false)}>
            <div className={cn('rounded-xl shadow-lg min-w-[320px] max-w-[90%] max-h-[70vh] overflow-auto p-5', isDark ? 'bg-slate-800' : 'bg-white')} onClick={(e) => e.stopPropagation()}>
              <h4 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a' }}>일정 공유</h4>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {myEvents.length === 0 ? (
                  <li style={{ padding: 16, color: isDark ? '#94a3b8' : '#64748b', fontSize: 14 }}>등록된 일정이 없습니다.</li>
                ) : (
                  myEvents.map((ev) => (
                    <li
                      key={ev.id}
                      style={{ padding: 12, borderBottom: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`, cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!socketRef.current || !roomId) return;
                        socketRef.current.emit('message', { roomId, content: '', sharedEvent: { title: ev.title, startAt: ev.startAt, endAt: ev.endAt, description: ev.description ?? '' } });
                        if (myId) queryClient.invalidateQueries({ queryKey: ['rooms', myId], exact: true });
                        setShareEventOpen(false);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (document.activeElement as HTMLElement)?.click()}
                    >
                      <strong style={{ display: 'block', fontSize: 14, fontWeight: 600, color: isDark ? '#e2e8f0' : '#0f172a', marginBottom: 4 }}>{ev.title}</strong>
                      <span style={{ display: 'block', fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
                        {new Date(ev.startAt).toLocaleString('ko-KR')} ~ {new Date(ev.endAt).toLocaleString('ko-KR')}
                      </span>
                    </li>
                  ))
                )}
              </ul>
              <button type="button" style={{ marginTop: 12, padding: '10px 20px', border: 'none', borderRadius: 8, background: isDark ? '#334155' : '#f1f5f9', color: isDark ? '#e2e8f0' : '#0f172a', fontSize: 14, cursor: 'pointer', width: '100%' }} onClick={() => setShareEventOpen(false)}>
                닫기
              </button>
            </div>
          </div>
        )}

        {/* Reply/Edit indicator */}
        {(replyTo || editingMsg) && (
          <div className={cn('flex items-start gap-2 py-2 px-4 border-t', isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-slate-50')}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: isDark ? 'var(--color-brand-light)' : 'var(--color-brand-dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {editingMsg ? '메시지 수정' : `${replyTo!.sender.name}에게 답장`}
              </span>
              <span style={{ fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.35, wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
                {editingMsg ? editingMsg.content : replyTo!.content}
              </span>
            </div>
            <UICloseButton size="sm" onClick={() => { setReplyTo(null); setEditingMsg(null); setInput(''); }} />
          </div>
        )}

        {/* Mention popup */}
        <div style={{ position: 'relative' }}>
          {mentionQuery !== null && (
            <MentionPopup members={members} query={mentionQuery} onSelect={handleMentionSelect} />
          )}
        </div>

        {/* 첨부 파일 프리뷰 바 */}
        {pendingFiles.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 16px', background: isDark ? '#1e293b' : '#f8fafc', borderTop: `1px solid ${isDark ? '#334155' : '#e2e8f0'}` }}>
            {pendingFiles.map((f, idx) => {
              const isImage = f.type.startsWith('image/');
              const sizeStr = f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)}KB` : `${(f.size / (1024 * 1024)).toFixed(1)}MB`;
              return (
                <div key={`${f.name}-${idx}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8, background: isDark ? '#334155' : '#e2e8f0', maxWidth: 260 }}>
                  {isImage ? (
                    <img src={URL.createObjectURL(f)} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} />
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#94a3b8' : '#64748b'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  )}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: isDark ? '#e2e8f0' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    <div style={{ fontSize: 11, color: isDark ? '#64748b' : '#94a3b8' }}>{sizeStr}</div>
                  </div>
                  <UICloseButton
                    size="sm"
                    aria-label="첨부 파일 제거"
                    title="첨부 파일 제거"
                    style={{ color: isDark ? '#94a3b8' : '#64748b' }}
                    onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
                  />
                </div>
              );
            })}
          </div>
        )}

        {/* 업로드 프로그레스 바 */}
        {fileUploading && (
          <div style={{ padding: '0 16px 4px', background: isDark ? '#1e293b' : '#f8fafc' }}>
            <div style={{ height: 4, borderRadius: 2, background: isDark ? '#334155' : '#e2e8f0', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${fileUploadProgress}%`, background: 'var(--color-brand)', borderRadius: 2, transition: 'width 0.2s' }} />
            </div>
            <div style={{ fontSize: 11, color: isDark ? '#64748b' : '#94a3b8', marginTop: 2 }}>업로드 중 {Math.round(fileUploadProgress)}%</div>
          </div>
        )}

        {!HIDE_CONTEXT_ATTACH && messageContext && (messageContext.filePath || messageContext.branch) && (
          <div style={{ padding: '6px 16px 4px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 8,
                background: isDark ? 'rgba(91,141,239,0.2)' : 'rgba(var(--color-brand-dark-rgb),0.12)',
                color: isDark ? '#93c5fd' : 'var(--color-brand-dark)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              📍 {[messageContext.filePath, messageContext.line > 0 ? `:${messageContext.line}` : null, messageContext.branch ? ` (${messageContext.branch})` : null].filter(Boolean).join('')}
              <UICloseButton
                size="sm"
                aria-label="제거"
                title="제거"
                style={{ opacity: 0.8 }}
                onClick={() => setMessageContext(null)}
              />
            </span>
          </div>
        )}
        <div className={cn(
          'py-2.5 px-4 pb-3.5 flex gap-2.5 items-end',
          isCompactHeader && 'px-2 gap-1.5',
          isDark ? 'bg-slate-800 border-t border-slate-700' : 'bg-slate-50 border-t border-slate-200',
        )}>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative shrink-0">
              <button
                type="button"
                className={cn('w-10 h-10 rounded-full border-none text-xl leading-10 text-center cursor-pointer inline-flex items-center justify-center transition-colors', isDark ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-600')}
                onClick={() => setActionsOpen((v) => !v)}
                disabled={!socket}
                title="추가 액션"
              >
                +
              </button>
              {actionsOpen && (
                <div className={cn('absolute bottom-12 left-0 py-1.5 px-1.5 flex flex-col gap-0.5 min-w-[150px] z-50 rounded-xl border shadow-lg', isDark ? 'bg-slate-700 border-slate-600' : 'bg-white border-slate-200')}>
                  {!HIDE_CONTEXT_ATTACH && (
                    <>
                      <button
                        type="button"
                        className={cn('border-none bg-transparent rounded-lg py-2.5 px-3 text-left cursor-pointer text-[13px] transition-colors', isDark ? 'text-slate-200' : 'text-slate-700')}
                        onClick={() => {
                          setActionsOpen(false);
                          setContextOpen(true);
                        }}
                      >
                        코드 위치 첨부
                      </button>
                      <div className={cn('h-px my-0.5', isDark ? 'bg-slate-600' : 'bg-slate-200')} />
                    </>
                  )}
                  <button
                    type="button"
                    className={cn('border-none bg-transparent rounded-lg py-2.5 px-3 text-left cursor-pointer text-[13px] transition-colors', isDark ? 'text-slate-200' : 'text-slate-700')}
                    onClick={() => {
                      setActionsOpen(false);
                      setShareEventOpen(true);
                    }}
                  >
                    일정 공유
                  </button>
                  <div className={cn('h-px my-0.5', isDark ? 'bg-slate-600' : 'bg-slate-200')} />
                  <button
                    type="button"
                    className={cn('border-none bg-transparent rounded-lg py-2.5 px-3 text-left cursor-pointer text-[13px] transition-colors', isDark ? 'text-slate-200' : 'text-slate-700')}
                    onClick={() => {
                      setActionsOpen(false);
                      setPollCreateOpen(true);
                    }}
                  >
                    투표 만들기
                  </button>
                </div>
              )}
            </div>
            <FileUploadButton
              disabled={!socket || fileUploading}
              onFileSelected={(files) =>
                setPendingFiles((prev) => [...prev, ...files])
              }
            />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            {isBoardView ? (
              <BoardEditor
                ref={boardEditorRef}
                value={input}
                onChange={setInput}
                placeholder={isCompactHeader ? '글 작성…' : '글 작성 (Shift+Enter)'}
                isDark={isDark}
                disabled={!socket}
                compact={isCompactHeader}
                minHeight={isCompactHeader ? 38 : 42}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <textarea
                ref={inputRef}
                placeholder="메시지 입력"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                rows={1}
                className={cn(
                  'w-full py-2.5 px-4 border rounded-full text-sm leading-normal min-h-[42px] max-h-[120px] resize-none outline-none transition-colors font-inherit overflow-hidden placeholder:whitespace-nowrap placeholder:overflow-hidden placeholder:text-ellipsis',
                  isCompactHeader && 'px-3 py-2 min-h-[38px] text-[13px]',
                  isDark ? 'border-slate-600 bg-slate-950 text-slate-200' : 'border-slate-200 bg-slate-50 text-slate-800',
                )}
              />
            )}
          </div>
          <div className="flex items-center justify-end shrink-0">
            <button
              type="button"
              onClick={sendMessage}
              className={cn(
                'py-2.5 px-5 rounded-full font-bold text-sm cursor-pointer whitespace-nowrap transition-colors',
                isCompactHeader && 'px-3.5 py-2',
                (!input.trim() && pendingFiles.length === 0) || !socket || fileUploading
                  ? (isDark ? 'bg-slate-700 text-slate-400 opacity-90' : 'bg-slate-300 text-white opacity-90')
                  : (useCustomAccent ? 'text-white' : 'bg-brand-dark text-white'),
              )}
              style={
                useCustomAccent && ((input.trim() || pendingFiles.length > 0) && socket && !fileUploading)
                  ? { background: orgTheme.accent }
                  : undefined
              }
              disabled={(!input.trim() && pendingFiles.length === 0) || !socket || fileUploading}
            >
              {editingMsg ? '수정' : '전송'}
            </button>
          </div>
        </div>

        <ThreadPanel threadOpen={threadOpen} setThreadOpen={setThreadOpen} isDark={isDark} />
        </div>
      </div>
    </div>
  );
}
