import { useEffect } from 'react';
import { useMainSocketStore } from '../../../store';
import { attachSocketRelayHost } from './socketRelayHost';

/** 메인 창의 서버 연결을 팝업 대화창과 같이 쓰게 한다(자세한 동작은 socketRelayHost.ts). */
export function useSocketRelayHost() {
  const socket = useMainSocketStore((s) => s.socket);

  useEffect(() => {
    const relay = window.electronAPI?.socketRelayHost;
    if (!relay || !socket) return;
    return attachSocketRelayHost(socket, relay);
  }, [socket]);
}
