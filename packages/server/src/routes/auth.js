import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authMiddleware, signToken, signPurposeToken, verifyPurposeToken, verifySessionToken } from '../auth.js';
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
import { getSecurityPolicy } from '../lib/securityPolicy.js';
import { loginLimiter, mfaGuessLimiter, mfaReadLimiter, mfaSensitiveLimiter, mfaSetupLimiter } from '../lib/authRateLimit.js';
import {
  buildOtpauthUrl,
  consumeRecoveryCode,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  hashRecoveryCode,
  verifyCode,
} from '../lib/totp.js';

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


const MFA_VERIFY = 'mfa-verify';
const MFA_SETUP = 'mfa-setup';
const MFA_ISSUER = 'CSIN-Tech';

/** 세션을 만들고 로그인 응답을 돌려준다(비밀번호·2차 인증을 모두 통과한 뒤에만 호출). */
async function issueLogin(req, res, user, mustChangePassword, extra = {}) {
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
    ...extra,
  });
}

authRouter.post('/login', loginLimiter, async (req, res) => {
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

    // 2차 인증: 등록된 사용자는 코드 확인, 정책상 필수인데 미등록이면 등록 단계로 보낸다.
    // 토큰은 세션이 아니라 5분짜리 중간 토큰이라 이것만으로는 어떤 API도 쓸 수 없다.
    if (user.totpEnabled) {
      const mfaToken = signPurposeToken(MFA_VERIFY, { userId: user.id, mustChangePassword });
      return res.json({ mfaRequired: true, mfaToken });
    }
    if ((await getSecurityPolicy()).twoFactor === 'required') {
      const mfaToken = signPurposeToken(MFA_SETUP, { userId: user.id, mustChangePassword });
      return res.json({ mfaSetupRequired: true, mfaToken });
    }

    return await issueLogin(req, res, user, mustChangePassword);
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

// ───────────────────────── 비밀번호 확인 (화면 잠금 해제) ─────────────────────────

/** 현재 비밀번호가 맞는지 확인한다. 로그인과 같은 실패 카운터를 공유해 무차별 대입을 막는다. */
async function checkPassword(user, password) {
  if (isLdapEnabled() && !isLocalExceptionEmail(user.email)) {
    try {
      const result = await authenticateLdap(loginIdentifierToUid(user.email), password);
      return result.ok ? { ok: true } : { ok: false, status: loginErrorStatus(result.reason), code: result.reason };
    } catch (err) {
      const code = err?.ldapCode || err?.message || 'LDAP_ERROR';
      return { ok: false, status: loginErrorStatus(code), code };
    }
  }
  if (isLocked(user.id)) return { ok: false, status: 423, code: 'ACCOUNT_LOCKED' };
  if (!(await bcrypt.compare(password, user.password))) {
    recordFailure(user.id);
    return isLocked(user.id)
      ? { ok: false, status: 423, code: 'ACCOUNT_LOCKED' }
      : { ok: false, status: 400, code: 'PASSWORD_MISMATCH' };
  }
  recordSuccess(user.id);
  return { ok: true };
}

/**
 * POST /auth/verify-password - 현재 세션을 유지한 채 비밀번호만 확인한다.
 * 화면 잠금 해제용. (/auth/login을 재호출하면 기존 세션이 모두 삭제돼 해제 직후 로그아웃된다)
 * 400을 쓰는 이유: 클라이언트는 모든 401을 세션 만료로 보고 강제 로그아웃시키기 때문.
 */
authRouter.post('/verify-password', mfaGuessLimiter, authMiddleware, async (req, res) => {
  try {
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) return res.status(400).json({ error: 'PASSWORD_REQUIRED' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, email: true, password: true },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const result = await checkPassword(user, password);
    if (!result.ok) {
      return res.status(result.status).json({ error: result.code === 'ACCOUNT_LOCKED' ? loginErrorMessage('ACCOUNT_LOCKED') : result.code });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/verify-password]', err);
    return res.status(500).json({ error: 'Failed to verify password' });
  }
});

// ───────────────────────── 2차 인증 (TOTP) ─────────────────────────

const mfaKey = (userId) => `mfa:${userId}`;

/**
 * 2차 인증 API를 호출한 사람이 누구인지 확인한다.
 * - Authorization: Bearer <세션 토큰> (이미 로그인한 사용자가 설정 화면에서 호출)
 * - body.mfaToken (로그인 도중, 아직 세션이 없는 상태에서 호출)
 * 반환: { user, viaToken, mustChangePassword } 또는 null
 */
async function resolveMfaActor(req, mfaPurpose) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  let userId = null;
  let viaToken = false;
  let mustChangePassword = false;
  if (bearer) {
    const payload = await verifySessionToken(bearer);
    if (!payload) return null;
    userId = payload.userId;
  } else if (typeof req.body?.mfaToken === 'string') {
    const payload = verifyPurposeToken(req.body.mfaToken, mfaPurpose);
    if (!payload) return null;
    userId = payload.userId;
    viaToken = true;
    mustChangePassword = !!payload.mustChangePassword;
  }
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user ? { user, viaToken, mustChangePassword } : null;
}

function readRecoveryHashes(user) {
  try {
    const parsed = JSON.parse(user.totpRecoveryCodes || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 6자리 코드 또는 복구 코드를 검증한다. 성공하면 DB(마지막 step·복구 코드 목록)도 갱신한다.
 * 반환: { ok: true, usedRecovery } | { ok: false, locked }
 */
async function checkSecondFactor(user, rawCode) {
  const key = mfaKey(user.id);
  if (isLocked(key)) return { ok: false, locked: true };
  const code = String(rawCode || '').trim();

  if (user.totpSecret) {
    let secret;
    try {
      secret = decryptSecret(user.totpSecret);
    } catch (err) {
      console.error('[mfa] secret decrypt failed for user', user.id, err?.message);
      return { ok: false, locked: false };
    }
    const step = verifyCode(secret, code, { lastUsedStep: user.totpLastStep });
    if (step != null) {
      await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
      recordSuccess(key);
      return { ok: true, usedRecovery: false };
    }
  }

  const remaining = consumeRecoveryCode(readRecoveryHashes(user), code);
  if (remaining) {
    await prisma.user.update({ where: { id: user.id }, data: { totpRecoveryCodes: JSON.stringify(remaining) } });
    recordSuccess(key);
    return { ok: true, usedRecovery: true, recoveryLeft: remaining.length };
  }

  recordFailure(key);
  return { ok: false, locked: isLocked(key) };
}

const MFA_LOCKED_MESSAGE = '인증 시도가 많아 잠시 잠겼습니다. 15분 뒤에 다시 시도해 주세요.';

/** POST /auth/mfa/verify - 로그인 2단계. body: { mfaToken, code } → 로그인 응답과 동일 */
authRouter.post('/mfa/verify', mfaGuessLimiter, async (req, res) => {
  try {
    const payload = verifyPurposeToken(req.body?.mfaToken, MFA_VERIFY);
    if (!payload) return res.status(401).json({ error: 'MFA_TOKEN_INVALID' });
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.totpEnabled) return res.status(401).json({ error: 'MFA_TOKEN_INVALID' });

    const result = await checkSecondFactor(user, req.body?.code);
    if (!result.ok) {
      if (result.locked) return res.status(423).json({ error: MFA_LOCKED_MESSAGE });
      return res.status(401).json({ error: '인증 코드가 올바르지 않습니다' });
    }
    return await issueLogin(req, res, user, !!payload.mustChangePassword);
  } catch (err) {
    console.error('[auth/mfa/verify]', err);
    return res.status(500).json({ error: '인증에 실패했습니다' });
  }
});

/** GET /auth/mfa/status - 내 2차 인증 상태와 서버 정책 */
authRouter.get('/mfa/status', mfaReadLimiter, authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    const policy = await getSecurityPolicy();
    return res.json({
      enabled: !!user.totpEnabled,
      required: policy.twoFactor === 'required',
      recoveryCodesLeft: user.totpEnabled ? readRecoveryHashes(user).length : 0,
    });
  } catch (err) {
    console.error('[auth/mfa/status]', err);
    return res.status(500).json({ error: 'Failed to get MFA status' });
  }
});

/** POST /auth/mfa/setup/start - 새 비밀키를 만들어 돌려준다(아직 확정 전). body: { mfaToken? } */
authRouter.post('/mfa/setup/start', mfaSetupLimiter, async (req, res) => {
  try {
    const actor = await resolveMfaActor(req, MFA_SETUP);
    if (!actor) return res.status(401).json({ error: 'MFA_TOKEN_INVALID' });
    const { user } = actor;
    if (user.totpEnabled) return res.status(409).json({ error: 'MFA_ALREADY_ENABLED' });

    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: encryptSecret(secret), totpLastStep: null } });
    return res.json({
      secret,
      otpauthUrl: buildOtpauthUrl({ secret, account: user.email, issuer: MFA_ISSUER }),
    });
  } catch (err) {
    console.error('[auth/mfa/setup/start]', err);
    return res.status(500).json({ error: '2차 인증 설정을 시작하지 못했습니다' });
  }
});

/**
 * POST /auth/mfa/setup/confirm - 인증 앱에 표시된 코드로 등록을 확정한다.
 * body: { code, mfaToken? }. 복구 코드는 이때 한 번만 보여준다.
 * mfaToken으로 호출했으면(로그인 도중 강제 등록) 세션까지 발급해 로그인을 완료시킨다.
 */
authRouter.post('/mfa/setup/confirm', mfaGuessLimiter, async (req, res) => {
  try {
    const actor = await resolveMfaActor(req, MFA_SETUP);
    if (!actor) return res.status(401).json({ error: 'MFA_TOKEN_INVALID' });
    const { user } = actor;
    if (user.totpEnabled) return res.status(409).json({ error: 'MFA_ALREADY_ENABLED' });
    if (!user.totpSecret) return res.status(400).json({ error: 'MFA_SETUP_NOT_STARTED' });

    const key = mfaKey(user.id);
    if (isLocked(key)) return res.status(423).json({ error: MFA_LOCKED_MESSAGE });
    const step = verifyCode(decryptSecret(user.totpSecret), req.body?.code);
    if (step == null) {
      recordFailure(key);
      return res.status(400).json({ error: '인증 코드가 올바르지 않습니다. 앱에 표시된 6자리 코드를 다시 입력해 주세요.' });
    }
    recordSuccess(key);

    const recoveryCodes = generateRecoveryCodes();
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: true,
        totpLastStep: step,
        totpRecoveryCodes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)),
      },
    });

    if (actor.viaToken) {
      // 강제 등록 중이었다면 이 응답으로 로그인까지 끝낸다. 복구 코드는 별도 필드로 함께 준다.
      return await issueLogin(req, res, updated, actor.mustChangePassword, { recoveryCodes });
    }
    return res.json({ ok: true, recoveryCodes });
  } catch (err) {
    console.error('[auth/mfa/setup/confirm]', err);
    return res.status(500).json({ error: '2차 인증을 등록하지 못했습니다' });
  }
});

/** 비밀번호 + 2차 코드를 함께 요구하는 민감 작업 공통 검증. 실패 시 응답을 보내고 null. */
async function requireReauth(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return null;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const pw = await checkPassword(user, password);
  if (!pw.ok) {
    res.status(pw.status).json({ error: pw.code === 'ACCOUNT_LOCKED' ? loginErrorMessage('ACCOUNT_LOCKED') : '비밀번호가 올바르지 않습니다' });
    return null;
  }
  const factor = await checkSecondFactor(user, req.body?.code);
  if (!factor.ok) {
    res.status(factor.locked ? 423 : 400).json({ error: factor.locked ? MFA_LOCKED_MESSAGE : '인증 코드가 올바르지 않습니다' });
    return null;
  }
  return user;
}

/** POST /auth/mfa/disable - 본인 2차 인증 해제. body: { password, code }. 정책이 '필수'면 해제 불가 */
authRouter.post('/mfa/disable', mfaSensitiveLimiter, authMiddleware, async (req, res) => {
  try {
    if ((await getSecurityPolicy()).twoFactor === 'required') {
      return res.status(403).json({ error: '관리자가 2차 인증을 필수로 설정해 해제할 수 없습니다' });
    }
    const user = await requireReauth(req, res);
    if (!user) return;
    await prisma.user.update({
      where: { id: user.id },
      data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecoveryCodes: null },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[auth/mfa/disable]', err);
    return res.status(500).json({ error: '2차 인증을 해제하지 못했습니다' });
  }
});

/** POST /auth/mfa/recovery-codes - 복구 코드 재발급(기존 코드는 모두 무효). body: { password, code } */
authRouter.post('/mfa/recovery-codes', mfaSensitiveLimiter, authMiddleware, async (req, res) => {
  try {
    const user = await requireReauth(req, res);
    if (!user) return;
    if (!user.totpEnabled) return res.status(400).json({ error: 'MFA_NOT_ENABLED' });
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { totpRecoveryCodes: JSON.stringify(recoveryCodes.map(hashRecoveryCode)) },
    });
    return res.json({ recoveryCodes });
  } catch (err) {
    console.error('[auth/mfa/recovery-codes]', err);
    return res.status(500).json({ error: '복구 코드를 발급하지 못했습니다' });
  }
});
