/** 거래처마다 그룹웨어 주소가 다르므로 서버 설정값(관리자가 지정)을 우선 쓰고,
 *  배포 시 고정 주소로 쓰고 싶은 경우에만 빌드 시 VITE_GROUPWARE_URL로 대체한다.
 *  코드에 특정 서버 주소를 기본값으로 박아두지 않는다. */

function openUrl(url: string) {
  const openExternal = window.electronAPI?.openExternal;
  if (openExternal) {
    void openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function openGroupware(groupwareUrl: string, path?: string) {
  const base = groupwareUrl.trim().replace(/\/$/, '');
  if (!base) return;
  openUrl(path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base);
}

export type GroupwareSso = { enabled: boolean; path: string };

/**
 * SSO 진입 주소: `그룹웨어주소 + SSO경로 ?token=...[&next=이동할주소]`.
 * next는 로그인 후 보낼 목적지(예: 메일 화면)이며, 그룹웨어가 같은 사이트 주소인지 검증해야 한다(docs/groupware-sso.md).
 */
export function buildSsoUrl(groupwareUrl: string, ssoPath: string, token: string, next?: string): string {
  const base = groupwareUrl.trim().replace(/\/$/, '');
  const path = ssoPath.startsWith('/') ? ssoPath : `/${ssoPath}`;
  const params = new URLSearchParams({ token });
  if (next) params.set('next', next);
  return `${base}${path}?${params.toString()}`;
}

/**
 * 그룹웨어(또는 메일) 열기. SSO가 켜져 있으면 1회용 토큰을 받아 SSO 주소로 열고,
 * 꺼져 있거나 토큰을 못 받으면(서버 오류·네트워크) 기존처럼 주소만 연다 — 로그인은 사용자가 직접 한다.
 * @param target 최종 목적지(그룹웨어 주소 또는 메일 주소)
 * @returns 'sso' | 'plain' — 어떤 방식으로 열었는지
 */
export async function openGroupwareWithSso(
  groupwareUrl: string,
  target: string,
  sso: GroupwareSso | undefined,
  fetchToken: () => Promise<{ token: string }>,
): Promise<'sso' | 'plain'> {
  const base = groupwareUrl.trim();
  if (sso?.enabled && base) {
    try {
      const { token } = await fetchToken();
      if (token) {
        const next = target.trim() && target.trim() !== base ? target.trim() : undefined;
        openUrl(buildSsoUrl(base, sso.path, token, next));
        return 'sso';
      }
    } catch {
      // 토큰 발급 실패 → 아래에서 주소만 연다
    }
  }
  openGroupware(target);
  return 'plain';
}
