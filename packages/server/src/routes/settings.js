import { Router } from 'express';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { assertAdmin } from '../lib/admin.js';
import { isBlockedHostname } from '../lib/ssrfGuard.js';

export const settingsRouter = Router();
settingsRouter.use(authMiddleware);

const EXTERNAL_SITE_KEY = 'external_site_url';
const MAIL_SITE_KEY = 'mail_site_url';

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
