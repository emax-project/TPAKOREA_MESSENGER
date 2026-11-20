import type { Socket } from 'socket.io-client';

/**
 * 팝업 대화창용 소켓 대리 객체.
 *
 * 팝업 대화창은 별도 Electron 프로세스라 메인 창의 소켓을 직접 쓸 수 없다. 그래서 서버 연결은
 * 메인 창 하나만 유지하고, 팝업은 이 객체로 메인 프로세스(IPC)를 거쳐 이벤트를 받고 내보낸다.
 * socket.io-client Socket 중 대화창이 쓰는 부분(on/off/once/emit/timeout/connected/io.reconnect)만 구현한다.
 */

export type RelayRequest = {
  reqId: number;
  op: 'emit' | 'status';
  event?: string;
  args?: unknown[];
  wantsAck?: boolean;
  ackTimeoutMs?: number;
};
export type RelayResponse = { reqId: number; connected?: boolean; error?: string; args?: unknown[] };
export type RelayEvent = { event: string; args: unknown[] };

export type SocketRelayApi = {
  available: () => Promise<boolean>;
  request: (msg: RelayRequest) => void;
  onResponse: (cb: (msg: RelayResponse) => void) => () => void;
  onEvent: (cb: (msg: RelayEvent) => void) => () => void;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = ((...args: any[]) => void) & { __orig?: unknown };

export type IpcSocketProxy = {
  socket: Socket;
  /** 메인 창 소켓의 현재 연결 상태를 받아 온 뒤 resolve. 응답을 받지 못했으면 false(자체 연결로 대체) */
  ready: Promise<boolean>;
  dispose: () => void;
};

export function createIpcSocketProxy(api: SocketRelayApi): IpcSocketProxy {
  const listeners = new Map<string, Set<Listener>>();
  const reconnectListeners = new Set<() => void>();
  const pending = new Map<number, (res: RelayResponse) => void>();
  let connected = false;
  let everConnected = false;
  let disposed = false;
  let nextId = 1;

  const fire = (event: string, args: unknown[]) => {
    for (const fn of [...(listeners.get(event) ?? [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error('[socket-relay] listener error', err);
      }
    }
  };

  const markConnected = () => {
    const wasEver = everConnected;
    connected = true;
    everConnected = true;
    fire('connect', []);
    if (wasEver) reconnectListeners.forEach((fn) => fn());
  };

  const send = (req: Omit<RelayRequest, 'reqId'>, onResponse?: (res: RelayResponse) => void, localTimeoutMs?: number) => {
    const reqId = nextId++;
    if (onResponse) {
      pending.set(reqId, onResponse);
      if (localTimeoutMs) {
        // 메인 창이 응답하지 못하는 경우(닫힘 등)에도 호출자가 영원히 기다리지 않도록 한다
        setTimeout(() => {
          const cb = pending.get(reqId);
          if (cb) {
            pending.delete(reqId);
            cb({ reqId, error: 'RELAY_TIMEOUT' });
          }
        }, localTimeoutMs);
      }
    }
    api.request({ ...req, reqId });
  };

  const offResponse = api.onResponse((msg) => {
    const cb = pending.get(msg.reqId);
    if (!cb) return;
    pending.delete(msg.reqId);
    cb(msg);
  });

  const offEvent = api.onEvent(({ event, args }) => {
    if (disposed) return;
    if (event === '__connect') {
      markConnected();
    } else if (event === '__disconnect') {
      connected = false;
      fire('disconnect', args);
    } else {
      fire(event, args);
    }
  });

  const addListener = (event: string, fn: Listener) => {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(fn);
  };
  const removeListener = (event: string, fn: unknown) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const l of [...set]) if (l === fn || l.__orig === fn) set.delete(l);
  };

  const proxy = {
    get connected() {
      return connected;
    },
    on(event: string, fn: Listener) {
      addListener(event, fn);
      return proxy;
    },
    once(event: string, fn: Listener) {
      const wrapper: Listener = (...args) => {
        removeListener(event, wrapper);
        fn(...args);
      };
      wrapper.__orig = fn;
      addListener(event, wrapper);
      return proxy;
    },
    off(event: string, fn?: Listener) {
      if (fn) removeListener(event, fn);
      else listeners.delete(event);
      return proxy;
    },
    removeAllListeners() {
      listeners.clear();
      return proxy;
    },
    emit(event: string, ...rest: unknown[]) {
      const args = [...rest];
      const last = args[args.length - 1];
      const ack = typeof last === 'function' ? (args.pop() as (...a: unknown[]) => void) : undefined;
      send({ op: 'emit', event, args, wantsAck: !!ack }, ack ? (res) => ack(...(res.args ?? [])) : undefined);
      return proxy;
    },
    timeout(ms: number) {
      return {
        emit: (event: string, ...rest: unknown[]) => {
          const args = [...rest];
          const cb = args.pop() as (err: Error | null, ...res: unknown[]) => void;
          send(
            { op: 'emit', event, args, wantsAck: true, ackTimeoutMs: ms },
            (res) => (res.error ? cb(new Error(res.error)) : cb(null, ...(res.args ?? []))),
            ms + 3000,
          );
        },
      };
    },
    // 서버 연결은 메인 창이 소유한다. 팝업에서는 이 객체와의 연결만 정리한다.
    disconnect() {
      dispose();
      return proxy;
    },
    io: {
      on(event: string, fn: () => void) {
        if (event === 'reconnect') reconnectListeners.add(fn);
      },
      off(event: string, fn: () => void) {
        if (event === 'reconnect') reconnectListeners.delete(fn);
      },
    },
  };

  function dispose() {
    if (disposed) return;
    disposed = true;
    offResponse();
    offEvent();
    pending.clear();
    listeners.clear();
    reconnectListeners.clear();
    connected = false;
  }

  const ready = new Promise<boolean>((resolve) => {
    send({ op: 'status' }, (res) => {
      if (res.error) return resolve(false);
      if (!disposed && res.connected && !connected) markConnected();
      resolve(true);
    }, 5000);
  });

  return { socket: proxy as unknown as Socket, ready, dispose };
}
