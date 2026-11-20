// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import type { SendAck } from '../../../utils/sendWithRetry';
import { useMessageSender } from './useMessageSender';
import PendingSendBar from '../components/PendingSendBar';

type Step = SendAck | 'TIMEOUT';

/** 서버 응답을 시나리오대로 돌려주고, 보낸 payload와 연결 상태를 조작할 수 있는 가짜 소켓 */
function makeFakeSocket(steps: Step[], connected = true) {
  const sent: Array<{ clientMessageId: string; content: string }> = [];
  let onConnect: (() => void) | null = null;
  const socket = {
    connected,
    timeout: () => ({
      emit: (_e: string, payload: { clientMessageId: string; content: string }, cb: (err: Error | null, res?: SendAck) => void) => {
        sent.push(payload);
        const step = steps.shift() ?? 'TIMEOUT';
        if (step === 'TIMEOUT') cb(new Error('timeout'));
        else cb(null, step);
      },
    }),
    once: (_e: string, fn: () => void) => { onConnect = fn; },
    off: () => { onConnect = null; },
    connect() { socket.connected = true; onConnect?.(); },
  };
  return { socket, sent };
}

const ACK: SendAck = { ok: true, id: 'srv-1', createdAt: '2026-01-01T00:00:00Z', duplicate: false };
const FAST = { backoffMs: [0], sleep: () => Promise.resolve(), connectWaitMs: 80, ackTimeoutMs: 20, maxAttempts: 2 };

function Harness({ fake }: { fake: ReturnType<typeof makeFakeSocket> }) {
  const socketRef = useRef(fake.socket as unknown as Socket);
  const { pending, send, retry, dismiss } = useMessageSender(socketRef, FAST);
  return (
    <div>
      <button onClick={() => send({ roomId: 'r1', content: '안녕하세요' })}>send</button>
      <span data-testid="count">{pending.length}</span>
      <PendingSendBar items={pending} isDark={false} onRetry={retry} onDismiss={dismiss} />
    </div>
  );
}

afterEach(cleanup);

describe('useMessageSender + PendingSendBar', () => {
  it('정상 전송: 확인되면 목록에서 사라지고 표시도 깜빡이지 않는다', async () => {
    const fake = makeFakeSocket([ACK]);
    render(<Harness fake={fake} />);
    fireEvent.click(screen.getByText('send'));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].clientMessageId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(screen.queryByRole('status')?.textContent ?? '').not.toMatch(/실패|확인 중/);
  });

  it('연결이 끊긴 채 보내면 대기하다가 재연결되면 한 번만 전송된다', async () => {
    const fake = makeFakeSocket([ACK], false);
    render(<Harness fake={fake} />);
    fireEvent.click(screen.getByText('send'));
    expect(fake.sent).toHaveLength(0); // 끊긴 동안에는 emit하지 않는다
    expect(screen.getByTestId('count').textContent).toBe('1');
    await act(async () => { fake.socket.connect(); });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(fake.sent).toHaveLength(1);
  });

  it('끝내 확인이 안 되면 "전송 실패"로 남고, 다시 보내기는 같은 키로 보낸다', async () => {
    const fake = makeFakeSocket([]); // 계속 응답 없음
    render(<Harness fake={fake} />);
    fireEvent.click(screen.getByText('send'));
    await screen.findByText(/전송 실패/);
    expect(screen.getByText('안녕하세요')).toBeInTheDocument();
    const firstKey = fake.sent[0].clientMessageId;
    expect(fake.sent.every((p) => p.clientMessageId === firstKey)).toBe(true);

    fake.sent.length = 0;
    // 이번에는 서버가 "이미 저장됨(duplicate)"으로 응답 — 중복 저장 없이 성공 처리
    const retryBtn = screen.getByText('다시 보내기');
    // 시나리오 보충: 다음 emit에 duplicate ack
    const original = fake.socket.timeout;
    fake.socket.timeout = () => ({
      emit: (_e: string, payload: { clientMessageId: string; content: string }, cb: (err: Error | null, res?: SendAck) => void) => {
        fake.sent.push(payload);
        cb(null, { ...ACK, duplicate: true });
      },
    }) as ReturnType<typeof original>;
    fireEvent.click(retryBtn);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].clientMessageId).toBe(firstKey);
  });

  it('방 멤버가 아니면 재시도 버튼 없이 실패만 표시하고, 지울 수 있다', async () => {
    const fake = makeFakeSocket([{ ok: false, code: 'NOT_MEMBER' }]);
    render(<Harness fake={fake} />);
    fireEvent.click(screen.getByText('send'));
    await screen.findByText(/참여하고 있지 않아/);
    expect(screen.queryByText('다시 보내기')).toBeNull();
    expect(fake.sent).toHaveLength(1);
    fireEvent.click(screen.getByLabelText('전송 실패 메시지 지우기'));
    expect(screen.getByTestId('count').textContent).toBe('0');
  });
});
