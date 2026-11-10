/**
 * 메시지 전송 고유 키(clientMessageId) 검증.
 * 클라이언트가 전송마다 만드는 임의 문자열(UUID 등)로, 같은 키로 다시 보내도 서버는 한 번만 저장한다.
 * 키를 보내지 않는 구버전 클라이언트는 그대로 허용한다(멱등 보호만 받지 못한다).
 */
const PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/** { ok: true, value: string | null } 또는 { ok: false } */
export function parseClientMessageId(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string' || !PATTERN.test(raw)) return { ok: false };
  return { ok: true, value: raw };
}

/** Prisma 고유 제약 위반(같은 보낸 사람·키가 동시에 두 번 들어온 경우) 여부 */
export function isUniqueViolation(err) {
  return err?.code === 'P2002';
}
