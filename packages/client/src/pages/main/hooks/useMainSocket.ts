import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { filesApi, getBaseUrl, getSocketUrl, navigateToLogin, type Message, type Room } from '../../../api';
import { useMainSocketStore } from '../../../store';
import { playNotificationSound } from '../../../utils/notificationSound';
import {
  detectClientDevice,
  mergePresence,
  presenceFromList,
  removePresence,
  type OnlinePresenceMap,
} from '../../../utils/presence';

type MessagesPage = { messages: Message[]; nextCursor: string | null; hasMore: boolean };

type UseMainSocketParams = {
  token: string | null;
  queryClient: QueryClient;
  myIdRef: MutableRefObject<string | undefined>;
  recentTopicRoomRef: MutableRefObject<{ id: string; at: number } | null>;
  mutedRoomIdsRef: MutableRefObject<Set<string>>;
  notificationsSnoozedUntilRef: MutableRefObject<number>;
  setOnlineUserIds: Dispatch<SetStateAction<Set<string>>>;
  setOnlinePresence: Dispatch<SetStateAction<OnlinePresenceMap>>;
  setSocketConnected: Dispatch<SetStateAction<boolean>>;
  setSocket: Dispatch<SetStateAction<Socket | null>>;
  socketRef: MutableRefObject<Socket | null>;
  allRooms: Room[];
  socket: Socket | null;
  socketConnected: boolean;
};

export function useMainSocket({
  token,
  queryClient,
  myIdRef,
  recentTopicRoomRef,
  mutedRoomIdsRef,
  notificationsSnoozedUntilRef,
  setOnlineUserIds,
  setOnlinePresence,
  setSocketConnected,
  setSocket,
  socketRef,
  allRooms,
  socket,
  socketConnected,
}: UseMainSocketParams) {
  useEffect(() => {
    if (!token) return;
    if (socketRef.current?.connected) return;
    const url = getSocketUrl();
    const device = detectClientDevice();
    const s = io(url, { path: '/socket.io', auth: { token, device } });
    socketRef.current = s;
    s.on('connect_error', (err: { message?: string }) => {
      if (err?.message?.includes('invalid token')) {
        try {
          localStorage.setItem('forcedLogoutMessage', '다른 기기에서 로그인되어 로그아웃되었습니다.');
          localStorage.removeItem('token');
          if (typeof window !== 'undefined') navigateToLogin();
        } catch {
          // ignore
        }
      }
    });
    s.on('connect', () => {
      setSocketConnected(true);
      if (myIdRef.current) {
        const uid = String(myIdRef.current);
        setOnlineUserIds((prev) => new Set([...prev, uid]));
        setOnlinePresence((prev) => mergePresence(prev, uid, null, device));
      }
    });
    s.on('disconnect', () => {
      setSocketConnected(false);
    });
    // 네트워크가 끊겼다 복구된 뒤에는 그 사이 놓친 메시지가 있을 수 있어
    // 대화방 목록·현재 열려 있는 대화방의 메시지를 다시 불러온다. 열려 있지
    // 않은 방 쿼리는 React Query가 그냥 stale 표시만 하고 실제 재요청은
    // 안 하므로(비활성 쿼리), 불필요한 서버 부하 없이 보이는 것만 보정된다.
    const handleReconnect = () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] });
    };
    s.io.on('reconnect', handleReconnect);
    s.on('message', (msg: Message) => {
      const withReadCount = { ...msg, readCount: msg.readCount ?? 0 };
      queryClient.setQueryData<InfiniteData<MessagesPage>>(['rooms', msg.roomId, 'messages'], (old) => {
        if (!old?.pages?.length) return { pages: [{ messages: [withReadCount], nextCursor: null, hasMore: false }], pageParams: [undefined] };
        const firstPage = old.pages[0];
        if (firstPage?.messages?.some((m) => m.id === msg.id)) return old;
        const updatedFirst = { ...firstPage, messages: [withReadCount, ...(firstPage.messages ?? [])] };
        return { ...old, pages: [updatedFirst, ...old.pages.slice(1, 5)] };
      });
      (async () => {
        const myId = myIdRef.current;
        if (!myId) return;
        await queryClient.refetchQueries({ queryKey: ['rooms', myId] });
        const rooms = queryClient.getQueryData<Room[]>(['rooms', myId]) ?? [];
        const recent = recentTopicRoomRef.current;
        const fixed =
          recent && recent.id === msg.roomId && Date.now() - recent.at < 5000
            ? rooms.map((r) => (r.id === recent.id ? { ...r, isTopic: true, isGroup: true } : r))
            : rooms;
        if (fixed !== rooms) queryClient.setQueryData(['rooms', myId], fixed);
        if (recent?.id === msg.roomId) recentTopicRoomRef.current = null;
      })();
      if (msg.senderId !== myIdRef.current) {
        if (notificationsSnoozedUntilRef.current > Date.now()) return;
        if (mutedRoomIdsRef.current.has(String(msg.roomId))) return;
        try {
          const activeRoomId = localStorage.getItem('activeChatRoomId');
          const activeFocused = localStorage.getItem('activeChatFocused');
          if (activeFocused != null && activeFocused !== '0' && activeFocused !== '1') {
            localStorage.removeItem('activeChatFocused');
            localStorage.removeItem('activeChatRoomId');
          } else if (activeRoomId === msg.roomId && activeFocused === '1') return;
        } catch {
          // ignore
        }
        const senderName = msg.sender?.name ?? '알 수 없음';
        const rooms = queryClient.getQueryData<Room[]>(['rooms', myIdRef.current]) ?? [];
        const room = rooms.find((r) => r.id === msg.roomId);
        const isTopic = !!room?.isTopic;
        const roomName = room?.name ?? '';
        const title = isTopic && roomName ? `${roomName} 아젠다` : senderName;
        const body = isTopic && roomName ? `${senderName}: ${msg.fileUrl && msg.fileName ? msg.fileName : msg.content}` : (msg.fileUrl && msg.fileName ? msg.fileName : msg.content);
        playNotificationSound();
        const electronAPI = window.electronAPI;
        if (electronAPI?.showNotification) {
          (async () => {
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
                    electronAPI.fetchUserAvatar(msg.senderId),
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
            try {
              electronAPI.showNotification(title, body, msg.roomId, icon, imagePreview);
            } catch {
              electronAPI.showNotification(title, body, msg.roomId);
            }
          })();
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          if (typeof document !== 'undefined' && document.hidden) new Notification(title, { body });
        }
      }
    });
    s.on('room_read', (payload: { roomId: string; userId: string }) => {
      const uid = myIdRef.current;
      if (payload.userId === uid) {
        if (uid) queryClient.refetchQueries({ queryKey: ['rooms', uid] });
        return;
      }
      queryClient.setQueryData<InfiniteData<MessagesPage>>(['rooms', payload.roomId, 'messages'], (old) => {
        if (!old?.pages?.length) return old ?? { pages: [], pageParams: [] };
        return { ...old, pages: old.pages.map((p) => ({ ...p, messages: (p.messages ?? []).map((m) => m.senderId === myIdRef.current ? { ...m, readCount: Math.max(m.readCount ?? 0, 1) } : m) })) };
      });
      if (uid) queryClient.refetchQueries({ queryKey: ['rooms', uid] });
    });
    s.on('members_added', () => {
      const uid = myIdRef.current;
      if (uid) queryClient.refetchQueries({ queryKey: ['rooms', uid] });
    });
    s.on('online_list', (payload: { userIds?: string[]; presence?: OnlinePresenceMap }) => {
      const map = presenceFromList(payload.userIds, payload.presence);
      setOnlinePresence(map);
      setOnlineUserIds(new Set(Object.keys(map).filter((id) => map[id].desktop || map[id].mobile)));
    });
    s.on('user_online', (payload: {
      userId?: string;
      userName?: string | null;
      device?: 'desktop' | 'mobile';
      devices?: { desktop: boolean; mobile: boolean };
    }) => {
      if (payload.userId) {
        const uid = String(payload.userId);
        setOnlinePresence((prev) => mergePresence(prev, uid, payload.devices ?? null, payload.device));
        setOnlineUserIds((prev) => new Set([...prev, uid]));
      }
      if (payload.userId && String(payload.userId) !== String(myIdRef.current)) {
        const name = payload.userName?.trim() || '누군가';
        const title = 'TPA-Korea';
        const body = `${name}님이 로그인했습니다.`;
        if (window.electronAPI?.showNotification) {
          window.electronAPI.showNotification(title, body);
        } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          new Notification(title, { body });
        }
      }
    });
    s.on('user_presence', (payload: {
      userId?: string;
      device?: 'desktop' | 'mobile';
      devices?: { desktop: boolean; mobile: boolean };
    }) => {
      if (!payload.userId) return;
      const uid = String(payload.userId);
      setOnlinePresence((prev) => mergePresence(prev, uid, payload.devices ?? null, payload.device));
      setOnlineUserIds((prev) => {
        const devices = payload.devices;
        const next = new Set(prev);
        if (devices && !devices.desktop && !devices.mobile) next.delete(uid);
        else next.add(uid);
        return next;
      });
    });
    s.on('user_offline', (payload: { userId?: string }) => {
      if (payload.userId) {
        const uid = String(payload.userId);
        setOnlinePresence((prev) => removePresence(prev, uid));
        setOnlineUserIds((prev) => {
          const next = new Set(prev);
          next.delete(uid);
          return next;
        });
      }
    });
    s.on('memo', (payload: { memoId?: string; subject?: string; senderName?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['memos'] });
      if (notificationsSnoozedUntilRef.current > Date.now()) return;
      const title = payload.senderName ? `쪽지: ${payload.senderName}` : '새 쪽지';
      const body = payload.subject || '';
      playNotificationSound();
      const electronAPI = window.electronAPI;
      if (electronAPI?.showNotification) {
        electronAPI.showNotification(title, body);
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        new Notification(title, { body });
      }
    });
    s.on('connect', () => {
      s.emit('get_online_list');
    });
    s.on('user_status_changed', () => {
      queryClient.invalidateQueries({ queryKey: ['org'] });
    });
    s.on('member_left', () => {
      queryClient.refetchQueries({ queryKey: ['rooms'] });
    });
    setSocket(s);
    useMainSocketStore.getState().setMainSocket(s);
    return () => {
      s.removeAllListeners();
      s.io.off('reconnect', handleReconnect); // 'reconnect'는 소켓이 아니라 매니저(s.io)에 붙는 이벤트라 별도로 떼야 함
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
      useMainSocketStore.getState().setMainSocket(null);
      setSocketConnected(false);
    };
  }, [token, queryClient, myIdRef, recentTopicRoomRef, notificationsSnoozedUntilRef, mutedRoomIdsRef, setOnlineUserIds, setOnlinePresence, setSocket, setSocketConnected, socketRef]);

  useEffect(() => {
    if (!socket || !socketConnected || !allRooms.length) return;
    allRooms.forEach((r) => socket.emit('join_room', r.id));
  }, [socket, socketConnected, allRooms]);
}
