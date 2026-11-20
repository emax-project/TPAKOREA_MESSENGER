import type { Socket } from 'socket.io-client';

type RelayHostApi = NonNullable<Window['electronAPI']>['socketRelayHost'];

/**
 * 메인 창의 서버 연결(소켓)을 팝업 대화창과 같이 쓰게 연결한다. 해제 함수를 돌려준다.
 * 서버 이벤트는 Electron 메인 프로세스를 거쳐 팝업으로 전달하고,
 * 팝업이 보낸 emit(메시지 전송, 방 입장 등)은 이 연결로 대신 보낸다.
 */
export function attachSocketRelayHost(socket: Socket, relay: NonNullable<RelayHostApi>): () => void {
  relay.register();

  const offRequest = relay.onRequest((req) => {
    if (req.op === 'status') {
      relay.respond({ to: req.from, reqId: req.reqId, connected: socket.connected });
      return;
    }
    if (req.op !== 'emit' || typeof req.event !== 'string') return;
    const args = Array.isArray(req.args) ? req.args : [];
    if (!req.wantsAck) {
      socket.emit(req.event, ...args);
      return;
    }
    const reply = (error: string | undefined, ackArgs: unknown[]) =>
      relay.respond({ to: req.from, reqId: req.reqId, error, args: ackArgs });
    if (req.ackTimeoutMs) {
      socket.timeout(req.ackTimeoutMs).emit(req.event, ...args, (err: Error | null, ...res: unknown[]) => reply(err?.message, res));
    } else {
      socket.emit(req.event, ...args, (...res: unknown[]) => reply(undefined, res));
    }
  });

  const onAny = (event: string, ...args: unknown[]) => relay.sendEvent({ event, args });
  const onConnect = () => relay.sendEvent({ event: '__connect', args: [] });
  const onDisconnect = (reason: string) => relay.sendEvent({ event: '__disconnect', args: [reason] });

  socket.onAny(onAny);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  if (socket.connected) onConnect();

  return () => {
    offRequest();
    socket.offAny(onAny);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    relay.unregister();
  };
}
