/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_GROUPWARE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI?: {
    initialRoute: string | null;
    platform: string;
    notifyAppReady: () => void;
    sendDebugLog: (payload: unknown) => void;
    openSecondWindow: () => Promise<void>;
    openChatWindow: (roomId: string) => Promise<void>;
    openKanbanWindow: (roomId: string) => Promise<void>;
    openGanttWindow: (roomId: string) => Promise<void>;
    showNotification: (title: string, body: string, roomId?: string, icon?: string | null, imagePreview?: string | null) => Promise<void>;
    setBadgeCount: (count: number) => Promise<void>;
    setOverlayIcon: (dataUrl: string | null) => Promise<void>;
    setTrayBadge?: (dataUrl: string | null) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    windowClose: () => Promise<void>;
    windowMinimize: () => Promise<void>;
    windowMaximize: () => Promise<void>;
    windowResize: (width: number, height: number) => Promise<void>;
    setWindowUiMode?: (mode: 'login' | 'main', width?: number, height?: number) => Promise<{ ok?: boolean }>;
    appQuit?: () => Promise<void>;
    clearAppCache?: () => Promise<void>;
    readTokenSync?: () => string | null;
    writeToken?: (token: string) => Promise<boolean>;
    clearToken?: () => Promise<boolean>;
    setTrustedBaseUrl?: (url: string) => Promise<boolean>;
    onLogout: (handler: () => void) => () => void;
    onNavigateToRoom: (handler: (roomId: string) => void) => () => void;
    getAppVersion: () => Promise<string>;
    getAppInfo: () => Promise<{ version: string; isPackaged: boolean; platform: string }>;
    setTitleBarTheme?: (isDark: boolean) => Promise<void>;
    checkForUpdates: () => Promise<{
      success: boolean;
      hasUpdate?: boolean;
      version?: string | null;
      currentVersion?: string;
      downloaded?: boolean;
      requiresManualInstall?: boolean;
      error?: string;
    }>;
    quitAndInstall: () => Promise<{ success?: boolean; requiresManualInstall?: boolean; error?: string }>;
    openUpdateDownload: (version?: string | null) => Promise<void>;
    onUpdateDownloaded: (handler: () => void) => () => void;
    fetchUserAvatar: (userId: string) => Promise<string | null>;
    fetchRoomAvatar?: (roomId: string, baseUrl: string, token: string) => Promise<string | null>;
    setAlwaysOnTop?: (flag: boolean) => Promise<{ ok?: boolean; alwaysOnTop?: boolean }>;
    getAlwaysOnTop?: () => Promise<{ alwaysOnTop?: boolean }>;
    getDownloadPath?: () => Promise<{ path: string | null; askSaveAs?: boolean }>;
    pickDownloadPath?: () => Promise<{ path: string | null; askSaveAs?: boolean; canceled?: boolean }>;
    clearDownloadPath?: () => Promise<{ path: string | null; askSaveAs?: boolean }>;
    setAskSaveAs?: (flag: boolean) => Promise<{ path: string | null; askSaveAs?: boolean }>;
    saveFileToDownloadPath?: (buffer: ArrayBuffer | Uint8Array, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  };
}
