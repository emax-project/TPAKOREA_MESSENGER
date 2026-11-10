/**
 * 인증·2차 인증 라우트의 요청 속도 제한(무차별 대입·자원 소모 방어).
 *
 * 계정 단위 잠금(loginAttempts: 비밀번호·인증 코드 연속 실패 시 15분 잠금)과는 별개의 안전장치다.
 * 서버가 리버스 프록시(Caddy) 뒤에 있어 IP만으로 제한하면 모든 사용자가 한 묶음이 되므로,
 * 토큰에서 사용자를 알 수 있으면 사용자 단위로, 아니면 IP 단위로 센다.
 */
import rateLimit from 'express-rate-limit';
import { verifyToken } from '../auth.js';

/** 요청을 보낸 주체의 제한 키. 서명이 맞는 세션/중간 토큰의 사용자 id를 우선한다. */
export function actorKey(req) {
  const header = req.headers?.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const candidate = bearer || (typeof req.body?.mfaToken === 'string' ? req.body.mfaToken : null);
  const userId = candidate ? verifyToken(candidate)?.userId : null;
  return userId ? `user:${userId}` : `ip:${req.ip}`;
}

function limiter({ windowMs, limit, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: actorKey,
    // 키가 IP로 떨어지는 경우의 IPv6 안내 경고는 끈다(사용자 키가 기본이고 IP는 비로그인 요청의 보조 수단)
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) => res.status(429).json({ error: message }),
  });
}

const MINUTE = 60_000;
const TOO_MANY = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';

/** 조회성 요청(상태 확인 등) */
export const mfaReadLimiter = limiter({ windowMs: MINUTE, limit: 60, message: TOO_MANY });
/**
 * 로그인 2단계·등록 확인·비밀번호 확인 — 코드를 대입해 볼 수 있는 경로.
 * 세 경로가 하나의 한도(사용자당 분당 30회)를 함께 쓴다. 경로를 번갈아 호출해 한도를 우회하지 못하게 하기 위함.
 */
export const mfaGuessLimiter = limiter({ windowMs: MINUTE, limit: 30, message: TOO_MANY });
/** 등록 시작(비밀키 생성) */
export const mfaSetupLimiter = limiter({ windowMs: MINUTE, limit: 20, message: TOO_MANY });
/** 해제·복구 코드 재발급 — 민감 작업이라 더 빡빡하게 */
export const mfaSensitiveLimiter = limiter({ windowMs: MINUTE, limit: 10, message: TOO_MANY });
