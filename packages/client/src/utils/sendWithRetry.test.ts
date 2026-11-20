import { describe, expect, it } from 'vitest';
import { SendError, newClientMessageId, sendErrorMessage, sendWithRetry, type SendAck, type SenderSocket } from './sendWithRetry';

type Step = SendAck | 'TIMEOUT';

/** 시나리오(순서대로 ack/timeout)를 재생하는 가짜 소켓 */
function fakeSocket(steps: Step[], opts: { connected?: boolean; connectAfterMs?: number } = {}) {
  const sent: unknown[] = [];
  let connectHandler: (() => void) | null = null;
  const socket: SenderSocket & { calls: number } = {
    connected: opts.connected ?? true,
    calls: 0,
    timeout: () => ({
      emit: (_event, payload, cb) => {
        socket.calls += 1;
        sent.push(payload);
        const step = steps.shift() ?? 'TIMEOUT';
        if (step === 'TIMEOUT') cb(new Error('timeout'));
        else cb(null, step);
      },
    }),
    once: (_e, fn) => { connectHandler = fn; },
    off: () => { connectHandler = null; },
  };
  if (opts.connected === false && opts.connectAfterMs != null) {
    setTimeout(() => { socket.connected = true; connectHandler?.(); }, opts.connectAfterMs);
  }
  return { socket, sent };
}

const ACK: SendAck = { ok: true, id: 'm1', createdAt: '2026-01-01T00:00:00Z', duplicate: false };
const payload = { roomId: 'r', content: 'hi', clientMessageId: 'cid-12345678' };
const fast = { backoffMs: [0], sleep: () => Promise.resolve(), connectWaitMs: 30, ackTimeoutMs: 30 };

describe('sendWithRetry', () => {
  it('첫 시도에 ack를 받으면 한 번만 보낸다', async () => {
    const { socket, sent } = fakeSocket([ACK]);
    await expect(sendWithRetry(socket, payload, fast)).resolves.toEqual(ACK);
    expect(sent).toHaveLength(1);
  });

  it('응답이 없으면 같은 clientMessageId로 재전송해 성공한다', async () => {
    const { socket, sent } = fakeSocket(['TIMEOUT', 'TIMEOUT', { ...ACK, duplicate: true }]);
    const res = await sendWithRetry(socket, payload, fast);
    expect(res.duplicate).toBe(true);
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map((p) => (p as typeof payload).clientMessageId))).toEqual(new Set(['cid-12345678']));
  });

  it('한도까지 실패하면 TIMEOUT 오류(재시도 가능)', async () => {
    const { socket } = fakeSocket([]);
    const err = await sendWithRetry(socket, payload, { ...fast, maxAttempts: 3 }).catch((e) => e);
    expect(err).toBeInstanceOf(SendError);
    expect(err.code).toBe('TIMEOUT');
    expect(err.permanent).toBe(false);
    expect(socket.calls).toBe(3);
  });

  it('NOT_MEMBER·INVALID는 재시도하지 않고 바로 실패', async () => {
    for (const code of ['NOT_MEMBER', 'INVALID'] as const) {
      const { socket } = fakeSocket([{ ok: false, code }, ACK]);
      const err = await sendWithRetry(socket, payload, fast).catch((e) => e);
      expect(err.code).toBe(code);
      expect(err.permanent).toBe(true);
      expect(socket.calls).toBe(1);
    }
  });

  it('SERVER 오류는 재시도한다', async () => {
    const { socket } = fakeSocket([{ ok: false, code: 'SERVER' }, ACK]);
    await expect(sendWithRetry(socket, payload, fast)).resolves.toEqual(ACK);
    expect(socket.calls).toBe(2);
  });

  it('연결이 끊겨 있으면 보내지 않고 기다렸다가 재연결 후 전송한다', async () => {
    const { socket, sent } = fakeSocket([ACK], { connected: false, connectAfterMs: 10 });
    await expect(sendWithRetry(socket, payload, { ...fast, connectWaitMs: 200 })).resolves.toEqual(ACK);
    expect(sent).toHaveLength(1);
  });

  it('끝까지 연결되지 않으면 OFFLINE 오류, 한 번도 emit하지 않는다', async () => {
    const { socket } = fakeSocket([ACK], { connected: false });
    const err = await sendWithRetry(socket, payload, { ...fast, maxAttempts: 2 }).catch((e) => e);
    expect(err.code).toBe('OFFLINE');
    expect(socket.calls).toBe(0);
  });

  it('재시도 사이에 backoff 대기를 한다', async () => {
    const waits: number[] = [];
    const { socket } = fakeSocket(['TIMEOUT', 'TIMEOUT', 'TIMEOUT', ACK]);
    await sendWithRetry(socket, payload, { ...fast, backoffMs: [100, 200], sleep: async (ms) => { waits.push(ms); } });
    expect(waits).toEqual([100, 200, 200]);
  });
});

describe('보조 함수', () => {
  it('전송 키는 서버 규칙(영숫자·_·- 8~64자)을 만족하고 매번 다르다', () => {
    const a = newClientMessageId();
    const b = newClientMessageId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(a).not.toBe(b);
  });

  it('실패 사유 문구', () => {
    expect(sendErrorMessage(new SendError('NOT_MEMBER'))).toMatch(/참여/);
    expect(sendErrorMessage(new SendError('OFFLINE'))).toMatch(/연결/);
    expect(sendErrorMessage(new Error('x'))).toMatch(/서버 오류/);
  });
});
