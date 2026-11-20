import jwt from 'jsonwebtoken';
import { prisma } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * 용도가 정해진 단기 토큰(2차 인증 진행용). 세션 토큰과 달리 sessionId가 없어
 * authMiddleware(verifySessionToken)에서는 절대 통과하지 못한다.
 */
export function signPurposeToken(purpose, payload, expiresIn = '5m') {
  return jwt.sign({ ...payload, purpose }, JWT_SECRET, { expiresIn });
}

export function verifyPurposeToken(token, purpose) {
  const payload = verifyToken(token);
  if (!payload || payload.purpose !== purpose || !payload.userId || payload.sessionId) return null;
  return payload;
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export async function verifySessionToken(token) {
  const payload = verifyToken(token);
  if (!payload?.userId || !payload?.sessionId) return null;
  const session = await prisma.userSession.findUnique({
    where: { id: payload.sessionId },
    select: { userId: true },
  });
  if (!session || String(session.userId) !== String(payload.userId)) return null;
  return payload;
}

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    // URL 쿼리스트링으로도 토큰을 받으면 서버 접근 로그/브라우저 히스토리/Referer로
    // 세션 토큰이 새어나갈 수 있어 Authorization 헤더만 인정한다.
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = await verifySessionToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.userId = payload.userId;
    req.sessionId = payload.sessionId;
    next();
  } catch (err) {
    next(err);
  }
}
