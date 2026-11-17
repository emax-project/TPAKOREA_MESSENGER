const { contextBridge, ipcRenderer } = require('electron');

function readInitialRouteArg() {
  const prefix = 'emax-route=';
  const fromArgv = process.argv.find((a) => typeof a === 'string' && a.startsWith(prefix));
  if (fromArgv) {
    const route = fromArgv.slice(prefix.length);
    return route.startsWith('/') ? route : `/${route}`;
  }
  try {
    const fromMain = ipcRenderer.sendSync('emax-get-initial-route');
    if (typeof fromMain === 'string' && fromMain) {
      return fromMain.startsWith('/') ? fromMain : `/${fromMain}`;
    }
  } catch {
    // ignore
  }
  return null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  initialRoute: readInitialRouteArg(),
  platform: process.platform,
  notifyAppReady: () => ipcRenderer.send('app-ready'),
  sendDebugLog: (payload) => ipcRenderer.send('debug-log', payload),
  openSecondWindow: () => ipcRenderer.invoke('open-second-window'),
  openChatWindow: (roomId) => ipcRenderer.invoke('open-chat-window', roomId),
  openKanbanWindow: (roomId) => ipcRenderer.invoke('open-kanban-window', roomId),
  openGanttWindow: (roomId) => ipcRenderer.invoke('open-gantt-window', roomId),
  showNotification: (title, body, roomId, icon, imagePreview) => ipcRenderer.invoke('show-notification', { title, body, roomId: roomId || null, icon: icon || null, imagePreview: imagePreview || null }),
  setBadgeCount: (count) => ipcRenderer.invoke('set-badge-count', count),
  setOverlayIcon: (dataUrl) => ipcRenderer.invoke('set-overlay-icon', dataUrl),
  setTrayBadge: (dataUrl) => ipcRenderer.invoke('set-tray-badge', dataUrl),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowResize: (width, height) => ipcRenderer.invoke('window-resize', width, height),
  setWindowUiMode: (mode, width, height) => ipcRenderer.invoke('window-set-ui-mode', mode, width, height),
  appQuit: () => ipcRenderer.invoke('app-quit'),
  restartAfterCrash: () => ipcRenderer.invoke('restart-after-crash'),
  clearAppCache: () => ipcRenderer.invoke('clear-app-cache'),
  readTokenSync: () => {
    try {
      return ipcRenderer.sendSync('token-read-sync');
    } catch {
      return null;
    }
  },
  writeToken: (token) => ipcRenderer.invoke('token-write', token),
  clearToken: () => ipcRenderer.invoke('token-clear'),
  setTrustedBaseUrl: (url) => ipcRenderer.invoke('set-trusted-base-url', url),
  onLogout: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('tray-logout', listener);
    return () => ipcRenderer.removeListener('tray-logout', listener);
  },
  // OS 화면 잠금·절전 진입 시 메인 프로세스가 보내는 신호 — 앱도 함께 잠근다
  onSystemLock: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('system-lock', listener);
    return () => ipcRenderer.removeListener('system-lock', listener);
  },
  // 렌더러 → 메인: 잠금 상태(알림 내용 가리기용), 서버 정책의 대화창 수 제한
  setScreenLocked: (locked) => ipcRenderer.send('set-screen-locked', !!locked),
  setMaxChatWindows: (n) => ipcRenderer.send('set-max-chat-windows', n),
  onNavigateToRoom: (handler) => {
    const listener = (_, roomId) => handler(roomId);
    ipcRenderer.on('navigate-to-room', listener);
    return () => ipcRenderer.removeListener('navigate-to-room', listener);
  },
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  printMemo: () => ipcRenderer.send('print-memo'),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  setTitleBarTheme: (isDark) => ipcRenderer.invoke('set-title-bar-theme', { isDark }),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  openUpdateDownload: (version) => ipcRenderer.invoke('open-update-download', version ?? null),
  onUpdateDownloaded: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.removeListener('update-downloaded', listener);
  },
  fetchUserAvatar: (userId) => ipcRenderer.invoke('fetch-user-avatar', { userId }),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window-set-always-on-top', flag),
  getAlwaysOnTop: () => ipcRenderer.invoke('window-get-always-on-top'),
  getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
  pickDownloadPath: () => ipcRenderer.invoke('pick-download-path'),
  clearDownloadPath: () => ipcRenderer.invoke('clear-download-path'),
  setAskSaveAs: (flag) => ipcRenderer.invoke('set-ask-save-as', flag),
  downloadFile: (messageId, filename) => ipcRenderer.invoke('download-file-stream', { messageId, filename }),
  // 팝업 대화창이 메인 창의 서버 연결 하나를 같이 쓰도록 중계한다(socketRelay: 팝업 쪽, socketRelayHost: 메인 창 쪽).
  socketRelay: {
    available: () => ipcRenderer.invoke('socket-relay:available'),
    request: (msg) => ipcRenderer.send('socket-relay:request', msg),
    onResponse: (cb) => {
      const handler = (_e, msg) => cb(msg);
      ipcRenderer.on('socket-relay:response', handler);
      return () => ipcRenderer.removeListener('socket-relay:response', handler);
    },
    onEvent: (cb) => {
      const handler = (_e, msg) => cb(msg);
      ipcRenderer.on('socket-relay:event', handler);
      return () => ipcRenderer.removeListener('socket-relay:event', handler);
    },
  },
  socketRelayHost: {
    register: () => ipcRenderer.send('socket-relay:host-register'),
    unregister: () => ipcRenderer.send('socket-relay:host-unregister'),
    onRequest: (cb) => {
      const handler = (_e, msg) => cb(msg);
      ipcRenderer.on('socket-relay:request', handler);
      return () => ipcRenderer.removeListener('socket-relay:request', handler);
    },
    respond: (msg) => ipcRenderer.send('socket-relay:response', msg),
    sendEvent: (msg) => ipcRenderer.send('socket-relay:event', msg),
  },
});
