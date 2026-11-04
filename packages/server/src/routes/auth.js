import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authMiddleware, signToken } from '../auth.js';
import { isAdminEmail } from '../lib/admin.js';
import {
  authenticateLdap,
  getLdapEmailDomain,
  isLdapEnabled,
  isLocalExceptionEmail,
  loginIdentifierToUid,
  changeLdapPassword,
} from '../lib/ldap.js';
import { getPasswordPolicy, validatePassword } from '../lib/passwordPolicy.js';
import { isLocked, recordFailure, recordSuccess } from '../lib/loginAttempts.js';

export const authRouter = Router();

async function findLocalUserForLogin(identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) return null;
  const candidates = [];
  const add = (email) => {
    if (email && !candidates.includes(email)) candidates.push(email);
  };
  add(raw);
  add(raw.toLowerCase());
  if (!raw.includes('@')) {
    const domain = getLdapEmailDomain();
    add(`${raw}@${domain}`);
    add(`${raw.toLowerCase()}@${domain}`);
  }
  for (const email of candidates) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) return user;
  }
  return null;
}

function loginErrorStatus(code) {
  if (code === 'LDAP_UNAVAILABLE' || code === 'LDAP_NOT_CONFIGURED' || code === 'LDAP_ERROR') return 503;
  if (code === 'ACCOUNT_LOCKED') return 423;
  return 401;
}

function loginErrorMessage(code) {
  if (code === 'ACCOUNT_LOCKED') return '로그인 시도가 많아 계정이 잠겼습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'LDAP_UNAVAILABLE' || code === 'LDAP_NOT_CONFIGURED' || code === 'LDAP_ERROR') {
    return 'LDAP 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  }
  return 'Invalid email or password';
}

authRouter.get('/password-policy', (_req, res) => {
  return res.json(getPasswordPolicy());
});

// 셀프 가입은 쓰지 않는다 — 계정은 전부 관리자가 생성한다 (scripts/create-admin.js,
// 또는 사내 bulk 등록 화면). 과거 셀프 가입 UI/엔드포인트가 열려 있던 흔적이 App
// Store 심사에서 "회원가입 기능이 없다"는 설명과 어긋나 문제가 됐던 적이 있어,
// 엔드포인트 자체를 항상 막아둔다.
authRouter.post('/register', async (_req, res) => {
  return res.status(403).json({ error: 'REGISTER_DISABLED' });
});

authRouter.post('/login', async (req, res) => {
  try {
    const identifier = typeof req.body?.email === 'string' ? req.body.email : req.body?.username;
    const password = req.body?.password;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'email and password required' });
    }
    const user = await findLocalUserForLogin(identifier);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // 거래처 자동계정처럼 공용 초기비밀번호로 생성된 로컬 계정은 DB에 저장된
    // mustChangePassword 플래그로 강제 변경 여부가 결정된다.
    let mustChangePassword = !!user.mustChangePassword;
    const useLdap = isLdapEnabled() && !isLocalExceptionEmail(user.email);

    if (useLdap) {
      const uid = loginIdentifierToUid(user.email) || loginIdentifierToUid(identifier);
      let result;
      try {
        result = await authenticateLdap(uid, password);
      } catch (err) {
        const code = err?.ldapCode || err?.message || 'LDAP_ERROR';
        console.error('[auth/login] ldap', code, err?.message);
        return res.status(loginErrorStatus(code)).json({ error: loginErrorMessage(code) });
      }
      if (!result.ok) {
        return res.status(loginErrorStatus(result.reason)).json({ error: loginErrorMessage(result.reason) });
      }
      mustChangePassword = mustChangePassword || !!result.mustChangePassword;
    } else {
      // 로컬 계정(비 LDAP) 무차별 대입 방어. LDAP 경로는 디렉터리 서버가
      // 자체적으로 계정을 잠그므로(위 useLdap 분기) 여기서는 다루지 않는다.
      if (isLocked(user.id)) {
        return res.status(423).json({ error: loginErrorMessage('ACCOUNT_LOCKED') });
      }
      if (!(await bcrypt.compare(password, user.password))) {
        recordFailure(user.id);
        if (isLocked(user.id)) {
          return res.status(423).json({ error: loginErrorMessage('ACCOUNT_LOCKED') });
        }
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      recordSuccess(user.id);
    }

    await prisma.userSession.deleteMany({ where: { userId: user.id } });
    const session = await prisma.userSession.create({ data: { userId: user.id } });
    const token = signToken({ userId: user.id, sessionId: session.id });

    // 재접속/재로그인 시 이전에 설정해 둔 상태(자리비움 등)를 지우고 '온라인'으로 초기화한다.
    if (user.statusMessage) {
      await prisma.user.update({ where: { id: user.id }, data: { statusMessage: null } }).catch((e) => {
        console.warn('[auth/login] failed to reset statusMessage:', e?.message || e);
      });
      const io = req.app.get('io');
      if (io) io.emit('user_status_changed', { userId: user.id, statusMessage: null });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        isAdmin: isAdminEmail(user.email),
        mustChangePassword,
      },
      token,
      mustChangePassword,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    const msg = err?.code === 'P1001' ? '데이터베이스에 연결할 수 없습니다. DB가 실행 중인지 확인해 주세요.' : '로그인 실패';
    return res.status(500).json({ error: msg });
  }
});

authRouter.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, name: true, phone: true, extension: true, deskPhone: true, jobTitle: true, statusMessage: true, statusNote: true, notepad: true, createdAt: true, avatarUrl: true, updatedAt: true },
    });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const avatarVer = user.updatedAt ? `?v=${new Date(user.updatedAt).getTime()}` : '';
    return res.json({
      user: {
        ...user,
        avatarUrl: user.avatarUrl ? `/users/${user.id}/avatar${avatarVer}` : null,
        isAdmin: isAdminEmail(user.email),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to get current user' });
  }
});

authRouter.post('/logout', authMiddleware, async (req, res) => {
  try {
    if (req.sessionId) {
      await prisma.userSession.delete({ where: { id: req.sessionId } }).catch((e) => {
        console.warn('[logout] 세션 삭제 실패 (이미 만료됐을 수 있음):', e.message);
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * PUT /auth/password - 본인 비밀번호 변경.
 * body: { currentPassword, newPassword }
 * 관리자 초기화(POST /users/:id/reset-password)와 달리 현재 비밀번호를 확인한다.
 * 성공하면 지금 쓰는 세션만 남기고 나머지는 정리한다.
 */
authRouter.put('/password', authMiddleware, async (req, res) => {
  try {
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword) return res.status(400).json({ error: 'CURRENT_PASSWORD_REQUIRED' });
    const policyError = validatePassword(newPassword);
    if (policyError) return res.status(400).json({ error: policyError });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'PASSWORD_UNCHANGED' });

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, password: true },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (isLdapEnabled() && !isLocalExceptionEmail(user.email)) {
      try {
        await changeLdapPassword(loginIdentifierToUid(user.email), currentPassword, newPassword);
      } catch (err) {
        const code = err?.ldapCode || err?.message || 'LDAP_ERROR';
        const status = err?.status || (code === 'CURRENT_PASSWORD_MISMATCH' || code === 'PASSWORD_POLICY' ? 400 : 503);
        return res.status(status).json({ error: code });
      }
    } else {
      const ok = await bcrypt.compare(currentPassword, user.password);
      // 401이 아니라 400을 쓴다. 요청 자체는 인증된 상태이고 본문 값이 틀린 것이며,
      // 클라이언트는 모든 401을 세션 만료로 보고 강제 로그아웃시키기 때문이다.
      if (!ok) return res.status(400).json({ error: 'CURRENT_PASSWORD_MISMATCH' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashed, mustChangePassword: false } }),
      // 지금 창은 그대로 쓰게 두고, 다른 기기에 남은 세션만 끊는다
      prisma.userSession.deleteMany({
        where: { userId: user.id, id: { not: req.sessionId } },
      }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to change password' });
  }
});
