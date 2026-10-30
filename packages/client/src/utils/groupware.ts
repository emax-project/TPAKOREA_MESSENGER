/** 거래처마다 그룹웨어 주소가 다르므로 서버 설정값(관리자가 지정)을 우선 쓰고,
 *  배포 시 고정 주소로 쓰고 싶은 경우에만 빌드 시 VITE_GROUPWARE_URL로 대체한다.
 *  코드에 특정 서버 주소를 기본값으로 박아두지 않는다. */
export function openGroupware(groupwareUrl: string, path?: string) {
  const base = groupwareUrl.trim().replace(/\/$/, '');
  if (!base) return;
  const url = path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
  // PC 메신저: 앱 안의 그룹웨어 창으로 열어 메신저 계정으로 자동 로그인한다.
  const openInApp = window.electronAPI?.openGroupwareWindow;
  if (openInApp) {
    void openInApp(url).then((ok) => {
      if (!ok) void window.electronAPI?.openExternal(url);
    });
    return;
  }
  const openExternal = window.electronAPI?.openExternal;
  if (openExternal) {
    void openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** 그룹웨어는 메신저와 같은 계정(LDAP uid)을 쓴다 — 이메일로 로그인했다면 @ 앞부분이 그룹웨어 아이디.
 *  (서버 lib/ldap.js의 loginIdentifierToUid와 같은 규칙) */
export function toGroupwareLoginId(identifier: string): string {
  const raw = identifier.trim();
  const at = raw.indexOf('@');
  return at === -1 ? raw : raw.slice(0, at);
}

/** 메신저 로그인·비밀번호 변경 시 그룹웨어 자동 로그인용 계정을 OS 암호화 저장소에 보관 (PC 앱 전용) */
export function rememberGroupwareCredentials(identifier: string, password: string) {
  const loginId = toGroupwareLoginId(identifier);
  if (!loginId || !password) return;
  void window.electronAPI?.setGroupwareCredentials?.(loginId, password).catch(() => {});
}
