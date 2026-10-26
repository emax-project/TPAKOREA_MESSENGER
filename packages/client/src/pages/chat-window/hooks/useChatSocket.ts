import { useEffect, useRef } from 'react';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import {
  filesApi,
  getBaseUrl,
  getSocketUrl,
  navigateToLogin,
  roomsApi,
  type Message,
  type ReactionGroup,
  type Room,
} from '../../../api';
import { playNotificationSound } from '../../../utils/notificationSound';
import { useMainSocketStore } from '../../../store';

type MessagesPage = { messages: Message[]; nextCursor: string | null; hasMore: boolean };

type UseChatSocketParams = {
  token: string | null;
  roomId?: string;
  embedded?: boolean;
  room?: Room;
  myId?: string;
  socketRef: React.MutableRefObject<Socket | null>;
  setSocket: (next: Socket | null) => void;
  queryClient: QueryClient;
};

export function useChatSocket({
  token,
  roomId,
  embedded,
  room,
  myId,
  socketRef,
  setSocket,
  queryClient,
}: UseChatSocketParams) {
  const myIdRef = useRef<string | undefined>(myId);
  const roomNameRef = useRef<string>('');
  const roomIsTopicRef = useRef<boolean>(false);
  const lastMarkReadRef = useRef<number>(0);

  myIdRef.current = myId;
  roomNameRef.current = room?.name ?? '';
  roomIsTopicRef.current = !!room?.isTopic;

  // 메인 창 "안"(임베디드)에서 대화방을 열 때는 메인 창의 소켓 연결 1개를 그대로
  // 재사용한다 — 같은 창 안에서 소켓 연결이 중복 생성되는 걸 막기 위함(보안 점검
  // 14번). 팝업(별도) 대화창은 별도 Electron 프로세스라 공유가 불가능해 기존처럼
  // 자체 연결을 쓴다.
  const sharedSocket = useMainSocketStore((s) => s.socket);

  useEffect(() => {
    if (!token || !roomId) return;
    if (embedded) {
      if (!sharedSocket) return; // 메인 소켓이 아직 연결되기 전 — 연결되면 effect가 다시 실행됨
    } else if (socketRef.current?.connected) {
      return;
    }

    const ownsConnection = !embedded;
    const s = ownsConnection ? io(getSocketUrl(), { path: '/socket.io', auth: { token } }) : sharedSocket!;
    socketRef.current = s;

    const handleConnectError = (err: { message?: string }) => {
      if (err?.message?.includes('invalid token')) {
        try {
          localStorage.setItem('forcedLogoutMessage', '다른 기기에서 로그인되어 로그아웃되었습니다.');
          localStorage.removeItem('token');
          if (typeof window !== 'undefined') navigateToLogin();
        } catch {
          // ignore
        }
      }
    };

    const handleError = (payload: { code?: string; message?: string }) => {
      console.error('[Socket error]', payload);
    };

    const handleConnect = () => s.emit('join_room', roomId);

    const handleMessage = (msg: Message) => {
      if (msg.roomId !== roomId) return;
      const withDefaults = { ...msg, readCount: msg.readCount ?? 0, reactions: msg.reactions ?? [], poll: msg.poll ?? null };
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return { pages: [{ messages: [withDefaults], nextCursor: null, hasMore: false }], pageParams: [undefined] };
          const firstPage = old.pages[0];
          if (firstPage?.messages?.some((m) => m.id === msg.id)) return old;
          const updatedFirst = { ...firstPage, messages: [withDefaults, ...(firstPage.messages ?? [])] };
          return { ...old, pages: [updatedFirst, ...old.pages.slice(1, 5)] };
        }
      );

      // 방 목록만 갱신 (메시지 refetch 시 소켓으로 받은 새 메시지가 덮어써져 사라지는 문제 방지)
      // 임베디드일 때는 공유 소켓의 'message' 핸들러(useMainSocket)가 이미 방 목록을 갱신하므로 생략.
      const uid = myIdRef.current;
      if (!embedded && uid) queryClient.refetchQueries({ queryKey: ['rooms', uid] });

      if (msg.senderId !== myIdRef.current) {
        const now = Date.now();
        if (now - lastMarkReadRef.current > 1000) {
          lastMarkReadRef.current = now;
          roomsApi.markRead(roomId).catch(() => {});
        }

        // 별도 채팅 창: 창이 백그라운드일 때 알림 표시 (Main에 소켓이 없을 수 있음)
        if (!embedded && typeof document !== 'undefined' && document.hidden) {
          try {
            const snoozed = Number(localStorage.getItem('notificationsSnoozedUntil') || 0);
            const mutedRaw = localStorage.getItem('mutedRoomIds');
            const muted = mutedRaw ? new Set(JSON.parse(mutedRaw).map(String)) : new Set();
            if (snoozed > Date.now() || muted.has(String(msg.roomId))) return;

            const senderName = msg.sender?.name ?? '알 수 없음';
            const isTopic = roomIsTopicRef.current;
            const roomName = roomNameRef.current;
            const title = isTopic && roomName ? `${roomName} 아젠다` : senderName;
            const body = isTopic && roomName
              ? `${senderName}: ${msg.fileUrl && msg.fileName ? msg.fileName : msg.content}`
              : (msg.fileUrl && msg.fileName ? msg.fileName : msg.content);
            playNotificationSound();
            const electronAPI = window.electronAPI;

            if (electronAPI?.showNotification) {
              (async () => {
                try {
                  let icon: string | null = null;
                  let imagePreview: string | null = null;
                  const base = getBaseUrl();
                  if (token && base) {
                    try {
                      if (isTopic && msg.roomId && electronAPI.fetchRoomAvatar) {
                        icon = await Promise.race([
                          electronAPI.fetchRoomAvatar(msg.roomId, base, token),
                          new Promise<null>((r) => setTimeout(() => r(null), 250)),
                        ]);
                      } else if (msg.senderId && electronAPI.fetchUserAvatar) {
                        icon = await Promise.race([
                          electronAPI.fetchUserAvatar(msg.senderId, base, token),
                          new Promise<null>((r) => setTimeout(() => r(null), 250)),
                        ]);
                      }
                    } catch {
                      // ignore
                    }
                  }
                  if (msg.fileUrl && msg.fileMimeType?.startsWith('image/')) {
                    try {
                      const blob = await Promise.race([
                        filesApi.fetchBlob(msg.id),
                        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 400)),
                      ]);
                      imagePreview = await new Promise<string>((resolve, reject) => {
                        const r = new FileReader();
                        r.onload = () => resolve(r.result as string);
                        r.onerror = () => reject(new Error('read failed'));
                        r.readAsDataURL(blob);
                      });
                      if (imagePreview.length > 80 * 1024) imagePreview = null;
                    } catch {
                      // ignore
                    }
                  }
                  electronAPI.showNotification(title, body, msg.roomId, icon, imagePreview);
                } catch {
                  electronAPI.showNotification(title, body, msg.roomId);
                }
              })();
            } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              new Notification(title, { body });
            }
          } catch {
            // ignore
          }
        }
      }
    };

    const handleMessageUpdated = (payload: { id: string; roomId: string; content: string; editedAt: string }) => {
      if (payload.roomId !== roomId) return;
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
          return { ...old, pages: old.pages.map((page) => ({ ...page, messages: (page.messages ?? []).map((m) => m.id === payload.id ? { ...m, content: payload.content, editedAt: payload.editedAt } : m) })) };
        }
      );
    };

    const handleMessageDeleted = (payload: { id: string; roomId: string }) => {
      if (payload.roomId !== roomId) return;
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
          return { ...old, pages: old.pages.map((page) => ({ ...page, messages: (page.messages ?? []).map((m) => m.id === payload.id ? { ...m, content: '[삭제된 메시지]', deletedAt: new Date().toISOString() } : m) })) };
        }
      );
    };

    const handleReactionUpdated = (payload: { messageId: string; reactions: ReactionGroup[] }) => {
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
          return { ...old, pages: old.pages.map((page) => ({ ...page, messages: (page.messages ?? []).map((m) => m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m) })) };
        }
      );
    };

    const handlePollVoted = (payload: { messageId?: string; id: string; question: string; isMultiple: boolean; options: Array<{ id: string; text: string; voteCount: number; voterIds: string[] }> }) => {
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: (page.messages ?? []).map((m) => {
                if (m.poll && m.poll.id === payload.id) {
                  return { ...m, poll: { ...m.poll, options: payload.options } };
                }
                return m;
              }),
            })),
          };
        }
      );
    };

    const handleMessagePinned = () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'pins'] });
    };
    const handleMessageUnpinned = () => {
      queryClient.invalidateQueries({ queryKey: ['rooms', roomId, 'pins'] });
    };
    const handleMembersAdded = (payload: { roomId: string }) => {
      if (payload.roomId === roomId) {
        queryClient.refetchQueries({ queryKey: ['rooms', roomId] });
        queryClient.refetchQueries({ queryKey: ['rooms'] });
      }
    };
    const handleMemberLeft = () => {
      queryClient.refetchQueries({ queryKey: ['rooms', roomId] });
      queryClient.refetchQueries({ queryKey: ['rooms', roomId, 'messages'] });
    };

    const handleProjectEvent = () => {
      queryClient.invalidateQueries({ queryKey: ['projects', roomId] });
    };

    const handleRoomRead = (payload: { roomId: string; userId: string }) => {
      if (payload.roomId !== roomId || payload.userId === myIdRef.current) return;
      queryClient.setQueryData<InfiniteData<MessagesPage>>(
        ['rooms', roomId, 'messages'],
        (old) => {
          if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              messages: (page.messages ?? []).map((m) =>
                m.senderId === myIdRef.current ? { ...m, readCount: Math.max(m.readCount ?? 0, 1) } : m
              ),
            })),
          };
        }
      );
      queryClient.refetchQueries({ queryKey: ['rooms', roomId, 'messages'] });
    };

    const handleMention = (payload: { roomId: string; senderName: string; content: string }) => {
      playNotificationSound();
      window.electronAPI?.showNotification(
        `${payload.senderName}님이 회원님을 멘션했습니다`,
        payload.content
      );
    };

    // 팝업 대화창은 자체 연결이라, 끊겼다 복구된 뒤 놓친 메시지를 직접 다시
    // 불러와야 한다(메인 창 공유 소켓은 useMainSocket에서 따로 처리).
    const handleReconnect = () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    };

    if (ownsConnection) {
      s.on('connect_error', handleConnectError);
      s.on('error', handleError);
      s.on('connect', handleConnect);
      s.io.on('reconnect', handleReconnect);
    } else if (s.connected) {
      s.emit('join_room', roomId);
    } else {
      s.once('connect', handleConnect);
    }
    s.on('message', handleMessage);
    s.on('message_updated', handleMessageUpdated);
    s.on('message_deleted', handleMessageDeleted);
    s.on('reaction_updated', handleReactionUpdated);
    s.on('poll_voted', handlePollVoted);
    s.on('message_pinned', handleMessagePinned);
    s.on('message_unpinned', handleMessageUnpinned);
    s.on('members_added', handleMembersAdded);
    s.on('member_left', handleMemberLeft);
    s.on('project_updated', handleProjectEvent);
    s.on('task_created', handleProjectEvent);
    s.on('task_updated', handleProjectEvent);
    s.on('task_moved', handleProjectEvent);
    s.on('task_deleted', handleProjectEvent);
    s.on('room_read', handleRoomRead);
    s.on('mention', handleMention);

    setSocket(s);

    return () => {
      if (ownsConnection) {
        s.removeAllListeners();
        s.io.off('reconnect', handleReconnect);
        s.disconnect();
      } else {
        s.off('connect', handleConnect);
        s.off('message', handleMessage);
        s.off('message_updated', handleMessageUpdated);
        s.off('message_deleted', handleMessageDeleted);
        s.off('reaction_updated', handleReactionUpdated);
        s.off('poll_voted', handlePollVoted);
        s.off('message_pinned', handleMessagePinned);
        s.off('message_unpinned', handleMessageUnpinned);
        s.off('members_added', handleMembersAdded);
        s.off('member_left', handleMemberLeft);
        s.off('project_updated', handleProjectEvent);
        s.off('task_created', handleProjectEvent);
        s.off('task_updated', handleProjectEvent);
        s.off('task_moved', handleProjectEvent);
        s.off('task_deleted', handleProjectEvent);
        s.off('room_read', handleRoomRead);
        s.off('mention', handleMention);
      }
      socketRef.current = null;
      setSocket(null);
    };
  }, [token, roomId, embedded, queryClient, setSocket, socketRef, sharedSocket]);
}
