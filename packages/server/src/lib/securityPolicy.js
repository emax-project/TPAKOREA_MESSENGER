/**
 * 관리자가 설정하는 보안 정책(자동 화면 잠금, 2차 인증, 파일 전송 통제).
 * AppSetting 테이블에 JSON 한 건으로 저장하고, 자주 읽히므로 짧게 캐시한다.
 */
import path from 'node:path';
import { prisma } from '../db.js';

const SETTING_KEY = 'security_policy';
const CACHE_TTL_MS = 10_000;

/** 어떤 설정에서도 풀 수 없는 최소 차단 목록 — 실행 파일 + 브라우저에서 스크립트가 되는 웹 콘텐츠(저장형 XSS 방지) */
export const ALWAYS_BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif', '.vbs', '.wsf',
  '.html', '.htm', '.xhtml', '.shtml', '.mhtml', '.svg',
];

export const DEFAULT_POLICY = Object.freeze({
  // 일정 시간 입력이 없으면 화면을 잠근다(분). 0이면 사용 안 함.
  screenLockMinutes: 10,
  // optional: 사용자가 원하면 등록 / required: 모든 사용자가 등록해야 로그인 가능
  twoFactor: 'optional',
  // 동시에 열 수 있는 대화창(별도 창) 수. 0이면 제한 없음. 창이 많을수록 메모리·CPU를 더 쓴다.
  maxChatWindows: 0,
  fileTransfer: {
    enabled: true,
    // 파일 내려받기 허용 여부(업로드와 별개)
    downloadEnabled: true,
    maxSizeMB: 2048,
    // 추가 차단 확장자(위 필수 차단 목록에 더해짐)
    blockedExtensions: ['.jse', '.ps1', '.psm1', '.dll', '.sys', '.reg', '.lnk', '.hta'],
    // 비어 있지 않으면 여기 있는 확장자만 허용(화이트리스트 모드)
    allowedExtensions: [],
  },
});

export const LIMITS = Object.freeze({
  screenLockMaxMinutes: 24 * 60,
  fileMaxSizeMB: 2048,
  maxExtensions: 200,
  maxChatWindowsMax: 20,
});

export function normalizeExtension(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  const withDot = s.startsWith('.') ? s : `.${s}`;
  return /^\.[a-z0-9][a-z0-9_-]{0,15}$/.test(withDot) ? withDot : '';
}

function normalizeExtensionList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const item of list) {
    const ext = normalizeExtension(item);
    if (!ext) return null;
    if (!out.includes(ext)) out.push(ext);
  }
  return out.length > LIMITS.maxExtensions ? null : out;
}

/**
 * 저장된 값/입력값을 정책 객체로 정리한다. 일부만 와도 나머지는 base에서 채운다.
 * 잘못된 값이 있으면 { error } 를 돌려준다(저장 전 검증용).
 */
export function mergePolicy(base, patch) {
  const next = {
    screenLockMinutes: base.screenLockMinutes,
    twoFactor: base.twoFactor,
    maxChatWindows: base.maxChatWindows,
    fileTransfer: { ...base.fileTransfer },
  };
  if (!patch || typeof patch !== 'object') return next;

  if (patch.screenLockMinutes !== undefined) {
    const n = Number(patch.screenLockMinutes);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.screenLockMaxMinutes) {
      return { error: `자동 잠금 시간은 0~${LIMITS.screenLockMaxMinutes}분 사이여야 합니다 (0 = 사용 안 함)` };
    }
    next.screenLockMinutes = n;
  }
  if (patch.twoFactor !== undefined) {
    if (patch.twoFactor !== 'optional' && patch.twoFactor !== 'required') {
      return { error: '2차 인증 정책 값이 올바르지 않습니다' };
    }
    next.twoFactor = patch.twoFactor;
  }
  if (patch.maxChatWindows !== undefined) {
    const n = Number(patch.maxChatWindows);
    if (!Number.isInteger(n) || n < 0 || n > LIMITS.maxChatWindowsMax) {
      return { error: `동시에 열 수 있는 대화창 수는 0~${LIMITS.maxChatWindowsMax}개 사이여야 합니다 (0 = 제한 없음)` };
    }
    next.maxChatWindows = n;
  }
  const ft = patch.fileTransfer;
  if (ft !== undefined) {
    if (!ft || typeof ft !== 'object') return { error: '파일 전송 정책 값이 올바르지 않습니다' };
    if (ft.enabled !== undefined) next.fileTransfer.enabled = !!ft.enabled;
    if (ft.downloadEnabled !== undefined) next.fileTransfer.downloadEnabled = !!ft.downloadEnabled;
    if (ft.maxSizeMB !== undefined) {
      const n = Number(ft.maxSizeMB);
      if (!Number.isInteger(n) || n < 1 || n > LIMITS.fileMaxSizeMB) {
        return { error: `파일 최대 크기는 1~${LIMITS.fileMaxSizeMB}MB 사이여야 합니다` };
      }
      next.fileTransfer.maxSizeMB = n;
    }
    if (ft.blockedExtensions !== undefined) {
      const list = normalizeExtensionList(ft.blockedExtensions);
      if (!list) return { error: '차단 확장자 형식이 올바르지 않습니다 (예: .zip, .iso)' };
      next.fileTransfer.blockedExtensions = list;
    }
    if (ft.allowedExtensions !== undefined) {
      const list = normalizeExtensionList(ft.allowedExtensions);
      if (!list) return { error: '허용 확장자 형식이 올바르지 않습니다 (예: .pdf, .xlsx)' };
      next.fileTransfer.allowedExtensions = list;
    }
  }
  return next;
}

/**
 * 파일 하나가 정책을 통과하는지 검사한다. 통과하면 null, 아니면 { code, message }.
 * (필수 차단 목록은 허용 목록에 있어도 항상 막는다)
 */
export function evaluateFile({ name, size }, policy) {
  const ft = policy.fileTransfer;
  if (!ft.enabled) {
    return { code: 'FILE_TRANSFER_DISABLED', message: '파일 전송이 관리자에 의해 제한되어 있습니다' };
  }
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ALWAYS_BLOCKED_EXTENSIONS.includes(ext)) {
    return { code: 'FILE_TYPE_BLOCKED', message: '실행 파일은 업로드할 수 없습니다' };
  }
  if (ft.blockedExtensions.includes(ext)) {
    return { code: 'FILE_TYPE_BLOCKED', message: `${ext} 형식의 파일은 전송할 수 없습니다` };
  }
  if (ft.allowedExtensions.length > 0 && !ft.allowedExtensions.includes(ext)) {
    return { code: 'FILE_TYPE_NOT_ALLOWED', message: `허용되지 않은 파일 형식입니다 (허용: ${ft.allowedExtensions.join(', ')})` };
  }
  if (typeof size === 'number' && size > ft.maxSizeMB * 1024 * 1024) {
    return { code: 'FILE_TOO_LARGE', message: `파일 크기는 ${ft.maxSizeMB}MB 이하여야 합니다` };
  }
  return null;
}

let cache = { at: 0, policy: null };

export function invalidatePolicyCache() {
  cache = { at: 0, policy: null };
}

export async function getSecurityPolicy() {
  if (cache.policy && Date.now() - cache.at < CACHE_TTL_MS) return cache.policy;
  let stored = null;
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY }, select: { value: true } });
    stored = row?.value ? JSON.parse(row.value) : null;
  } catch (err) {
    // 저장값이 깨졌거나 DB 조회에 실패해도 기본 정책으로 계속 동작한다
    console.error('[securityPolicy] load failed, using defaults:', err?.message || err);
  }
  const merged = mergePolicy(DEFAULT_POLICY, stored);
  const policy = merged.error ? mergePolicy(DEFAULT_POLICY, null) : merged;
  cache = { at: Date.now(), policy };
  return policy;
}

export async function saveSecurityPolicy(patch) {
  const current = await getSecurityPolicy();
  const merged = mergePolicy(current, patch);
  if (merged.error) return merged;
  await prisma.appSetting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });
  invalidatePolicyCache();
  return merged;
}
