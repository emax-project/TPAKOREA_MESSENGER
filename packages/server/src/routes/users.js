import path from 'path';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { assertAdmin, isAdminEmail } from '../lib/admin.js';
import { avatarUpload, UPLOAD_DIR } from '../upload.js';
import { isLdapEnabled, isLocalExceptionEmail, loginIdentifierToUid, resetLdapPassword } from '../lib/ldap.js';
import { validatePassword } from '../lib/passwordPolicy.js';

export const usersRouter = Router();

usersRouter.use(authMiddleware);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BULK_MAX = 500;

/**
 * Resolve company + department by name. Creates missing rows.
 * Cache key: `${companyName}::${departmentName}` (lowercase).
 */
async function resolveDepartmentId(companyName, departmentName, cache) {
  const key = `${companyName.toLowerCase()}::${departmentName.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  let company = await prisma.company.findFirst({
    where: { name: { equals: companyName, mode: 'insensitive' } },
  });
  if (!company) {
    company = await prisma.company.create({ data: { name: companyName } });
  }

  // 부서는 계층이므로 '본부 > 팀 > 파트' 경로를 받는다.
  // 구분자가 없으면 단일 이름으로 보고 최상위에서 찾는다.
  const segments = departmentName
    .split('>')
    .map((v) => v.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;

  let parentId = null;
  let department = null;
  for (const segment of segments) {
    department = await prisma.department.findFirst({
      where: {
        companyId: company.id,
        parentId,
        name: { equals: segment, mode: 'insensitive' },
      },
    });
    if (!department) {
      department = await prisma.department.create({
        data: { name: segment, companyId: company.id, parentId },
      });
    }
    parentId = department.id;
  }

  cache.set(key, department.id);
  return department.id;
}

/**
 * POST /users/bulk — admin only bulk user registration.
 * Body: { defaultPassword?: string, users: [{ email, name, password?, phone?, jobTitle?, departmentName?, companyName? }] }
 * Partial success: created[] + failed[].
 */
usersRouter.post('/bulk', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const users = Array.isArray(req.body?.users) ? req.body.users : null;
    if (!users || users.length === 0) {
      return res.status(400).json({ error: 'users array is required' });
    }
    if (users.length > BULK_MAX) {
      return res.status(400).json({ error: `users must be at most ${BULK_MAX}` });
    }

    const defaultPassword =
      typeof req.body.defaultPassword === 'string' ? req.body.defaultPassword : '';

    const deptCache = new Map();
    const created = [];
    const failed = [];
    const seenEmails = new Set();

    for (let i = 0; i < users.length; i++) {
      const row = i + 1;
      const item = users[i] && typeof users[i] === 'object' ? users[i] : {};
      const email = typeof item.email === 'string' ? item.email.trim().toLowerCase() : '';
      const name = typeof item.name === 'string' ? item.name.trim() : '';
      const password =
        typeof item.password === 'string' && item.password
          ? item.password
          : defaultPassword;
      const phone =
        typeof item.phone === 'string' && item.phone.trim()
          ? item.phone.trim().slice(0, 50)
          : null;
      const jobTitle =
        typeof item.jobTitle === 'string' && item.jobTitle.trim()
          ? item.jobTitle.trim().slice(0, 30)
          : null;
      const departmentName =
        typeof item.departmentName === 'string' ? item.departmentName.trim() : '';
      const companyName =
        typeof item.companyName === 'string' ? item.companyName.trim() : '';

      if (!email || !EMAIL_RE.test(email)) {
        failed.push({ row, email: email || null, reason: 'INVALID_EMAIL' });
        continue;
      }
      if (!name) {
        failed.push({ row, email, reason: 'NAME_REQUIRED' });
        continue;
      }
      if (!password || password.length < 4) {
        failed.push({ row, email, reason: 'PASSWORD_REQUIRED' });
        continue;
      }
      if (seenEmails.has(email)) {
        failed.push({ row, email, reason: 'DUPLICATE_IN_BATCH' });
        continue;
      }
      seenEmails.add(email);

      if ((departmentName && !companyName) || (!departmentName && companyName)) {
        failed.push({ row, email, reason: 'COMPANY_AND_DEPARTMENT_REQUIRED' });
        continue;
      }

      try {
        const existing = await prisma.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (existing) {
          failed.push({ row, email, reason: 'EMAIL_EXISTS' });
          continue;
        }

        let departmentId = null;
        if (companyName && departmentName) {
          departmentId = await resolveDepartmentId(companyName, departmentName, deptCache);
        }

        const hashed = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
          data: {
            email,
            name,
            password: hashed,
            phone,
            jobTitle,
            departmentId,
          },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            jobTitle: true,
            departmentId: true,
            createdAt: true,
          },
        });
        created.push(user);
      } catch (err) {
        if (err?.code === 'P2002') {
          failed.push({ row, email, reason: 'EMAIL_EXISTS' });
        } else {
          console.error(`[users/bulk] row ${row}:`, err);
          failed.push({ row, email, reason: 'CREATE_FAILED' });
        }
      }
    }

    return res.status(201).json({
      created: created.length,
      failed: failed.length,
      users: created,
      errors: failed,
    });
  } catch (err) {
    console.error('[users/bulk]', err);
    return res.status(500).json({ error: 'Bulk registration failed' });
  }
});

usersRouter.get('/', async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    const where = { id: { not: req.userId } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    const users = await prisma.user.findMany({
      where,
      select: { id: true, email: true, name: true, phone: true, jobTitle: true, statusMessage: true, avatarUrl: true, updatedAt: true },
      orderBy: { name: 'asc' },
      take: limit,
    });
    const result = users.map((u) => {
      const ver = u.updatedAt ? `?v=${new Date(u.updatedAt).getTime()}` : '';
      return { ...u, avatarUrl: u.avatarUrl ? `/users/${u.id}/avatar${ver}` : null };
    });
    return res.json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

usersRouter.get('/:id', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, email: true, name: true, phone: true, jobTitle: true, statusMessage: true, avatarUrl: true, updatedAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const avatarVer = user.updatedAt ? `?v=${new Date(user.updatedAt).getTime()}` : '';
    return res.json({ ...user, avatarUrl: user.avatarUrl ? `/users/${user.id}/avatar${avatarVer}` : null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch user' });
  }
});

function toAffiliationItem(row, activeDepartmentId) {
  const dept = row.department;
  return {
    departmentId: dept.id,
    departmentName: dept.name,
    companyId: dept.company.id,
    companyName: dept.company.name,
    label: `${dept.company.name} · ${dept.name}`,
    active: String(dept.id) === String(activeDepartmentId || ''),
  };
}

async function listUserAffiliations(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      departmentId: true,
      department: { include: { company: true } },
      affiliations: {
        include: { department: { include: { company: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!user) return null;

  if (user.departmentId) {
    await prisma.userAffiliation.upsert({
      where: { userId_departmentId: { userId, departmentId: user.departmentId } },
      create: { userId, departmentId: user.departmentId },
      update: {},
    });
  }

  const affiliations = user.affiliations.length > 0
    ? user.affiliations
    : await prisma.userAffiliation.findMany({
        where: { userId },
        include: { department: { include: { company: true } } },
        orderBy: { createdAt: 'asc' },
      });

  const rows = affiliations.length > 0 || !user.department
    ? affiliations
    : [{ department: user.department }];

  if (user.departmentId && !rows.some((r) => r.department.id === user.departmentId) && user.department) {
    rows.unshift({ department: user.department });
  }

  const seen = new Set();
  const items = [];
  for (const row of rows) {
    if (!row?.department?.id || seen.has(row.department.id)) continue;
    seen.add(row.department.id);
    items.push(toAffiliationItem(row, user.departmentId));
  }
  return { departmentId: user.departmentId, affiliations: items };
}

usersRouter.get('/me/affiliations', async (req, res) => {
  try {
    const data = await listUserAffiliations(req.userId);
    if (!data) return res.status(404).json({ error: 'User not found' });
    return res.json(data);
  } catch (err) {
    console.error('[users/me/affiliations GET]', err);
    return res.status(500).json({ error: 'Failed to fetch affiliations' });
  }
});

usersRouter.put('/me/affiliation', async (req, res) => {
  try {
    const departmentId = typeof req.body?.departmentId === 'string' ? req.body.departmentId.trim() : '';
    if (!departmentId) return res.status(400).json({ error: 'departmentId required' });

    const allowed = await prisma.userAffiliation.findUnique({
      where: { userId_departmentId: { userId: req.userId, departmentId } },
    });
    const me = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { departmentId: true },
    });
    if (!allowed && me?.departmentId !== departmentId) {
      return res.status(403).json({ error: 'NOT_AN_AFFILIATION' });
    }

    const dept = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { company: true },
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    await prisma.$transaction([
      prisma.userAffiliation.upsert({
        where: { userId_departmentId: { userId: req.userId, departmentId } },
        create: { userId: req.userId, departmentId },
        update: {},
      }),
      prisma.user.update({
        where: { id: req.userId },
        data: { departmentId },
      }),
    ]);

    const io = req.app.get('io');
    if (io) {
      io.emit('user_status_changed', { userId: req.userId, departmentId });
    }
    return res.json({
      ok: true,
      departmentId,
      label: `${dept.company.name} · ${dept.name}`,
    });
  } catch (err) {
    console.error('[users/me/affiliation PUT]', err);
    return res.status(500).json({ error: 'Failed to switch affiliation' });
  }
});

// Delete my avatar
usersRouter.delete('/me/avatar', async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: null },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete avatar' });
  }
});

// Upload my avatar - must be before /:id to avoid conflict
usersRouter.post('/me/avatar', avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '이미지 파일을 선택해주세요' });
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: req.file.filename },
      select: { updatedAt: true },
    });
    const ver = updated.updatedAt ? `?v=${new Date(updated.updatedAt).getTime()}` : '';
    return res.json({ avatarUrl: `/users/${req.userId}/avatar${ver}` });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to upload avatar' });
  }
});

// Get user avatar image
usersRouter.get('/:id/avatar', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { avatarUrl: true },
    });
    if (!user?.avatarUrl) return res.status(404).json({ error: 'Avatar not found' });
    const filePath = path.resolve(UPLOAD_DIR, user.avatarUrl);
    return res.sendFile(filePath, { maxAge: 86400 }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Avatar not found' });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch avatar' });
  }
});

// Register / update push device token
usersRouter.post('/me/device-token', async (req, res) => {
  try {
    const { token, platform } = req.body;
    if (!token || !platform) {
      return res.status(400).json({ error: 'token and platform are required' });
    }
    const allowed = ['ios', 'android', 'web'];
    if (!allowed.includes(platform)) {
      return res.status(400).json({ error: `platform must be one of: ${allowed.join(', ')}` });
    }
    await prisma.deviceToken.upsert({
      where: { userId_token: { userId: req.userId, token } },
      create: { userId: req.userId, token, platform },
      update: { platform, updatedAt: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to save device token' });
  }
});

// Remove device token (logout / unregister)
usersRouter.delete('/me/device-token', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });
    await prisma.deviceToken.deleteMany({
      where: { userId: req.userId, token },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete device token' });
  }
});

// Update my profile (phone, jobTitle, statusMessage)
usersRouter.put('/me', async (req, res) => {
  try {
    const { phone, statusMessage, extension, deskPhone, statusNote } = req.body;
    const data = {};
    if (phone !== undefined) data.phone = phone && String(phone).trim() ? String(phone).trim().slice(0, 50) : null;
    if (extension !== undefined) data.extension = extension && String(extension).trim() ? String(extension).trim().slice(0, 30) : null;
    if (deskPhone !== undefined) data.deskPhone = deskPhone && String(deskPhone).trim() ? String(deskPhone).trim().slice(0, 30) : null;
    if (statusMessage !== undefined) data.statusMessage = statusMessage && String(statusMessage).trim() ? String(statusMessage).trim().slice(0, 200) : null;
    if (statusNote !== undefined) data.statusNote = statusNote && String(statusNote).trim() ? String(statusNote).trim().slice(0, 200) : null;
    if (Object.keys(data).length === 0) return res.json({ ok: true });
    await prisma.user.update({
      where: { id: req.userId },
      data,
    });
    const io = req.app.get('io');
    if (io && (data.statusMessage !== undefined || data.statusNote !== undefined || data.extension !== undefined || data.deskPhone !== undefined)) {
      io.emit('user_status_changed', {
        userId: req.userId,
        statusMessage: data.statusMessage !== undefined ? (data.statusMessage ?? null) : undefined,
        statusNote: data.statusNote !== undefined ? (data.statusNote ?? null) : undefined,
        extension: data.extension !== undefined ? (data.extension ?? null) : undefined,
        deskPhone: data.deskPhone !== undefined ? (data.deskPhone ?? null) : undefined,
      });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error('[users/me PUT]', err);
    const msg = err?.message || 'Failed to update profile';
    return res.status(500).json({ error: msg });
  }
});

// Update status message
usersRouter.put('/status', async (req, res) => {
  try {
    const { statusMessage } = req.body;
    await prisma.user.update({
      where: { id: req.userId },
      data: { statusMessage: statusMessage || null },
    });
    const io = req.app.get('io');
    if (io) {
      io.emit('user_status_changed', { userId: req.userId, statusMessage: statusMessage || null });
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

const NOTEPAD_MAX = 20000;

// 개인 메모장 저장 (본인만 조회 가능, 자동저장이라 다른 사용자에게 알릴 필요 없음)
usersRouter.put('/me/notepad', async (req, res) => {
  try {
    const { notepad } = req.body;
    if (notepad !== undefined && notepad !== null && typeof notepad !== 'string') {
      return res.status(400).json({ error: 'notepad must be a string' });
    }
    const value = typeof notepad === 'string' ? notepad.slice(0, NOTEPAD_MAX) : null;
    await prisma.user.update({
      where: { id: req.userId },
      data: { notepad: value },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[users/me/notepad PUT]', err);
    return res.status(500).json({ error: 'Failed to save notepad' });
  }
});

/**
 * GET /users/:id/impact - 이 사용자를 지우면 무엇이 함께 사라지는지.
 * Message.sender가 onDelete: Cascade라 보낸 메시지가 전부 삭제되고,
 * 그 메시지에 달린 반응·읽음·고정도 함께 사라진다. 삭제 전에 반드시 보여줄 것.
 */
usersRouter.get('/:id/impact', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: {
            sentMessages: true,
            sentMemos: true,
            roomMemberships: true,
            createdRooms: true,
          },
        },
      },
    });
    if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    return res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      messageCount: user._count.sentMessages,
      memoCount: user._count.sentMemos,
      roomCount: user._count.roomMemberships,
      createdRoomCount: user._count.createdRooms,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load user impact' });
  }
});

/**
 * DELETE /users/:id - 사용자 삭제 (관리자 전용).
 * 되돌릴 수 없고 보낸 메시지까지 연쇄 삭제되므로 안전장치를 둔다.
 * - 자기 자신은 지울 수 없다
 * - ADMIN_EMAIL 목록의 계정은 지울 수 없다
 * - ?confirmMessages=<수> 가 서버의 실제 메시지 수와 일치해야 진행한다
 *   (목록을 띄워둔 사이 대화가 늘어난 경우 실수로 지우는 것을 막는다)
 */
usersRouter.delete('/:id', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, _count: { select: { sentMessages: true } } },
    });
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (String(target.id) === String(req.userId)) {
      return res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
    }
    if (isAdminEmail(target.email)) {
      return res.status(400).json({ error: 'CANNOT_DELETE_ADMIN' });
    }

    // 클라이언트가 본 메시지 수와 서버 현재 값이 다르면 중단한다.
    // (목록을 띄워둔 사이에 대화가 늘어난 경우 실수로 지우는 것을 막는다)
    const messageCount = target._count.sentMessages;
    const confirmed = Number(req.query.confirmMessages);
    if (!Number.isInteger(confirmed) || confirmed !== messageCount) {
      return res.status(409).json({ error: 'MESSAGE_COUNT_MISMATCH', messageCount });
    }

    await prisma.user.delete({ where: { id: target.id } });
    return res.json({ deleted: true, name: target.name, messageCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /users/:id/reset-password - 관리자가 사용자 비밀번호를 초기화한다.
 * body: { password }
 * 기존 비밀번호를 몰라도 바꿀 수 있는 대신 관리자만 호출할 수 있고,
 * 바꾼 뒤에는 그 사용자의 로그인 세션을 모두 끊어 새 비밀번호로 다시 로그인하게 한다.
 */
usersRouter.post('/:id/reset-password', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const policyError = validatePassword(password);
    if (policyError) return res.status(400).json({ error: policyError });

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true },
    });
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    if (isLdapEnabled() && !isLocalExceptionEmail(target.email)) {
      try {
        await resetLdapPassword(loginIdentifierToUid(target.email), password, { forceChange: true });
      } catch (err) {
        const code = err?.ldapCode || err?.message || 'LDAP_ERROR';
        const status = err?.status || (code === 'PASSWORD_POLICY' || code === 'LDAP_USER_NOT_FOUND' ? 400 : 503);
        return res.status(status).json({ error: code });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { password: hashed } }),
      // 바뀐 비밀번호가 즉시 효력을 갖도록 기존 세션을 모두 정리한다
      prisma.userSession.deleteMany({ where: { userId: target.id } }),
    ]);

    console.log(`[admin] 비밀번호 초기화: ${target.email}`);
    return res.json({ ok: true, name: target.name, email: target.email });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /users/:id/reset-mfa - 관리자가 사용자의 2차 인증을 초기화한다(인증 앱 분실 등).
 * 초기화 후 그 사용자의 세션을 모두 끊는다. 정책이 '필수'면 다음 로그인 때 다시 등록하게 된다.
 */
usersRouter.post('/:id/reset-mfa', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, email: true, totpEnabled: true },
    });
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    await prisma.$transaction([
      prisma.user.update({
        where: { id: target.id },
        data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecoveryCodes: null },
      }),
      prisma.userSession.deleteMany({ where: { userId: target.id } }),
    ]);
    console.log(`[admin] 2차 인증 초기화: ${target.email}`);
    return res.json({ ok: true, name: target.name, email: target.email, wasEnabled: target.totpEnabled });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reset MFA' });
  }
});

/**
 * PUT /users/:id/job-title - 관리자가 특정 사용자의 직급을 지정한다.
 * body: { jobTitle }  비우면 직급 없음으로 만든다.
 * 본인이 직접 바꾸지 못하게 PUT /users/me 에서는 직급을 받지 않는다.
 */
usersRouter.put('/:id/job-title', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const raw = req.body?.jobTitle;
    const jobTitle =
      typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\s+/g, ' ').slice(0, 30) : null;

    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });

    await prisma.user.update({ where: { id: target.id }, data: { jobTitle } });
    return res.json({ ok: true, name: target.name, jobTitle });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update job title' });
  }
});
