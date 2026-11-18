/**
 * 거래처 조직 → PostgreSQL Company/Department 동기화 + User 부서 매핑(이메일).
 * 기본: 이미 있는 User만 departmentId 갱신.
 * createMissingUsers=true 이면 이메일·이름이 있는 재직자를 메신저 계정으로 생성 후 매핑.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { fetchPartnerOrg } from './partnerOrg.js';
import { isPartnerOrgEnabled, getPartnerOrgSource } from './partnerMssql.js';
import { isHrCode } from './partnerHrTitles.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function partnerCompanyName() {
  return (process.env.PARTNER_COMPANY_NAME || '파트너').trim() || '파트너';
}

function partnerCompanyExternalCode(departments) {
  const fromEnv = (process.env.PARTNER_COMPANY_EXTERNAL_CODE || '').trim();
  if (fromEnv) return fromEnv;
  const bs = departments.find((d) => d.businessCode)?.businessCode;
  return bs || 'PARTNER';
}

function partnerDefaultPassword(optsPassword) {
  const fromOpt = typeof optsPassword === 'string' ? optsPassword.trim() : '';
  if (fromOpt) return fromOpt;
  // '123456' 같은 하드코딩된 약한 기본값으로 조용히 넘어가지 않는다 —
  // createMissingUsers를 쓰려면 운영자가 PARTNER_DEFAULT_PASSWORD를 명시적으로 설정해야 한다.
  return (process.env.PARTNER_DEFAULT_PASSWORD || '').trim();
}

/**
 * @param {{ dryRun?: boolean, createMissingUsers?: boolean, defaultPassword?: string }} [opts]
 */
export async function syncPartnerOrg(opts = {}) {
  const dryRun = !!opts.dryRun;
  const createMissingUsers = !!opts.createMissingUsers;
  if (!isPartnerOrgEnabled()) {
    return {
      ok: false,
      error: 'PARTNER_ORG_SOURCE is off (set mock or mssql)',
      source: getPartnerOrgSource(),
    };
  }

  const { departments, employees, source } = await fetchPartnerOrg();
  const companyExt = partnerCompanyExternalCode(departments);
  const companyName = partnerCompanyName();
  const defaultPassword = partnerDefaultPassword(opts.defaultPassword);

  const stats = {
    source,
    dryRun,
    createMissingUsers,
    companyExternalCode: companyExt,
    departmentsFetched: departments.length,
    employeesFetched: employees.length,
    departmentsUpserted: 0,
    usersMatched: 0,
    usersCreated: 0,
    usersUpdated: 0,
    usersEmailMigrated: 0,
    migratedEmails: /** @type {string[]} */ ([]),
    usersUnmatched: 0,
    usersSkippedInvalidEmail: 0,
    usersIdentityMismatch: 0,
    identityMismatchEmails: /** @type {string[]} */ ([]),
    unmatchedEmails: /** @type {string[]} */ ([]),
    createdEmails: /** @type {string[]} */ ([]),
    employeesWithoutEmail: 0,
    employeesWithoutDept: 0,
  };

  if (createMissingUsers && (!defaultPassword || defaultPassword.length < 4)) {
    return {
      ok: false,
      error: 'defaultPassword / PARTNER_DEFAULT_PASSWORD must be at least 4 characters',
      ...stats,
    };
  }

  if (dryRun) {
    const emails = employees.filter((e) => e.email).map((e) => e.email);
    const existing = emails.length
      ? await prisma.user.findMany({
          where: { email: { in: emails } },
          select: { email: true },
        })
      : [];
    const existingSet = new Set(existing.map((u) => u.email.toLowerCase()));
    const dryIds = employees.map((e) => e.masterId).filter(Boolean);
    const existingById = dryIds.length
      ? await prisma.user.findMany({
          where: { externalEmpId: { in: dryIds } },
          select: { externalEmpId: true },
        })
      : [];
    const existingIdSet = new Set(existingById.map((u) => u.externalEmpId));
    for (const e of employees) {
      if (!e.email) {
        stats.employeesWithoutEmail += 1;
        continue;
      }
      if (!EMAIL_RE.test(e.email)) {
        stats.usersSkippedInvalidEmail += 1;
        continue;
      }
      if (!e.deptCode) stats.employeesWithoutDept += 1;
      if (existingSet.has(e.email)) stats.usersMatched += 1;
      else if (e.masterId && existingIdSet.has(e.masterId)) {
        stats.usersEmailMigrated += 1;
        stats.usersMatched += 1;
        if (stats.migratedEmails.length < 50) stats.migratedEmails.push(e.email);
      } else if (createMissingUsers && e.name) {
        stats.usersCreated += 1;
        if (stats.createdEmails.length < 50) stats.createdEmails.push(e.email);
      } else {
        stats.usersUnmatched += 1;
        if (stats.unmatchedEmails.length < 50) stats.unmatchedEmails.push(e.email);
      }
    }
    return { ok: true, ...stats };
  }

  const company = await prisma.company.upsert({
    where: { externalCode: companyExt },
    create: { name: companyName, externalCode: companyExt },
    update: { name: companyName },
  });

  /** @type {Map<string, string>} deptCode → pg department id */
  const deptIdByCode = new Map();

  // 1차: 부서 upsert (부모는 나중에)
  for (const d of departments) {
    const existing = await prisma.department.findFirst({
      where: { companyId: company.id, externalCode: d.deptCode },
    });
    const sortOrder = (Number(d.level) || 1) * 1000;
    let row;
    if (existing) {
      row = await prisma.department.update({
        where: { id: existing.id },
        data: { name: d.deptName, sortOrder },
      });
    } else {
      row = await prisma.department.create({
        data: {
          name: d.deptName,
          companyId: company.id,
          externalCode: d.deptCode,
          sortOrder,
          parentId: null,
        },
      });
    }
    deptIdByCode.set(d.deptCode, row.id);
    stats.departmentsUpserted += 1;
  }

  // 2차: 부모 연결
  for (const d of departments) {
    const id = deptIdByCode.get(d.deptCode);
    if (!id) continue;
    const parentId = d.upDept ? deptIdByCode.get(d.upDept) ?? null : null;
    await prisma.department.update({
      where: { id },
      data: { parentId: parentId && parentId !== id ? parentId : null },
    });
  }

  // 이메일로 User 매칭 (+ 옵션: 없는 계정 생성)
  const emails = [...new Set(employees.map((e) => e.email).filter(Boolean))];
  const users = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true, departmentId: true, name: true, phone: true, jobTitle: true, externalEmpId: true },
      })
    : [];
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  // 사번(externalEmpId)으로도 매칭: 이전에 가상 이메일(사번@...local)로 만들어진 계정이
  // ERP에 실제 이메일이 생긴 뒤에도 같은 사람으로 이어지도록 한다.
  const masterIds = [...new Set(employees.map((e) => e.masterId).filter(Boolean))];
  const usersById = masterIds.length
    ? await prisma.user.findMany({
        where: { externalEmpId: { in: masterIds } },
        select: { id: true, email: true, departmentId: true, name: true, phone: true, jobTitle: true, externalEmpId: true },
      })
    : [];
  const userByEmpId = new Map(usersById.map((u) => [u.externalEmpId, u]));

  let passwordHash = null;
  if (createMissingUsers) {
    passwordHash = await bcrypt.hash(defaultPassword, 10);
  }

  for (const e of employees) {
    if (!e.email) {
      stats.employeesWithoutEmail += 1;
      continue;
    }
    if (!EMAIL_RE.test(e.email)) {
      stats.usersSkippedInvalidEmail += 1;
      continue;
    }
    if (!e.deptCode) stats.employeesWithoutDept += 1;

    let user = userByEmail.get(e.email);
    if (!user && e.masterId) {
      const byId = userByEmpId.get(e.masterId);
      if (byId && byId.email.toLowerCase() !== e.email) {
        try {
          await prisma.user.update({ where: { id: byId.id }, data: { email: e.email } });
          user = { ...byId, email: e.email };
          userByEmail.set(e.email, user);
          stats.usersEmailMigrated += 1;
          stats.usersMatched += 1;
          if (stats.migratedEmails.length < 50) stats.migratedEmails.push(e.email);
        } catch (err) {
          console.error('[syncPartnerOrg] email migrate failed', byId.email, '->', e.email, err?.message || err);
        }
      }
    }
    if (!user) {
      if (!createMissingUsers || !e.name) {
        stats.usersUnmatched += 1;
        if (stats.unmatchedEmails.length < 50) stats.unmatchedEmails.push(e.email);
        continue;
      }
      const departmentId = e.deptCode ? deptIdByCode.get(e.deptCode) ?? null : null;
      const jobTitle = e.jobTitle || null;
      try {
        user = await prisma.user.create({
          data: {
            email: e.email,
            name: e.name,
            password: passwordHash,
            phone: e.phone,
            jobTitle,
            departmentId,
            externalEmpId: e.masterId,
            // 전 직원이 동일한 공용 초기비밀번호를 받으므로, 최초 로그인 시
            // 반드시 본인 비밀번호로 바꾸도록 강제한다.
            mustChangePassword: true,
          },
          select: { id: true, email: true, departmentId: true, name: true, phone: true, jobTitle: true, externalEmpId: true },
        });
        userByEmail.set(e.email, user);
        stats.usersCreated += 1;
        stats.usersMatched += 1;
        if (stats.createdEmails.length < 50) stats.createdEmails.push(e.email);
      } catch (err) {
        if (err?.code === 'P2002') {
          // 이메일/externalEmpId 충돌 — 이메일로 재조회 후 갱신 시도
          user = await prisma.user.findUnique({
            where: { email: e.email },
            select: { id: true, email: true, departmentId: true, name: true, phone: true, jobTitle: true, externalEmpId: true },
          });
          if (!user) {
            console.error('[syncPartnerOrg] create user conflict', e.email, err?.message || err);
            stats.usersUnmatched += 1;
            if (stats.unmatchedEmails.length < 50) stats.unmatchedEmails.push(e.email);
            continue;
          }
          userByEmail.set(e.email, user);
          stats.usersMatched += 1;
        } else {
          console.error('[syncPartnerOrg] create user failed', e.email, err?.message || err);
          stats.usersUnmatched += 1;
          if (stats.unmatchedEmails.length < 50) stats.unmatchedEmails.push(e.email);
          continue;
        }
      }
    } else {
      stats.usersMatched += 1;
    }

    // 이미 특정 거래처 사번(externalEmpId)에 연결된 계정인데, 이번 파트너 레코드가
    // 같은 이메일에 다른 사번을 주장하는 경우 — 이메일 재사용/오타 등으로 다른 사람의
    // 계정을 덮어쓸 위험이 있으므로 프로필 갱신을 건너뛰고 수동 확인이 필요함을 남긴다.
    if (user.externalEmpId && e.masterId && user.externalEmpId !== e.masterId) {
      console.warn(
        `[syncPartnerOrg] identity mismatch for ${e.email}: local externalEmpId=${user.externalEmpId} vs partner masterId=${e.masterId} — skipping profile update`
      );
      stats.usersIdentityMismatch += 1;
      if (stats.identityMismatchEmails.length < 50) stats.identityMismatchEmails.push(e.email);
      continue;
    }

    const departmentId = e.deptCode ? deptIdByCode.get(e.deptCode) ?? null : null;
    const jobTitle = e.jobTitle || (isHrCode(user.jobTitle) ? null : user.jobTitle) || null;
    const data = {
      departmentId,
      externalEmpId: e.masterId,
      ...(e.name ? { name: e.name } : {}),
      ...(e.phone ? { phone: e.phone } : {}),
      ...(jobTitle !== user.jobTitle ? { jobTitle } : {}),
    };

    const changed =
      user.departmentId !== departmentId
      || user.externalEmpId !== e.masterId
      || (e.name && user.name !== e.name)
      || (e.phone && user.phone !== e.phone)
      || user.jobTitle !== jobTitle;

    if (changed) {
      await prisma.user.update({ where: { id: user.id }, data });
      stats.usersUpdated += 1;
      userByEmail.set(e.email, { ...user, ...data });
    }
    if (departmentId) {
      try {
        await prisma.userAffiliation.upsert({
          where: { userId_departmentId: { userId: user.id, departmentId } },
          create: { userId: user.id, departmentId },
          update: {},
        });
      } catch (err) {
        console.warn('[syncPartnerOrg] affiliation upsert skipped:', err?.message || err);
      }
    }
  }

  return { ok: true, companyId: company.id, ...stats };
}
