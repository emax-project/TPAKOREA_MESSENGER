/** 메인 프로세스가 쓰는 작은 정책 헬퍼들 — Electron 없이 테스트할 수 있게 순수 함수로 둔다. */

const LOCKED_NOTIFICATION = Object.freeze({ title: 'CSIN-Tech', body: '새 알림이 도착했습니다.' });

/**
 * 화면이 잠겨 있으면 알림에서 보낸 사람·대화 내용·프로필 이미지·미리보기를 모두 지운다.
 * (roomId는 클릭 시 이동용이라 남기되 화면에는 보이지 않는다)
 */
function maskNotificationIfLocked(payload, locked) {
  if (!locked) return payload;
  return { ...LOCKED_NOTIFICATION, roomId: payload.roomId || null, icon: null, imagePreview: null };
}

/** 새 대화창을 열 수 있는지. max가 0·미설정이면 제한 없음. */
function canOpenChatWindow(openCount, max) {
  const limit = Number(max);
  if (!Number.isInteger(limit) || limit <= 0) return true;
  return openCount < limit;
}

/** 렌더러가 보낸 값을 0~20 정수로 정리(잘못된 값은 0 = 제한 없음). */
function sanitizeMaxChatWindows(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 20 ? n : 0;
}

/**
 * 업데이트 폴더(pending)에서 설치 파일을 최신 1개만 남기고 정리할 대상을 고른다.
 * 가장 최근 설치 파일은 차등(blockmap) 업데이트의 기준 파일이라 유지하고,
 * 나머지 설치 파일(.exe)과 미완성 다운로드(.tmp, .part)를 지운다.
 * files: [{ name, mtimeMs }]
 */
function pickStaleUpdaterFiles(files) {
  const installers = files.filter((f) => /\.exe$/i.test(f.name)).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const staleInstallers = installers.slice(1).map((f) => f.name);
  const partial = files.filter((f) => /\.(tmp|part)$/i.test(f.name)).map((f) => f.name);
  return [...staleInstallers, ...partial];
}

module.exports = { maskNotificationIfLocked, canOpenChatWindow, sanitizeMaxChatWindows, pickStaleUpdaterFiles, LOCKED_NOTIFICATION };
