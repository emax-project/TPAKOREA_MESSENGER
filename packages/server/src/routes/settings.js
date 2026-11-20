import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { assertAdmin } from '../lib/admin.js';
import { isBlockedHostname } from '../lib/ssrfGuard.js';
import { SSO_DEFAULT_PATH, normalizeSsoPath } from '../lib/ssoToken.js';
import { ALWAYS_BLOCKED_EXTENSIONS, getSecurityPolicy, saveSecurityPolicy } from '../lib/securityPolicy.js';

export const settingsRouter = Router();
settingsRouter.use(authMiddleware);

const EXTERNAL_SITE_KEY = 'external_site_url';
const MAIL_SITE_KEY = 'mail_site_url';
const GROUPWARE_URL_KEY = 'groupware_url';
const SSO_ENABLED_KEY = 'groupware_sso_enabled';
const SSO_PATH_KEY = 'groupware_sso_path';

// 이 값은 클라이언트가 window.open/openExternal로 "열기"만 하는 용도입니다.
// 서버가 이 URL을 직접 fetch/요청하는 기능을 추가할 경우 SSRF가 될 수 있으므로,
// 절대 그대로 서버측 요청에 사용하지 말고 lib/ssrfGuard.js의 safeFetch를 통해서만
// 요청하세요. 아래 사설/루프백/링크로컬 대역 차단은 그 상황을 대비한 방어적 조치이며,
// 현재는 실제로 서버가 이 URL을 요청하지는 않습니다.
function normalizeExternalSiteUrl(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return { url: '' };
  let candidate = trimmed;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) {
    candidate = `https://${candidate}`;
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { error: '올바른 주소를 입력해 주세요' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { error: 'http:// 또는 https:// 주소만 사용할 수 있습니다' };
  }
  if (isBlockedHostname(parsed.hostname)) {
    return { error: '사용할 수 없는 주소입니다' };
  }
  return { url: parsed.toString() };
}

async function readSetting(key) {
  const row = await prisma.appSetting.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value || '';
}

/**
 * 관리자가 지정하는 사이드바 링크 주소 하나에 대한 조회(전체 사용자)/저장(관리자) 라우트를 만든다.
 * @param {string} path  라우트 경로 (예: /external-site)
 * @param {string} key   AppSetting 키
 * @param {string} label 오류 메시지에 쓸 이름
 */
function registerLinkSetting(path, key, label) {
  settingsRouter.get(path, async (_req, res) => {
    try {
      const url = await readSetting(key);
      return res.json({ url });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: `${label} 설정을 불러오지 못했습니다` });
    }
  });

  settingsRouter.put(path, async (req, res) => {
    try {
      if (!(await assertAdmin(req, res))) return;
      const parsed = normalizeExternalSiteUrl(req.body?.url);
      if (parsed.error) {
        return res.status(400).json({ error: parsed.error });
      }
      await prisma.appSetting.upsert({
        where: { key },
        create: { key, value: parsed.url },
        update: { value: parsed.url },
      });
      return res.json({ url: parsed.url });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: `${label} 설정을 저장하지 못했습니다` });
    }
  });
}

/** 사이드바 "링크 접속" 버튼 주소 */
registerLinkSetting('/external-site', EXTERNAL_SITE_KEY, '링크');
/** 사이드바 "메일" 버튼 주소 (비어 있으면 클라이언트가 그룹웨어로 연다) */
registerLinkSetting('/mail-site', MAIL_SITE_KEY, '메일 링크');
/** 사이드바 "그룹웨어" 버튼 주소 (비어 있으면 버튼이 동작하지 않는다) */
registerLinkSetting('/groupware-url', GROUPWARE_URL_KEY, '그룹웨어');

/** 그룹웨어 SSO 설정 조회 (로그인한 모든 사용자) — 켜져 있으면 클라이언트가 1회용 토큰을 받아 그룹웨어를 연다 */
settingsRouter.get('/groupware-sso', async (_req, res) => {
  try {
    const [enabled, path] = await Promise.all([readSetting(SSO_ENABLED_KEY), readSetting(SSO_PATH_KEY)]);
    return res.json({ enabled: enabled === '1', path: path || SSO_DEFAULT_PATH });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SSO 설정을 불러오지 못했습니다' });
  }
});

/** 그룹웨어 SSO 설정 저장 (관리자만). body: { enabled: boolean, path?: string } */
settingsRouter.put('/groupware-sso', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;
    const parsed = normalizeSsoPath(req.body?.path);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const enabled = req.body?.enabled === true;
    for (const [key, value] of [[SSO_ENABLED_KEY, enabled ? '1' : '0'], [SSO_PATH_KEY, parsed.path]]) {
      await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    return res.json({ enabled, path: parsed.path });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'SSO 설정을 저장하지 못했습니다' });
  }
});


/**
 * 보안 정책 조회 (로그인한 모든 사용자) — 자동 화면 잠금 시간, 2차 인증 정책, 파일 전송 통제.
 * 클라이언트는 이 값으로 잠금 타이머를 돌리고 업로드 전에 파일을 미리 검사한다
 * (최종 강제는 항상 서버가 한다).
 */
settingsRouter.get('/security', async (_req, res) => {
  try {
    const policy = await getSecurityPolicy();
    return res.json({ ...policy, alwaysBlockedExtensions: ALWAYS_BLOCKED_EXTENSIONS });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '보안 설정을 불러오지 못했습니다' });
  }
});

/** 보안 정책 저장 (관리자만). 일부 항목만 보내도 된다. */
settingsRouter.put('/security', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;
    const saved = await saveSecurityPolicy(req.body);
    if (saved.error) return res.status(400).json({ error: saved.error });
    console.log(`[admin] 보안 정책 변경: lock=${saved.screenLockMinutes}분, 2FA=${saved.twoFactor}, 파일전송=${saved.fileTransfer.enabled ? `허용(${saved.fileTransfer.maxSizeMB}MB)` : '차단'}`);
    return res.json({ ...saved, alwaysBlockedExtensions: ALWAYS_BLOCKED_EXTENSIONS });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '보안 설정을 저장하지 못했습니다' });
  }
});

/** 파일 전송 감사 로그 (관리자만) — 최근순. ?blockedOnly=1 이면 차단 이력만. ?limit= (최대 200) */
settingsRouter.get('/file-audit', async (req, res) => {
  try {
    if (!(await assertAdmin(req, res))) return;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const where = req.query.blockedOnly === '1' ? { allowed: false } : {};
    const rows = await prisma.fileTransferAudit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return res.json(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: byId.get(r.userId)?.name ?? '(삭제된 사용자)',
        userEmail: byId.get(r.userId)?.email ?? '',
        roomId: r.roomId,
        fileName: r.fileName,
        fileSize: Number(r.fileSize),
        allowed: r.allowed,
        reason: r.reason,
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: '감사 로그를 불러오지 못했습니다' });
  }
});
