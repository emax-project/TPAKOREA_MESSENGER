import { describe, expect, it, vi } from 'vitest';
import { createIpcSocketProxy, type RelayEvent, type RelayRequest, type RelayResponse, type SocketRelayApi } from './ipcSocketProxy';

function fakeApi() {
  const requests: RelayRequest[] = [];
  let onResponse: (m: RelayResponse) => void = () => {};
  let onEvent: (m: RelayEvent) => void = () => {};
  const api: SocketRelayApi = {
    available: async () => true,
    request: (m) => requests.push(m),
    onResponse: (cb) => ((onResponse = cb), () => {}),
    onEvent: (cb) => ((onEvent = cb), () => {}),
  };
  return { api, requests, respond: (m: RelayResponse) => onResponse(m), event: (e: string, ...args: unknown[]) => onEvent({ event: e, args }) };
}

describe('createIpcSocketProxy', () => {
  it('메인 창 상태가 연결이면 ready 후 connect를 알린다', async () => {
    const f = fakeApi();
    const { socket, ready } = createIpcSocketProxy(f.api);
    const onConnect = vi.fn();
    socket.on('connect', onConnect);
    expect(f.requests[0].op).toBe('status');
    f.respond({ reqId: f.requests[0].reqId, connected: true });
    await expect(ready).resolves.toBe(true);
    expect(socket.connected).toBe(true);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it('메인 창이 상태 요청에 오류로 답하면 ready는 false다(자체 연결로 대체)', async () => {
    const f = fakeApi();
    const { ready } = createIpcSocketProxy(f.api);
    f.respond({ reqId: f.requests[0].reqId, error: 'RELAY_UNAVAILABLE' });
    await expect(ready).resolves.toBe(false);
  });

  it('서버 이벤트를 구독자에게 전달하고 off로 해제된다', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    const fn = vi.fn();
    socket.on('message', fn);
    f.event('message', { id: 1 });
    socket.off('message', fn);
    f.event('message', { id: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ id: 1 });
  });

  it('once는 한 번만 호출되고 원래 함수로 off할 수 있다', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    const a = vi.fn();
    const b = vi.fn();
    socket.once('connect', a);
    socket.once('connect', b);
    socket.off('connect', b);
    f.event('__connect');
    f.event('__connect');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('끊겼다 다시 연결되면 reconnect 리스너를 호출한다(최초 연결은 제외)', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    const onReconnect = vi.fn();
    socket.io.on('reconnect', onReconnect);
    f.event('__connect');
    expect(onReconnect).not.toHaveBeenCalled();
    f.event('__disconnect', 'transport close');
    expect(socket.connected).toBe(false);
    f.event('__connect');
    expect(socket.connected).toBe(true);
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('timeout().emit은 응답 args를 (null, ...res)로 돌려준다', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    const cb = vi.fn();
    socket.timeout(8000).emit('message', { text: 'hi' }, cb);
    const req = f.requests[f.requests.length - 1];
    expect(req).toMatchObject({ op: 'emit', event: 'message', wantsAck: true, ackTimeoutMs: 8000, args: [{ text: 'hi' }] });
    f.respond({ reqId: req.reqId, args: [{ ok: true }] });
    expect(cb).toHaveBeenCalledWith(null, { ok: true });
  });

  it('timeout().emit은 메인 창이 오류를 돌려주면 Error로 전달한다', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    const cb = vi.fn();
    socket.timeout(8000).emit('message', {}, cb);
    f.respond({ reqId: f.requests[f.requests.length - 1].reqId, error: 'RELAY_UNAVAILABLE' });
    expect(cb.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(cb.mock.calls[0][0].message).toBe('RELAY_UNAVAILABLE');
  });

  it('ack 없는 emit은 응답을 기다리지 않는다', () => {
    const f = fakeApi();
    const { socket } = createIpcSocketProxy(f.api);
    socket.emit('join_room', 'room-1');
    expect(f.requests[f.requests.length - 1]).toMatchObject({ op: 'emit', event: 'join_room', args: ['room-1'], wantsAck: false });
  });

  it('dispose 이후에는 이벤트를 무시한다', () => {
    const f = fakeApi();
    const { socket, dispose } = createIpcSocketProxy(f.api);
    const fn = vi.fn();
    socket.on('message', fn);
    dispose();
    f.event('message', {});
    expect(fn).not.toHaveBeenCalled();
  });
});
