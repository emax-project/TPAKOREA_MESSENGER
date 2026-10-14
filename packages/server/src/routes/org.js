import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { assertAdmin } from '../lib/admin.js';
import * as onlineUsers from '../onlineUsers.js';
import { getPartnerOrgSource, isPartnerOrgEnabled } from '../lib/partnerMssql.js';
import { getHrTitleMap, resolveHrTitle } from '../lib/partnerHrTitles.js';
import { syncPartnerOrg } from '../lib/syncPartnerOrg.js';

const NAME_MAX = 60;

/** 부서/직급 이름 정규화. 앞뒤 공백 제거 + 연속 공백 1칸. */
function normalizeName(v) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) : '';
}

export const orgRouter = Router();
orgRouter.use(authMiddleware);

/** GET /org/online - 현재 로그인(연결) 중인 사용자 및 디바이스별 상태 */
orgRouter.get('/online', async (_req, res) => {
  try {
    const userIds = onlineUsers.getAll();
    const presence = onlineUsers.getPresenceMap();
    return res.json({ userIds, presence });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to get online users' });
  }
});

/**
 * GET /org/tree - 회사 > 부서(계층) > 사용자 트리. 로그인한 나는 없으면 첫 부서에 포함
 * ?shallow=1 이면 부서 구조 + 인원수(userCount)만 내려주고 users는 비워둔다.
 * 실제 사용자 목록은 부서를 펼칠 때 GET /org/departments/:id/users 로 따로 가져온다
 * (조직이 커질수록 한 번에 전체 인원을 내려주는 비용이 커지는 것을 피하기 위함).
 */
orgRouter.get('/tree', async (req, res) => {
  try {
    // 거래처 MSSQL 연동 중이면 해당 회사(externalCode)만 조직도에 노출
    const partnerCode = (process.env.PARTNER_COMPANY_EXTERNAL_CODE || '').trim();
    const companyWhere =
      getPartnerOrgSource() === 'mssql' && partnerCode
        ? { externalCode: partnerCode }
        : undefined;

    const shallow = req.query.shallow === '1' || req.query.shallow === 'true';
    if (shallow) {
      const companies = await prisma.company.findMany({
        where: companyWhere,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          departments: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        },
      });

      // 인원수 = 직속(departmentId) ∪ 세컨더리 소속(userAffiliation), 같은 사람이
      // 두 경로로 모두 걸려 있는 경우도 있어(부서 데이터 중복) 사용자 id 기준으로 중복 제거해서 센다.
      // id만 필요하므로 department.users 전체를 include하는 것보다 훨씬 가볍다.
      const [directUsers, affiliationRows] = await Promise.all([
        prisma.user.findMany({ where: { departmentId: { not: null } }, select: { id: true, departmentId: true } }),
        prisma.userAffiliation.findMany({ select: { userId: true, departmentId: true } }).catch((err) => {
          console.warn('[org/tree shallow] affiliation counts unavailable:', err?.message || err);
          return [];
        }),
      ]);
      const userIdsByDept = new Map();
      const addUser = (deptId, userId) => {
        if (!userIdsByDept.has(deptId)) userIdsByDept.set(deptId, new Set());
        userIdsByDept.get(deptId).add(userId);
      };
      directUsers.forEach((u) => addUser(u.departmentId, u.id));
      affiliationRows.forEach((a) => addUser(a.departmentId, a.userId));

      const nestShallow = (departments) => {
        const nodes = new Map();
        departments.forEach((d) => {
          nodes.set(d.id, {
            id: d.id,
            name: d.name,
            parentId: d.parentId ?? null,
            userCount: userIdsByDept.get(d.id)?.size ?? 0,
            users: [],
            children: [],
          });
        });
        const roots = [];
        nodes.forEach((node) => {
          const parent = node.parentId ? nodes.get(node.parentId) : null;
          if (parent) parent.children.push(node);
          else roots.push(node);
        });
        return roots;
      };

      const tree = companies.map((c) => ({ id: c.id, name: c.name, departments: nestShallow(c.departments) }));
      return res.json(tree);
    }

    let hrTitleMap = new Map();
    try {
      hrTitleMap = await getHrTitleMap();
    } catch (err) {
      console.warn('[org/tree] HR title map unavailable:', err?.message || err);
    }

    const companies = await prisma.company.findMany({
      where: companyWhere,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        departments: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            users: {
              orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
              select: { id: true, name: true, email: true, phone: true, extension: true, deskPhone: true, jobTitle: true, statusMessage: true, statusNote: true, avatarUrl: true, updatedAt: true, sortOrder: true },
            },
          },
        },
      },
    });
    const myId = String(req.userId || '');
    const toUserWithAvatarPath = (u, deptCtx) => {
      const ver = u.updatedAt ? `?v=${new Date(u.updatedAt).getTime()}` : '';
      return {
        ...u,
        jobTitle: resolveHrTitle(u.jobTitle, hrTitleMap) ?? u.jobTitle,
        avatarUrl: u.avatarUrl ? `/users/${u.id}/avatar${ver}` : null,
        deptName: deptCtx?.deptName ?? null,
        companyName: deptCtx?.companyName ?? null,
        companyAddress: deptCtx?.companyAddress ?? null,
      };
    };

    let extraAffiliations = [];
    try {
      extraAffiliations = await prisma.userAffiliation.findMany({
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true, extension: true, deskPhone: true, jobTitle: true, statusMessage: true, statusNote: true, avatarUrl: true, updatedAt: true },
          },
        },
      });
    } catch (err) {
      console.warn('[org/tree] affiliations unavailable:', err?.message || err);
    }
    const extrasByDept = new Map();
    for (const row of extraAffiliations) {
      const list = extrasByDept.get(row.departmentId) || [];
      list.push(row.user);
      extrasByDept.set(row.departmentId, list);
    }

    const nest = (departments, companyCtx) => {
      const nodes = new Map();
      departments.forEach((d) => {
        const deptCtx = { deptName: d.name, companyName: companyCtx.companyName, companyAddress: companyCtx.companyAddress };
        const seen = new Set(d.users.map((u) => String(u.id)));
        // 겸직(세컨더리 소속)으로 걸린 사람은 이 부서 안에서 순번을 갖지 않으므로 이름순으로만 맨 뒤에 붙인다.
        // 직속(d.users)은 이미 쿼리에서 sortOrder순으로 왔으니 그대로 둔다.
        const extras = (extrasByDept.get(d.id) || [])
          .filter((u) => !seen.has(String(u.id)))
          .sort((a, b) => a.name.localeCompare(b.name));
        nodes.set(d.id, {
          id: d.id,
          name: d.name,
          parentId: d.parentId ?? null,
          // primary=false(겸직)는 이 부서 안에서 순번을 갖지 않는다 — 관리 화면에서 순번 버튼을 숨기는 기준.
          users: [
            ...d.users.map((u) => ({ ...toUserWithAvatarPath(u, deptCtx), primary: true })),
            ...extras.map((u) => ({ ...toUserWithAvatarPath(u, deptCtx), primary: false })),
          ],
          children: [],
        });
      });
      const roots = [];
      nodes.forEach((node) => {
        // 상위가 다른 회사에 있거나 사라진 경우엔 최상위로 취급한다
        const parent = node.parentId ? nodes.get(node.parentId) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
      });
      return roots;
    };

    let tree = companies.map((c) => ({
      id: c.id,
      name: c.name,
      departments: nest(c.departments, { companyName: c.name, companyAddress: c.address ?? null }),
    }));

    const allUserIds = new Set();
    const walk = (depts, fn) => depts.forEach((d) => { fn(d); walk(d.children, fn); });
    tree.forEach((c) => walk(c.departments, (d) => d.users.forEach((u) => allUserIds.add(String(u.id)))));
    if (!allUserIds.has(myId)) {
      const me = await prisma.user.findUnique({
        where: { id: myId },
        select: { id: true, name: true, email: true, phone: true, extension: true, deskPhone: true, jobTitle: true, statusMessage: true, statusNote: true, avatarUrl: true, updatedAt: true },
      });
      if (me && tree.length > 0 && (tree[0]?.departments?.length ?? 0) > 0) {
        const firstDept = tree[0].departments[0];
        const deptCtx = { deptName: firstDept.name, companyName: tree[0].name, companyAddress: companies[0]?.address ?? null };
        // 부서 정렬 순서를 흐트러뜨리지 않도록 맨 뒤에 붙인다 (이 사람은 어느 부서에도 안 걸려 있던 예외 케이스).
        firstDept.users = [...firstDept.users, { ...toUserWithAvatarPath(me, deptCtx), primary: false }];
      }
    }

    return res.json(tree);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch org tree' });
  }
});

/**
 * GET /org/departments/:id/users - 부서를 펼칠 때 그 부서(하위 부서 제외) 소속 사용자 목록을 지연 로드.
 * GET /org/tree?shallow=1 과 짝을 이룬다.
 */
orgRouter.get('/departments/:id/users', async (req, res) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { company: true },
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    // 거래처 MSSQL 연동 중이면 해당 회사 소속 부서만 조회 허용 (조직도 노출 범위와 동일하게 맞춤)
    const partnerCode = (process.env.PARTNER_COMPANY_EXTERNAL_CODE || '').trim();
    if (getPartnerOrgSource() === 'mssql' && partnerCode && dept.company?.externalCode !== partnerCode) {
      return res.status(404).json({ error: 'Department not found' });
    }

    let hrTitleMap = new Map();
    try {
      hrTitleMap = await getHrTitleMap();
    } catch (err) {
      console.warn('[org/departments/:id/users] HR title map unavailable:', err?.message || err);
    }

    const userSelect = { id: true, name: true, email: true, phone: true, extension: true, deskPhone: true, jobTitle: true, statusMessage: true, statusNote: true, avatarUrl: true, updatedAt: true, sortOrder: true };
    const users = await prisma.user.findMany({
      where: { departmentId: dept.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: userSelect,
    });

    let extras = [];
    try {
      const rows = await prisma.userAffiliation.findMany({
        where: { departmentId: dept.id },
        include: { user: { select: userSelect } },
      });
      extras = rows.map((r) => r.user).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      console.warn('[org/departments/:id/users] affiliations unavailable:', err?.message || err);
    }
    const seen = new Set(users.map((u) => String(u.id)));
    const extrasOnly = extras.filter((u) => !seen.has(String(u.id)));

    const deptCtx = { deptName: dept.name, companyName: dept.company?.name ?? null, companyAddress: dept.company?.address ?? null };
    const toUserWithAvatarPath = (u) => {
      const ver = u.updatedAt ? `?v=${new Date(u.updatedAt).getTime()}` : '';
      return {
        ...u,
        jobTitle: resolveHrTitle(u.jobTitle, hrTitleMap) ?? u.jobTitle,
        avatarUrl: u.avatarUrl ? `/users/${u.id}/avatar${ver}` : null,
        deptName: deptCtx.deptName,
        companyName: deptCtx.companyName,
        companyAddress: deptCtx.companyAddress,
      };
    };

    // 직속(users)은 sortOrder순, 겸직(extrasOnly)은 이름순으로 맨 뒤에 붙인다 — GET /org/tree와 동일한 규칙.
    return res.json([
      ...users.map((u) => ({ ...toUserWithAvatarPath(u), primary: true })),
      ...extrasOnly.map((u) => ({ ...toUserWithAvatarPath(u), primary: false })),
    ]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch department users' });
  }
});

/**
 * GET /org/partner-sync/status - 거래처 조직 연동 설정 상태
 */
orgRouter.get('/partner-sync/status', async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  const source = getPartnerOrgSource();
  return res.json({
    enabled: isPartnerOrgEnabled(),
    source,
    companyName: process.env.PARTNER_COMPANY_NAME || '파트너',
    mssqlConfigured: !!(
      process.env.PARTNER_MSSQL_SERVER
      && process.env.PARTNER_MSSQL_DATABASE
      && process.env.PARTNER_MSSQL_USER
    ),
  });
});

/**
 * POST /org/partner-sync - 거래처 MSSQL(또는 mock) → PG 조직 동기화
 * body: { dryRun?: boolean, createMissingUsers?: boolean, defaultPassword?: string }
 */
orgRouter.post('/partner-sync', async (req, res) => {
  if (!(await assertAdmin(req, res))) return;
  try {
    if (!isPartnerOrgEnabled()) {
      return res.status(400).json({
        error: 'PARTNER_ORG_SOURCE is off. Set PARTNER_ORG_SOURCE=mock|mssql',
      });
    }
    const dryRun = !!(req.body && req.body.dryRun);
    const createMissingUsers = !!(req.body && req.body.createMissingUsers);
    const defaultPassword =
      typeof req.body?.defaultPassword === 'string' ? req.body.defaultPassword : undefined;
    const result = await syncPartnerOrg({ dryRun, createMissingUsers, defaultPassword });
    if (!result.ok) return res.status(400).json(result);
    return res.json(result);
  } catch (err) {
    console.error('[partner-sync]', err);
    return res.status(500).json({
      error: 'Partner org sync failed',
      detail: err?.message || String(err),
    });
  }
});

/* ------------------------------------------------------------------ *
 * 회사 관리 (조회는 로그인 사용자, 순서 변경은 관리자)
 * 회사 추가·이름 변경·삭제는 부서 등록 화면(companyName)과 거래처 동기화가 맡고,
 * 여기서는 조직도에 노출되는 순서만 다룬다.
 * ------------------------------------------------------------------ */

/** GET /org/companies - 회사 목록. 정렬 순서와 부서·인원 수를 함께 준다. */
orgRouter.get('/companies', async (_req, res) => {
  try {
    const companies = await prisma.company.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        departments: { select: { _count: { select: { users: true } } } },
      },
    });
    return res.json(
      companies.map((c, i) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder,
        order: i + 1,
        departmentCount: c.departments.length,
        userCount: c.departments.reduce((sum, d) => sum + d._count.users, 0),
      })),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

/**
 * PUT /org/companies/:id/order - 회사 목록 순번을 한 칸 올리거나 내린다.
 * body: { direction: 'up' | 'down' }
 * 기존 행들이 전부 sortOrder=0일 수 있으므로, 이동할 때마다 전체를 1..n으로 다시 매긴다.
 */
orgRouter.put('/companies/:id/order', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ error: "direction must be 'up' or 'down'" });
    }

    const target = await prisma.company.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'COMPANY_NOT_FOUND' });

    const companies = await prisma.company.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const index = companies.findIndex((c) => c.id === target.id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= companies.length) {
      return res.json({ moved: false, reason: 'ALREADY_AT_EDGE' });
    }

    const reordered = [...companies];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    await prisma.$transaction(
      reordered.map((c, i) => prisma.company.update({ where: { id: c.id }, data: { sortOrder: i + 1 } })),
    );
    return res.json({ moved: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reorder company' });
  }
});

/* ------------------------------------------------------------------ *
 * 부서 관리 (조회는 로그인 사용자, 추가·수정·삭제는 관리자)
 * ------------------------------------------------------------------ */

/**
 * GET /org/departments - 부서 목록.
 * 트리 순서(상위 → 하위)로 정렬해 depth와 전체 경로를 함께 준다.
 * userCount는 그 부서에 직접 속한 인원, totalUserCount는 하위 부서까지 합친 인원.
 */
orgRouter.get('/departments', async (_req, res) => {
  try {
    const departments = await prisma.department.findMany({
      orderBy: [
        { company: { sortOrder: 'asc' } },
        { company: { name: 'asc' } },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { users: true } },
      },
    });

    const byParent = new Map();
    departments.forEach((d) => {
      const key = d.parentId ?? `root:${d.companyId}`;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(d);
    });
    const known = new Set(departments.map((d) => d.id));

    const out = [];
    const walk = (parentKey, depth, prefix) => {
      // 저장된 sortOrder가 0으로 비어 있어도 순번은 항상 1,2,3...으로 보이게 한다
      (byParent.get(parentKey) || []).forEach((d, i) => {
        const path = prefix ? `${prefix} > ${d.name}` : d.name;
        out.push({
          id: d.id,
          name: d.name,
          parentId: d.parentId ?? null,
          companyId: d.companyId,
          companyName: d.company.name,
          userCount: d._count.users,
          sortOrder: d.sortOrder,
          order: i + 1,
          depth,
          path,
        });
        walk(d.id, depth + 1, path);
      });
    };
    const companyIds = [...new Set(departments.map((d) => d.companyId))];
    companyIds.forEach((cid) => walk(`root:${cid}`, 0, ''));
    // 상위가 사라졌는데 parentId만 남은 고아 부서도 빠뜨리지 않는다
    departments.forEach((d) => {
      if (d.parentId && !known.has(d.parentId) && !out.some((o) => o.id === d.id)) {
        out.push({
          id: d.id,
          name: d.name,
          parentId: null,
          companyId: d.companyId,
          companyName: d.company.name,
          userCount: d._count.users,
          sortOrder: d.sortOrder,
          order: out.length + 1,
          depth: 0,
          path: d.name,
        });
      }
    });

    // 하위 부서 인원까지 합산
    const directCount = new Map(out.map((d) => [d.id, d.userCount]));
    const childrenOf = new Map();
    out.forEach((d) => {
      if (!childrenOf.has(d.parentId)) childrenOf.set(d.parentId, []);
      childrenOf.get(d.parentId).push(d.id);
    });
    const totalOf = (id) =>
      (directCount.get(id) ?? 0) +
      (childrenOf.get(id) || []).reduce((sum, cid) => sum + totalOf(cid), 0);

    return res.json(out.map((d) => ({ ...d, totalUserCount: totalOf(d.id) })));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * POST /org/departments - 부서 추가.
 * body: { name, parentId?, companyName? }
 * parentId를 주면 그 부서의 하위로 만들고 회사도 상위를 따른다.
 */
orgRouter.post('/departments', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const name = normalizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const parentId = typeof req.body?.parentId === 'string' && req.body.parentId ? req.body.parentId : null;
    let companyId;
    if (parentId) {
      const parent = await prisma.department.findUnique({ where: { id: parentId } });
      if (!parent) return res.status(404).json({ error: 'PARENT_NOT_FOUND' });
      companyId = parent.companyId;
    } else {
      const companyName = normalizeName(req.body?.companyName);
      let company = companyName
        ? await prisma.company.findFirst({ where: { name: companyName } })
        : await prisma.company.findFirst({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
      if (!company) {
        if (!companyName) return res.status(400).json({ error: 'companyName is required' });
        const lastCompany = await prisma.company.findFirst({ orderBy: { sortOrder: 'desc' } });
        company = await prisma.company.create({
          data: { name: companyName, sortOrder: (lastCompany?.sortOrder ?? 0) + 1 },
        });
      }
      companyId = company.id;
    }

    // 같은 부모 아래에서만 이름 중복을 막는다(다른 본부에 같은 이름의 팀은 허용)
    const dup = await prisma.department.findFirst({ where: { name, companyId, parentId } });
    if (dup) return res.status(409).json({ error: 'DEPARTMENT_EXISTS' });

    const last = await prisma.department.findFirst({
      where: { companyId, parentId },
      orderBy: { sortOrder: 'desc' },
    });
    const created = await prisma.department.create({
      data: { name, companyId, parentId, sortOrder: (last?.sortOrder ?? 0) + 1 },
      include: { company: { select: { name: true } } },
    });
    return res.status(201).json({
      id: created.id,
      name: created.name,
      parentId: created.parentId,
      companyId,
      companyName: created.company.name,
      userCount: 0,
      totalUserCount: 0,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create department' });
  }
});

/**
 * PUT /org/departments/:id - 이름 변경 및/또는 상위 부서 이동.
 * body: { name?, parentId? }  parentId를 null로 주면 최상위로 올린다.
 * 자기 자신이나 자기 하위로는 옮길 수 없다(순환 방지).
 */
orgRouter.put('/departments/:id', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const target = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'DEPARTMENT_NOT_FOUND' });

    const hasName = req.body?.name !== undefined;
    const name = hasName ? normalizeName(req.body.name) : target.name;
    if (hasName && !name) return res.status(400).json({ error: 'name is required' });

    const movingParent = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId');
    const nextParentId = movingParent
      ? (typeof req.body.parentId === 'string' && req.body.parentId ? req.body.parentId : null)
      : (target.parentId ?? null);

    let companyId = target.companyId;
    if (movingParent && nextParentId) {
      if (nextParentId === target.id) {
        return res.status(400).json({ error: 'CANNOT_MOVE_INTO_SELF' });
      }
      const parent = await prisma.department.findUnique({ where: { id: nextParentId } });
      if (!parent) return res.status(404).json({ error: 'PARENT_NOT_FOUND' });

      // 새 부모가 자기 자손이면 순환이 된다
      const all = await prisma.department.findMany({ select: { id: true, parentId: true } });
      const parentOf = new Map(all.map((d) => [d.id, d.parentId]));
      for (let cur = parent.parentId; cur; cur = parentOf.get(cur)) {
        if (cur === target.id) return res.status(400).json({ error: 'CANNOT_MOVE_INTO_DESCENDANT' });
      }
      companyId = parent.companyId;
    }

    const dup = await prisma.department.findFirst({
      where: { name, companyId, parentId: nextParentId, id: { not: target.id } },
    });
    if (dup) return res.status(409).json({ error: 'DEPARTMENT_EXISTS' });

    const updated = await prisma.department.update({
      where: { id: target.id },
      data: { name, parentId: nextParentId, companyId },
    });
    return res.json({ id: updated.id, name: updated.name, parentId: updated.parentId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update department' });
  }
});

/**
 * DELETE /org/departments/:id - 부서 삭제.
 * - 소속 인원이 남아 있으면 지우지 않고 409 (사용자가 딸려 삭제되는 사고 방지).
 *   ?moveToId=<부서id> 를 주면 인원을 그 부서로 옮긴 뒤 삭제한다.
 * - 하위 부서는 삭제되지 않고 지워진 부서의 상위로 올라간다.
 */
orgRouter.delete('/departments/:id', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const target = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, children: true } } },
    });
    if (!target) return res.status(404).json({ error: 'DEPARTMENT_NOT_FOUND' });

    const userCount = target._count.users;
    const childCount = target._count.children;
    const moveToId = typeof req.query.moveToId === 'string' ? req.query.moveToId : '';

    if (userCount > 0 && !moveToId) {
      return res.status(409).json({ error: 'DEPARTMENT_NOT_EMPTY', userCount });
    }

    // 하위 부서를 지워질 부서의 상위로 끌어올린다
    const promoteChildren = prisma.department.updateMany({
      where: { parentId: target.id },
      data: { parentId: target.parentId ?? null },
    });

    if (userCount > 0) {
      if (moveToId === target.id) {
        return res.status(400).json({ error: 'moveToId must differ from the deleted department' });
      }
      const dest = await prisma.department.findUnique({ where: { id: moveToId } });
      if (!dest) return res.status(404).json({ error: 'MOVE_TARGET_NOT_FOUND' });

      await prisma.$transaction([
        prisma.user.updateMany({
          where: { departmentId: target.id },
          data: { departmentId: dest.id },
        }),
        promoteChildren,
        prisma.department.delete({ where: { id: target.id } }),
      ]);
      return res.json({ deleted: true, movedUsers: userCount, movedTo: dest.name, promotedChildren: childCount });
    }

    await prisma.$transaction([promoteChildren, prisma.department.delete({ where: { id: target.id } })]);
    return res.json({ deleted: true, movedUsers: 0, promotedChildren: childCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete department' });
  }
});

/* ------------------------------------------------------------------ *
 * 직급 관리
 * 직급은 별도 테이블 없이 User.jobTitle 문자열로 저장된다.
 * 그래서 "목록"은 실제 사용 중인 값을 모아 만들고, "수정"은 일괄 치환이다.
 * ------------------------------------------------------------------ */

/**
 * GET /org/job-titles - 직급 목록.
 * 마스터로 등록한 직급과, 마스터엔 없지만 실제로 사용자에게 붙어 있는 직급을 합쳐서 준다.
 * inMaster=false 는 예전에 자유 입력으로 들어간 값이라는 뜻이다.
 */
orgRouter.get('/job-titles', async (_req, res) => {
  try {
    const [master, grouped] = await Promise.all([
      prisma.jobTitle.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      prisma.user.groupBy({
        by: ['jobTitle'],
        where: { jobTitle: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map();
    grouped.forEach((g) => {
      const name = (g.jobTitle || '').trim();
      if (name) counts.set(name, g._count._all);
    });

    const out = master.map((m, i) => ({
      name: m.name,
      userCount: counts.get(m.name) ?? 0,
      inMaster: true,
      sortOrder: m.sortOrder,
      order: i + 1,
    }));

    // 마스터에 없는데 쓰이고 있는 직급을 뒤에 붙인다
    const known = new Set(master.map((m) => m.name));
    [...counts.entries()]
      .filter(([name]) => !known.has(name))
      .sort((a, b) => a[0].localeCompare(b[0], 'ko'))
      .forEach(([name, userCount]) => {
        out.push({ name, userCount, inMaster: false, sortOrder: Number.MAX_SAFE_INTEGER, order: null });
      });

    return res.json(out);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch job titles' });
  }
});

/** POST /org/job-titles - 직급 추가. 아무도 쓰지 않아도 목록에 남는다. body: { name } */
orgRouter.post('/job-titles', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const name = normalizeName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const dup = await prisma.jobTitle.findUnique({ where: { name } });
    if (dup) return res.status(409).json({ error: 'JOB_TITLE_EXISTS' });

    const last = await prisma.jobTitle.findFirst({ orderBy: { sortOrder: 'desc' } });
    const created = await prisma.jobTitle.create({
      data: { name, sortOrder: (last?.sortOrder ?? 0) + 1 },
    });
    const userCount = await prisma.user.count({ where: { jobTitle: name } });
    return res.status(201).json({
      name: created.name,
      userCount,
      inMaster: true,
      sortOrder: created.sortOrder,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create job title' });
  }
});

/**
 * DELETE /org/job-titles/:name - 직급을 목록에서 제거.
 * 이 직급을 쓰는 사용자가 있으면 409. 사용자까지 정리하려면 PUT으로 빈 값 치환을 쓴다.
 */
orgRouter.delete('/job-titles/:name', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const name = normalizeName(req.params.name);
    if (!name) return res.status(400).json({ error: 'name is required' });

    const userCount = await prisma.user.count({ where: { jobTitle: name } });
    if (userCount > 0) return res.status(409).json({ error: 'JOB_TITLE_IN_USE', userCount });

    await prisma.jobTitle.deleteMany({ where: { name } });
    return res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to delete job title' });
  }
});

/**
 * PUT /org/job-titles - 직급 일괄 변경. body: { from, to }
 * 사용자의 직급 문자열과 마스터 목록을 함께 바꾼다.
 * to를 비우면 사용자 직급을 지우고 마스터에서도 뺀다.
 */
orgRouter.put('/job-titles', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const from = normalizeName(req.body?.from);
    if (!from) return res.status(400).json({ error: 'from is required' });

    const to = normalizeName(req.body?.to);
    if (from === to) return res.json({ updated: 0, from, to });

    if (to) {
      const dup = await prisma.jobTitle.findUnique({ where: { name: to } });
      if (dup) return res.status(409).json({ error: 'JOB_TITLE_EXISTS' });
    }

    const { count } = await prisma.user.updateMany({
      where: { jobTitle: from },
      data: { jobTitle: to || null },
    });

    const master = await prisma.jobTitle.findUnique({ where: { name: from } });
    if (master) {
      if (to) await prisma.jobTitle.update({ where: { id: master.id }, data: { name: to } });
      else await prisma.jobTitle.delete({ where: { id: master.id } });
    }

    return res.json({ updated: count, from, to: to || null });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to update job titles' });
  }
});

/**
 * PUT /org/users/:id/order - 같은 부서(직속, departmentId) 안에서 임직원 순번을 한 칸 올리거나 내린다.
 * body: { direction: 'up' | 'down' }
 * 겸직(UserAffiliation)으로만 걸린 사람은 이 순서에 들어가지 않는다(항상 이름순으로 맨 뒤에 표시).
 */
orgRouter.put('/users/:id/order', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ error: "direction must be 'up' or 'down'" });
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    if (!target.departmentId) return res.status(400).json({ error: 'USER_HAS_NO_DEPARTMENT' });

    const siblings = await prisma.user.findMany({
      where: { departmentId: target.departmentId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const index = siblings.findIndex((u) => u.id === target.id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= siblings.length) {
      return res.json({ moved: false, reason: 'ALREADY_AT_EDGE' });
    }

    const reordered = [...siblings];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    await prisma.$transaction(
      reordered.map((u, i) =>
        prisma.user.update({ where: { id: u.id }, data: { sortOrder: i + 1 } }),
      ),
    );
    return res.json({ moved: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reorder user' });
  }
});

/**
 * PUT /org/departments/:id/order - 같은 상위 부서 안에서 순번을 한 칸 올리거나 내린다.
 * body: { direction: 'up' | 'down' }
 * 기존 행들이 전부 sortOrder=0일 수 있으므로, 이동할 때마다 형제 전체를 1..n으로 다시 매긴다.
 */
orgRouter.put('/departments/:id/order', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const direction = req.body?.direction;
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ error: "direction must be 'up' or 'down'" });
    }

    const target = await prisma.department.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'DEPARTMENT_NOT_FOUND' });

    const siblings = await prisma.department.findMany({
      where: { companyId: target.companyId, parentId: target.parentId ?? null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const index = siblings.findIndex((d) => d.id === target.id);
    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= siblings.length) {
      return res.json({ moved: false, reason: 'ALREADY_AT_EDGE' });
    }

    const reordered = [...siblings];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    await prisma.$transaction(
      reordered.map((d, i) =>
        prisma.department.update({ where: { id: d.id }, data: { sortOrder: i + 1 } }),
      ),
    );
    return res.json({ moved: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reorder department' });
  }
});

/**
 * PUT /org/job-titles/order - 직급 순번을 한 칸 올리거나 내린다.
 * body: { name, direction }  목록에 등록된(마스터) 직급만 순서를 가진다.
 */
orgRouter.put('/job-titles/order', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;

    const name = normalizeName(req.body?.name);
    const direction = req.body?.direction;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (direction !== 'up' && direction !== 'down') {
      return res.status(400).json({ error: "direction must be 'up' or 'down'" });
    }

    const all = await prisma.jobTitle.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    const index = all.findIndex((j) => j.name === name);
    if (index < 0) return res.status(404).json({ error: 'JOB_TITLE_NOT_IN_LIST' });

    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= all.length) {
      return res.json({ moved: false, reason: 'ALREADY_AT_EDGE' });
    }

    const reordered = [...all];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];
    await prisma.$transaction(
      reordered.map((j, i) => prisma.jobTitle.update({ where: { id: j.id }, data: { sortOrder: i + 1 } })),
    );
    return res.json({ moved: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to reorder job title' });
  }
});
