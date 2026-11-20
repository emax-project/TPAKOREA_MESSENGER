/**
 * 메시지 전송 확인(ack) + 자동 재전송.
 *
 * 소켓 emit은 "보냈다"만 알 뿐 서버가 저장했는지 모른다. 연결이 끊긴 사이 보낸 메시지는 조용히 사라질 수 있다.
 * 여기서는 서버의 응답(ack)을 기다리고, 응답이 없거나 연결이 끊겼으면 **같은 clientMessageId로** 다시 보낸다.
 * 서버는 같은 (보낸 사람, 키)를 한 번만 저장하므로 재전송해도 메시지가 중복되지 않는다.
 */

export type SendAck =
  | { ok: true; id: string; createdAt: string; duplicate: boolean }
  | { ok: false; code: 'INVALID' | 'NOT_MEMBER' | 'SERVER' };

export type SendErrorCode = 'INVALID' | 'NOT_MEMBER' | 'SERVER' | 'TIMEOUT' | 'OFFLINE';

export class SendError extends Error {
  readonly code: SendErrorCode;
  /** 재시도해도 소용없는 오류(내용이 잘못됐거나 방 멤버가 아님) */
  readonly permanent: boolean;
  constructor(code: SendErrorCode) {
    super(code);
    this.code = code;
    this.permanent = code === 'INVALID' || code === 'NOT_MEMBER';
  }
}

/** socket.io-client Socket 중 여기서 쓰는 부분만 */
export type SenderSocket = {
  connected: boolean;
  timeout: (ms: number) => {
    emit: (event: string, payload: unknown, cb: (err: Error | null, res?: SendAck) => void) => void;
  };
  once: (event: 'connect', fn: () => void) => unknown;
  off: (event: 'connect', fn: () => void) => unknown;
};

export type SendOptions = {
  /** 서버 응답을 기다리는 시간 */
  ackTimeoutMs?: number;
  /** 최초 전송 포함 최대 시도 횟수 */
  maxAttempts?: number;
  /** 연결이 끊겨 있을 때 재연결을 기다리는 시간(시도마다) */
  connectWaitMs?: number;
  /** 재시도 사이 대기(ms). 시도 횟수보다 짧으면 마지막 값을 반복 */
  backoffMs?: number[];
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULTS = {
  ackTimeoutMs: 8_000,
  maxAttempts: 4,
  connectWaitMs: 15_000,
  backoffMs: [1_000, 2_000, 4_000],
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 연결될 때까지 기다린다. 시간 안에 연결되면 true. */
function waitForConnect(socket: SenderSocket, ms: number): Promise<boolean> {
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onConnect = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      resolve(false);
    }, ms);
    socket.once('connect', onConnect);
  });
}

function emitWithAck(socket: SenderSocket, payload: unknown, ackTimeoutMs: number): Promise<SendAck | 'TIMEOUT'> {
  return new Promise((resolve) => {
    socket.timeout(ackTimeoutMs).emit('message', payload, (err, res) => {
      resolve(err || !res ? 'TIMEOUT' : res);
    });
  });
}

/** 전송 고유 키를 만든다(서버 규칙: 영숫자·_·- 8~64자). */
export function newClientMessageId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * payload(clientMessageId 포함)를 보내고 서버 확인을 받을 때까지 필요하면 재전송한다.
 * 성공하면 ack를, 끝내 실패하면 SendError를 던진다.
 */
export async function sendWithRetry(
  socket: SenderSocket,
  payload: { clientMessageId: string } & Record<string, unknown>,
  options: SendOptions = {},
): Promise<Extract<SendAck, { ok: true }>> {
  const o = { ...DEFAULTS, ...options };
  const sleep = o.sleep ?? defaultSleep;
  let lastFailure: SendErrorCode = 'OFFLINE';

  for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
    if (attempt > 0) await sleep(o.backoffMs[Math.min(attempt - 1, o.backoffMs.length - 1)] ?? 1_000);

    if (!(await waitForConnect(socket, o.connectWaitMs))) {
      lastFailure = 'OFFLINE';
      continue;
    }
    const res = await emitWithAck(socket, payload, o.ackTimeoutMs);
    if (res === 'TIMEOUT') {
      lastFailure = 'TIMEOUT';
      continue;
    }
    if (res.ok) return res;
    if (res.code === 'INVALID' || res.code === 'NOT_MEMBER') throw new SendError(res.code);
    lastFailure = 'SERVER';
  }
  throw new SendError(lastFailure);
}

/** 사용자에게 보여줄 실패 사유 */
export function sendErrorMessage(err: unknown): string {
  const code = err instanceof SendError ? err.code : 'SERVER';
  switch (code) {
    case 'NOT_MEMBER': return '이 대화방에 참여하고 있지 않아 보낼 수 없습니다.';
    case 'INVALID': return '보낼 수 없는 내용입니다.';
    case 'OFFLINE': return '서버에 연결되지 않아 보내지 못했습니다.';
    case 'TIMEOUT': return '서버 응답이 없어 전송을 확인하지 못했습니다.';
    default: return '서버 오류로 보내지 못했습니다.';
  }
}
