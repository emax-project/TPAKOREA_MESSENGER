const STORAGE_KEY = 'notificationPopupEnabled';

/** 우측 하단(데스크톱) 알림 팝업 표시 여부. 끄면 소리/인앱 배지는 그대로 두고 팝업만 숨긴다. */
export function isNotificationPopupEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}
