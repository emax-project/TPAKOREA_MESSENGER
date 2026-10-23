/** 거래처마다 그룹웨어 주소가 다르므로 서버 설정값(관리자가 지정)을 우선 쓰고,
 *  배포 시 고정 주소로 쓰고 싶은 경우에만 빌드 시 VITE_GROUPWARE_URL로 대체한다.
 *  코드에 특정 서버 주소를 기본값으로 박아두지 않는다. */
export function openGroupware(groupwareUrl: string, path?: string) {
  const base = groupwareUrl.trim().replace(/\/$/, '');
  if (!base) return;
  const url = path ? `${base}${path.startsWith('/') ? path : `/${path}`}` : base;
  const openExternal = window.electronAPI?.openExternal;
  if (openExternal) {
    void openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
