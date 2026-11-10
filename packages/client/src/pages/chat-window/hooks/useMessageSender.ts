import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { newClientMessageId, sendErrorMessage, sendWithRetry, SendError, type SendOptions, type SenderSocket } from '../../../utils/sendWithRetry';

export type OutgoingPayload = {
  roomId: string;
  content: string;
  replyToId?: string;
  context?: { filePath?: string; line?: number; branch?: string };
  sharedEvent?: { title: string; startAt: string; endAt: string; description?: string };
};

export type PendingSend = {
  /** 전송 고유 키(clientMessageId) — 재시도해도 같은 값이라 서버가 중복 저장하지 않는다 */
  key: string;
  payload: OutgoingPayload & { clientMessageId: string };
  /** 목록에 보여줄 한 줄 미리보기 */
  preview: string;
  status: 'sending' | 'failed';
  /** 한동안 확인이 안 될 때만 "전송 중"을 보여주려는 표시(순식간에 끝나는 전송은 깜빡이지 않게) */
  slow: boolean;
  error?: string;
  /** 다시 보내도 소용없는 실패(방 멤버가 아님 등) */
  permanent?: boolean;
};

const SLOW_AFTER_MS = 1_500;

function previewOf(p: OutgoingPayload): string {
  if (p.content) return p.content.length > 60 ? `${p.content.slice(0, 60)}…` : p.content;
  return p.sharedEvent ? `[일정] ${p.sharedEvent.title}` : '(내용 없음)';
}

/**
 * 채팅 메시지 전송 — 서버 확인(ack)을 기다리고, 끊기거나 응답이 없으면 같은 키로 자동 재전송한다.
 * 확인이 끝내 안 되면 목록에 "전송 실패"로 남겨 사용자가 다시 보내거나 지울 수 있다.
 * 전송이 연결 복구까지 길어질 수 있으므로 이 훅은 방을 나가도(언마운트) 진행 중인 전송은 계속하되
 * 화면 상태만 갱신하지 않는다.
 */
export function useMessageSender(socketRef: MutableRefObject<Socket | null>, options?: SendOptions) {
  const [pending, setPending] = useState<PendingSend[]>([]);
  // 재시도에 쓸 원본(key → 항목). 상태 업데이터 안에서 부수 효과를 일으키지 않으려고 따로 보관한다.
  const itemsRef = useRef(new Map<string, PendingSend>());
  const mounted = useRef(true);
  // StrictMode(개발)는 마운트→정리→재마운트를 하므로 마운트 때 true로 되돌려야 한다
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const patch = useCallback((key: string, change: Partial<PendingSend> | null) => {
    if (change === null) itemsRef.current.delete(key);
    if (!mounted.current) return;
    setPending((list) => (change === null ? list.filter((p) => p.key !== key) : list.map((p) => (p.key === key ? { ...p, ...change } : p))));
  }, []);

  const run = useCallback(async (item: PendingSend) => {
    const socket = socketRef.current as unknown as SenderSocket | null;
    patch(item.key, { status: 'sending', slow: false, error: undefined });
    const slowTimer = setTimeout(() => patch(item.key, { slow: true }), SLOW_AFTER_MS);
    try {
      if (!socket) throw new SendError('OFFLINE');
      await sendWithRetry(socket, item.payload, options);
      patch(item.key, null);
    } catch (err) {
      patch(item.key, {
        status: 'failed',
        slow: true,
        error: sendErrorMessage(err),
        permanent: err instanceof SendError ? err.permanent : false,
      });
    } finally {
      clearTimeout(slowTimer);
    }
  }, [socketRef, patch, options]);

  /** 메시지를 보낸다. 반환값은 이번 전송의 고유 키. */
  const send = useCallback((payload: OutgoingPayload): string => {
    const key = newClientMessageId();
    const item: PendingSend = {
      key,
      payload: { ...payload, clientMessageId: key },
      preview: previewOf(payload),
      status: 'sending',
      slow: false,
    };
    itemsRef.current.set(key, item);
    setPending((list) => [...list, item]);
    void run(item);
    return key;
  }, [run]);

  /** 실패한 메시지를 같은 키로 다시 보낸다 */
  const retry = useCallback((key: string) => {
    const item = itemsRef.current.get(key);
    if (item) void run(item);
  }, [run]);

  const dismiss = useCallback((key: string) => patch(key, null), [patch]);

  return { pending, send, retry, dismiss };
}
