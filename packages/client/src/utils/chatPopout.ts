/**
 * 대화방은 기본으로 메인 창 안(오른쪽 영역)에서 연다.
 * 독립 창(팝업)은 대화창 상단의 "새 창으로 열기" 버튼이나 대화방 우클릭 메뉴로 연다.
 * localStorage의 emax_chat_popout 값이 '1'이면 예전처럼 항상 독립 창으로 연다.
 */
export function shouldOpenChatInNewWindow(): boolean {
  if (typeof window === 'undefined' || !window.electronAPI?.openChatWindow) return false;
  try {
    return localStorage.getItem('emax_chat_popout') === '1';
  } catch {
    return false;
  }
}

export function openChatRoomWindow(roomId: string): boolean {
  if (!shouldOpenChatInNewWindow()) return false;
  void window.electronAPI!.openChatWindow!(roomId);
  return true;
}
