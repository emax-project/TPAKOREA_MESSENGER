import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { ssoTokenLimiter, ssoVerifyLimiter } from '../lib/authRateLimit.js';
import {
  SSO_TOKEN_TTL_SECONDS,
  emailLocalPart,
  generateSsoToken,
  hashSsoToken,
  sharedKeyMatches,
} from '../lib/ssoToken.js';

/**
 * 그룹웨어 SSO — 메신저가 1회용 토큰을 발급하고, 그룹웨어 서버가 서버 간 호출로 검증(소비)한다.
 * 규격: docs/groupware-sso.md
 *   POST /sso/token  (로그인한 사용자) → { token, expiresIn }
 *   POST /sso/verify (그룹웨어 서버, X-SSO-Key) → { ok, userId, email, username, name }
 */
export const ssoRouter = Router();

export const SSO_ENABLED_KEY = 'groupware_sso_enabled';

async function isSsoEnabled() {
  const row = await prisma.appSetting.findUnique({ where: { key: SSO_ENABLED_KEY }, select: { value: true } });
  return row?.value === '1';
}

ssoRouter.post('/token', ssoTokenLimiter, authMiddleware, async (req, res) => {
  try {
    if (!(await isSsoEnabled())) {
      return res.status(403).json({ error: '그룹웨어 SSO가 사용 설정되어 있지 않습니다' });
    }
    const token = generateSsoToken();
    const expiresAt = new Date(Date.now() + SSO_TOKEN_TTL_SECONDS * 1000);
    await prisma.ssoToken.create({
      data: { tokenHash: hashSsoToken(token), userId: req.userId, expiresAt },
    });
    return res.json({ token, expiresIn: SSO_TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error('[sso] token issue failed', err);
    return res.status(500).json({ error: 'SSO 토큰을 발급하지 못했습니다' });
  }
});

ssoRouter.post('/verify', ssoVerifyLimiter, async (req, res) => {
  try {
    const expectedKey = process.env.SSO_SHARED_KEY || '';
    if (!expectedKey) {
      return res.status(503).json({ ok: false, error: 'SSO not configured' });
    }
    if (!sharedKeyMatches(req.get('x-sso-key') || '', expectedKey)) {
      return res.status(401).json({ ok: false });
    }
    if (!(await isSsoEnabled())) {
      return res.status(403).json({ ok: false });
    }
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!token || token.length > 200) return res.status(400).json({ ok: false });

    // 한 번에 "아직 안 쓴 + 안 만료된" 토큰만 사용 처리한다 — 동시에 두 번 검증해도 한쪽만 성공.
    const tokenHash = hashSsoToken(token);
    const now = new Date();
    const consumed = await prisma.ssoToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1) return res.status(401).json({ ok: false });

    const row = await prisma.ssoToken.findUnique({
      where: { tokenHash },
      select: { user: { select: { id: true, email: true, name: true } } },
    });
    const user = row?.user;
    if (!user) return res.status(401).json({ ok: false });
    return res.json({
      ok: true,
      userId: user.id,
      email: user.email,
      username: emailLocalPart(user.email),
      name: user.name,
    });
  } catch (err) {
    console.error('[sso] verify failed', err);
    return res.status(500).json({ ok: false });
  }
});
