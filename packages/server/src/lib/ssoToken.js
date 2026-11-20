/**
 * 그룹웨어 SSO(1회용 토큰) 공용 로직 — DB·Express와 분리해 단위 테스트할 수 있게 둔다.
 * 연동 규격은 docs/groupware-sso.md 참고.
 */
import crypto from 'crypto';

/** 토큰 유효 시간(초). 주소에 실려 브라우저 기록에 남을 수 있으니 짧게 둔다. */
export const SSO_TOKEN_TTL_SECONDS = 60;

export const SSO_DEFAULT_PATH = '/sso';

/** 추측 불가능한 토큰 원문(URL에 안전한 base64url, 256비트). */
export function generateSsoToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** DB에는 해시만 저장한다 — DB가 유출돼도 토큰 원문으로 로그인할 수 없다. */
export function hashSsoToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** 공유 키 비교(타이밍 공격 방지). 둘 중 하나라도 비어 있으면 항상 false. */
export function sharedKeyMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** 이메일의 @ 앞부분 — 그룹웨어 로그인 아이디와 맞출 때 힌트로 쓴다. */
export function emailLocalPart(email) {
  const s = String(email || '');
  const i = s.indexOf('@');
  return i > 0 ? s.slice(0, i) : s;
}

/**
 * 그룹웨어 SSO 진입 경로 검증. 서버 안의 경로만 허용한다(스킴·호스트·상위 경로 이동 금지).
 * 비어 있으면 기본값(/sso). 반환: { path } 또는 { error }.
 */
export function normalizeSsoPath(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { path: SSO_DEFAULT_PATH };
  if (trimmed.length > 200) return { error: '경로가 너무 깁니다' };
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return { error: "경로는 '/'로 시작해야 합니다 (예: /sso)" };
  }
  if (!/^\/[A-Za-z0-9/_\-.]*$/.test(trimmed) || trimmed.includes('..')) {
    return { error: '경로에는 영문·숫자와 / _ - . 만 사용할 수 있습니다' };
  }
  return { path: trimmed };
}
