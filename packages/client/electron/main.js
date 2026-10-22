const { app, BrowserWindow, Menu, ipcMain, Tray, screen, shell, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// package.json의 "name"은 모든 브랜드 빌드(EMAX-Hub/CSIN-Tech/TPA-Korea 등)에서
// "client"로 동일해서, setName()을 안 하면 app.getPath('userData')가 전부 같은
// 폴더를 가리킨다 — 결과적으로 같은 PC에 여러 브랜드를 설치하면 로그인 시 저장한
// 서버 주소 등 localStorage가 브랜드 간에 섞인다. build.productName으로 분리한다.
try {
  const pkg = require('../package.json');
  const productName = pkg.build && pkg.build.productName;
  if (productName) app.setName(productName);
} catch { /* ignore */ }

// Windows: GPU 렌더링 문제로 검은 화면 발생 시 소프트웨어 렌더링 강제
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

// 단일 인스턴스 잠금: 두 번 실행하면 기존 창을 포커스하고 종료
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

const NOTIF_WIDTH = 360;
const NOTIF_HEIGHT = 100;
const NOTIF_HEIGHT_PROGRESS = 128;
const NOTIF_DURATION_MS = 4500;

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function getNotificationHTML(title, body, progressPercent, hasRoomId, iconDataUrl, imagePreviewDataUrl) {
  const t = escapeHtml(title);
  const b = escapeHtml(body);
  const showProgress = typeof progressPercent === 'number';
  const pct = showProgress ? Math.min(100, Math.max(0, progressPercent)) : 0;
  const progressBlock = showProgress
    ? `
    <div class="progress-wrap">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <div class="progress-text">${Math.round(pct)}%</div>`
    : '';
  const clickHint = hasRoomId && !showProgress
    ? `<div class="toast-hint">클릭하여 채팅방으로 이동</div>`
    : '';
  const iconHtml = iconDataUrl && typeof iconDataUrl === 'string' && iconDataUrl.startsWith('data:')
    ? `<img src="${iconDataUrl.replace(/"/g, '&quot;')}" alt="" class="toast-avatar" />`
    : '';
  const imagePreviewHtml = imagePreviewDataUrl && typeof imagePreviewDataUrl === 'string' && imagePreviewDataUrl.startsWith('data:')
    ? `<img src="${imagePreviewDataUrl.replace(/"/g, '&quot;')}" alt="" class="toast-preview" />`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Apple SD Gothic Neo', sans-serif;
      background: transparent;
      overflow: hidden;
      width: ${NOTIF_WIDTH}px;
      height: ${showProgress ? NOTIF_HEIGHT_PROGRESS : NOTIF_HEIGHT}px;
      cursor: ${hasRoomId && !showProgress ? 'pointer' : 'default'};
    }
    .toast {
      width: 100%;
      height: 100%;
      background: linear-gradient(145deg, #ffffff 0%, #f5f5f5 100%);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
      border: 1px solid rgba(0,0,0,0.06);
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      transition: background 0.15s;
    }
    .toast:hover {
      background: linear-gradient(145deg, #f8f8f8 0%, #f0f0f0 100%);
      border-color: rgba(23,23,23,0.15);
    }
    .toast-brand {
      font-size: 11px;
      font-weight: 700;
      color: #000F9F;
      letter-spacing: 0.02em;
    }
    .toast-row {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .toast-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 0 1 auto;
    }
    .toast-right {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 180px;
      margin-left: auto;
      text-align: right;
    }
    .toast-avatar {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
    }
    .toast-preview {
      width: 48px;
      height: 48px;
      border-radius: 8px;
      object-fit: cover;
      flex-shrink: 0;
      margin-left: auto;
    }
    .toast-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
    }
    .toast-body {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .toast-hint {
      font-size: 11px;
      color: #171717;
      margin-top: 2px;
      opacity: 0.8;
    }
    .progress-wrap {
      height: 6px;
      background: rgba(0,0,0,0.08);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #171717, #262626);
      border-radius: 3px;
      transition: width 0.2s ease;
    }
    .progress-text {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <div class="toast">
    <span class="toast-brand">TPA Korea</span>
    <div class="toast-row">
      <div class="toast-left">
        ${iconHtml}
        <div class="toast-title">${t}</div>
      </div>
      ${imagePreviewHtml || (b ? `<div class="toast-right" title="${b.replace(/"/g, '&quot;')}">${b}</div>` : '')}
    </div>
    ${clickHint}
    ${progressBlock}
  </div>
</body>
</html>`;
}

let customNotifWin = null;
let isUpdateProgressWindow = false;
let pendingNotifRoomId = null;

const notifPreloadPath = path.join(__dirname, 'notif-preload.js');

function getNotificationBounds(width, height) {
  const pad = 24;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor)
    || (mainWindow && !mainWindow.isDestroyed() ? screen.getDisplayMatching(mainWindow.getBounds()) : null)
    || screen.getPrimaryDisplay();
  const { x, y, width: sw, height: sh } = display.workArea;
  return {
    x: Math.round(x + sw - width - pad),
    y: Math.round(y + sh - height - pad),
    width,
    height,
  };
}

function placeNotificationWindow(win, width, height) {
  if (!win || win.isDestroyed()) return;
  win.setBounds(getNotificationBounds(width, height));
}

function showCustomNotification(title, body, options) {
  const opts = options || {};
  const persistent = opts.persistent === true;
  const progress = opts.progress;
  const showProgressBar = typeof progress === 'number';
  const roomId = opts.roomId || null;
  const icon = opts.icon || null;
  const imagePreview = opts.imagePreview || null;

  if (customNotifWin && !customNotifWin.isDestroyed()) {
    customNotifWin.close();
    customNotifWin = null;
  }
  isUpdateProgressWindow = false;
  pendingNotifRoomId = roomId;

  const notifHeight = showProgressBar ? NOTIF_HEIGHT_PROGRESS : NOTIF_HEIGHT;
  const bounds = getNotificationBounds(NOTIF_WIDTH, notifHeight);

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: notifPreloadPath,
    },
  });

  win.setMenu(null);
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // platform may not support these
  }
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(getNotificationHTML(title, body, progress, !!roomId, icon, imagePreview)));
  win.once('ready-to-show', () => {
    placeNotificationWindow(win, NOTIF_WIDTH, notifHeight);
    win.showInactive();
    placeNotificationWindow(win, NOTIF_WIDTH, notifHeight);
  });
  win.on('closed', () => {
    if (customNotifWin === win) {
      customNotifWin = null;
      isUpdateProgressWindow = false;
    }
  });

  customNotifWin = win;
  if (persistent && showProgressBar) isUpdateProgressWindow = true;

  if (!persistent) {
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.close();
    }, NOTIF_DURATION_MS);
  }
}

function updateNotificationProgress(percent) {
  if (!customNotifWin || customNotifWin.isDestroyed() || !isUpdateProgressWindow) return;
  const pct = Math.min(100, Math.max(0, percent));
  const round = Math.round(pct);
  customNotifWin.webContents.executeJavaScript(
    '(function(){ var b=document.querySelector(".progress-bar"); var t=document.querySelector(".progress-text"); if(b)b.style.width="' + pct + '%"; if(t)t.textContent="' + round + '%"; })();'
  ).catch(() => {});
}
const { autoUpdater } = require('electron-updater');

let updaterBaseUrl = '';
try {
  const updaterConfig = require('./updater-config.generated.js');
  updaterBaseUrl = (updaterConfig && updaterConfig.baseUrl) || '';
} catch {
  // generated file may not exist before first build
}

// 패키징된 앱은 항상 빌드된 파일 로드. NODE_ENV 미설정 시에도 5173 로드되는 것 방지
const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const preloadPath = path.join(__dirname, 'preload.js');
const iconPath = path.join(__dirname, '../build/icons/icon.png');
let tray = null;
let mainWindow = null;
let isQuitting = false;
let updateDownloadedPending = false;
let pendingUpdateVersion = null;
// TPA-Korea 빌드는 TPAKOREA_MESSENGER 저장소에 릴리즈된다 (build.publish와 동일한 저장소 —
// 공개 MESSAGE 저장소를 가리키면 설치파일이 없어 404가 난다. 과거 자동 업데이트 피드 자체는
// 고쳤지만, 이 수동 다운로드 링크는 그때 같이 안 고쳐져 있었음).
const RELEASE_DOWNLOAD_BASE = 'https://github.com/emax-project/TPAKOREA_MESSENGER/releases/download';

function getReleaseDownloadUrl(version) {
  const v = String(version || '').replace(/^v/, '');
  if (!v) return 'https://github.com/emax-project/TPAKOREA_MESSENGER/releases/latest';
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return `${RELEASE_DOWNLOAD_BASE}/v${v}/TPA-Korea-${v}-${arch}.dmg`;
  }
  if (process.platform === 'win32') {
    return `${RELEASE_DOWNLOAD_BASE}/v${v}/TPA-Korea-Setup-${v}.exe`;
  }
  return `https://github.com/emax-project/TPAKOREA_MESSENGER/releases/tag/v${v}`;
}

// 창별 show 핸들러 (Map으로 관리, win 객체에 프로퍼티 직접 부착보다 안전)
const windowReadyHandlers = new Map();

function getLoadURL() {
  if (isDev) return 'http://localhost:5173';
  return null;
}

function getLoadFile() {
  if (!isDev) return path.join(__dirname, '../dist/index.html');
  return null;
}

function loadRoute(win, routePath) {
  const normalized = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const url = getLoadURL();
  const file = getLoadFile();
  if (url) {
    const base = url.replace(/\/$/, '');
    win.loadURL(`${base}/#${normalized}`);
  } else if (file) {
    // loadFile({ hash })보다 file:// URL + hash가 Electron·HashRouter와 더 안정적
    win.loadURL(`${pathToFileURL(file).href}#${normalized}`);
  }
}

function createWindow(options = {}) {
  const { secondWindow, initialRoute, ...browserWindowOptions } = options;
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  const titleBarHeight = 38;

  const win = new BrowserWindow({
    width: 430,
    height: 900,
    minWidth: 360,
    minHeight: 560,
    frame: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 14 } } : {}),
    ...(isWin ? {
      titleBarOverlay: {
        color: '#1e293b',
        symbolColor: '#e2e8f0',
        height: titleBarHeight,
      },
    } : {}),
    show: false,
    // 흰 화면 플래시 방지 (특히 Windows 첫 실행)
    backgroundColor: '#0f172a',
    // macOS: 창에 icon 지정 시 타이틀 바에 거대하게 표시되므로 제외. 도크 아이콘은 app.dock.setIcon으로만 설정.
    ...(process.platform !== 'darwin' ? { icon: iconPath } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
      ...(initialRoute ? { additionalArguments: [`emax-route=${initialRoute}`] } : {}),
    },
    ...browserWindowOptions,
  });

  const url = getLoadURL();
  const file = getLoadFile();
  if (initialRoute) {
    loadRoute(win, initialRoute);
    win.__emaxInitialRoute = initialRoute;
  } else if (url) {
    win.loadURL(url);
  } else if (file) {
    win.loadFile(file);
  }

  // 창 표시 로직:
  // 1순위: ready-to-show 이벤트 (Electron 공식 권장, 첫 페인트 완료 후 발생)
  // 2순위: app-ready IPC (React 마운트 완료 신호)
  // 3순위: 8초 절대 타임아웃
  let readyShown = false;
  const timers = [];
  const showWindow = () => {
    if (!readyShown && !win.isDestroyed()) {
      readyShown = true;
      timers.forEach((t) => clearTimeout(t));
      win.show();
    }
  };

  // 절대 타임아웃 (8초)
  timers.push(setTimeout(showWindow, 8000));

  // ready-to-show: 첫 번째 프레임이 실제로 그려진 후 발생 (Windows에서 가장 안정적)
  win.once('ready-to-show', showWindow);

  // windowReadyHandlers에 등록 (app-ready IPC 핸들러에서 사용)
  const webContentsId = win.webContents.id;
  windowReadyHandlers.set(webContentsId, showWindow);
  win.on('closed', () => {
    windowReadyHandlers.delete(webContentsId);
  });

  // 렌더러 크래시 복구: 한 번만 자동 재로드
  let crashed = false;
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[window] render-process-gone:', details.reason);
    if (!crashed && details.reason !== 'clean-exit' && !win.isDestroyed()) {
      crashed = true;
      readyShown = false;
      if (initialRoute) {
        loadRoute(win, initialRoute);
      } else {
        const reloadUrl = getLoadURL();
        const reloadFile = getLoadFile();
        if (reloadUrl) win.loadURL(reloadUrl);
        else if (reloadFile) win.loadFile(reloadFile);
      }
    }
  });

  // F12로 DevTools 열기 (디버깅용)
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });

  if (process.argv.includes('--devtools')) {
    win.webContents.once('dom-ready', () => win.webContents.openDevTools());
  }

  // 파일 로드 실패 시 화면에 오류 표시
  win.webContents.on('did-fail-load', (_, code, desc, validatedURL) => {
    console.error('did-fail-load', code, desc, validatedURL);
    if (code === -3) return; // 사용자 취소 (무시)
    showWindow();
    win.webContents.executeJavaScript(`
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;background:#fff;color:#1e293b;min-height:100vh;">'
        + '<h2 style="color:#dc2626">앱 로드 오류</h2>'
        + '<p>오류 코드: ' + ${JSON.stringify(String(code))} + '</p>'
        + '<p>설명: ' + ${JSON.stringify(String(desc))} + '</p>'
        + '<p>URL: ' + ${JSON.stringify(String(validatedURL))} + '</p>'
        + '<p style="margin-top:16px;color:#64748b">이 화면을 개발자에게 전달해 주세요.</p>'
        + '</div>';
    `).catch(() => {});
  });

  const isMainWindow = !secondWindow;
  win.isMainWindow = isMainWindow;
  if (isMainWindow) {
    mainWindow = win;
    win.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on('closed', () => {
      if (mainWindow === win) mainWindow = null;
    });
  }

  return win;
}

function openSecondWindow() {
  createWindow({
    width: 900,
    height: 650,
    secondWindow: true,
  });
}

function openChatWindow(roomId) {
  createWindow({
    width: 480,
    height: 680,
    minWidth: 400,
    minHeight: 500,
    secondWindow: true,
    initialRoute: `/chat/${roomId}`,
  });
}

function openKanbanWindow(roomId) {
  createWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    secondWindow: true,
    initialRoute: `/kanban/${roomId}`,
  });
}

function openGanttWindow(roomId) {
  createWindow({
    width: 1200,
    height: 700,
    minWidth: 900,
    minHeight: 550,
    secondWindow: true,
    initialRoute: `/gantt/${roomId}`,
  });
}

function broadcastLogout() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.webContents.isDestroyed()) win.webContents.send('tray-logout');
  });
}

function doQuit() {
  isQuitting = true;
  app.quit();
}

function createTray() {
  if (tray) return;
  const img = nativeImage.createFromPath(iconPath);
  const size = process.platform === 'darwin' ? 22 : 16;
  const trayIcon = img.isEmpty() ? null : img.resize({ width: size, height: size });
  tray = new Tray(trayIcon && !trayIcon.isEmpty() ? trayIcon : iconPath);
  tray.setToolTip('TPA-Korea');
  const menu = Menu.buildFromTemplate([
    {
      label: '로그아웃',
      click: () => broadcastLogout(),
    },
    { type: 'separator' },
    { label: '종료', click: () => doQuit() },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

ipcMain.handle('open-second-window', () => {
  openSecondWindow();
});

ipcMain.handle('open-chat-window', (_, roomId) => {
  if (roomId) openChatWindow(roomId);
});

ipcMain.handle('open-kanban-window', (_, roomId) => {
  if (roomId) openKanbanWindow(roomId);
});

ipcMain.handle('open-gantt-window', (_, roomId) => {
  if (roomId) openGanttWindow(roomId);
});

ipcMain.handle('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});
ipcMain.handle('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});
ipcMain.handle('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.isMaximizable()) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.handle('window-set-ui-mode', (event, mode, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  const isLogin = mode === 'login';
  if (win.isMaximized()) win.unmaximize();
  win.setMaximizable(!isLogin);
  if (isLogin) {
    const w = Math.max(360, Math.round(Number(width) || 430));
    const h = Math.max(560, Math.round(Number(height) || 720));
    win.setResizable(false);
    win.setMinimumSize(w, h);
    win.setMaximumSize(w, h);
    win.setSize(w, h);
    if (process.platform === 'win32') {
      try {
        win.setTitleBarOverlay({ color: '#ffffff', symbolColor: '#0f172a', height: 38 });
      } catch {
        // overlay may be unavailable
      }
    }
  } else {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    win.setResizable(true);
    win.setMinimumSize(360, 560);
    win.setMaximumSize(Math.max(wa.width, 430), Math.max(wa.height, 900));
    if (process.platform === 'win32') {
      try {
        win.setTitleBarOverlay({ color: '#1e293b', symbolColor: '#e2e8f0', height: 38 });
      } catch {
        // overlay may be unavailable
      }
    }
  }
  return { ok: true };
});

ipcMain.handle('app-quit', () => {
  isQuitting = true;
  app.quit();
});

async function clearAppCache() {
  try {
    const ses = session.defaultSession;
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['cachestorage', 'serviceworkers'] });
  } catch (err) {
    console.error('[clearAppCache]', err);
  }
}

ipcMain.handle('clear-app-cache', () => clearAppCache());

ipcMain.handle('window-resize', (event, width, height) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof width === 'number' && typeof height === 'number') {
    win.setSize(Math.round(width), Math.round(height));
  }
});

ipcMain.handle('window-set-always-on-top', (event, flag) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false };
  const on = !!flag;
  win.setAlwaysOnTop(on);
  win.setMovable(!on);
  return { ok: true, alwaysOnTop: win.isAlwaysOnTop() };
});

ipcMain.handle('window-get-always-on-top', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  return { alwaysOnTop: !!(win && win.isAlwaysOnTop()) };
});

const DOWNLOAD_PREF_PATH = path.join(app.getPath('userData'), 'download-path.json');

function readDownloadPref() {
  try {
    const raw = fs.readFileSync(DOWNLOAD_PREF_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      path: typeof parsed?.path === 'string' ? parsed.path : null,
      askSaveAs: parsed?.askSaveAs === true,
    };
  } catch {
    return { path: null, askSaveAs: false };
  }
}

function writeDownloadPref(partial) {
  const next = { ...readDownloadPref(), ...partial };
  fs.writeFileSync(DOWNLOAD_PREF_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

ipcMain.handle('get-download-path', () => readDownloadPref());

ipcMain.handle('set-ask-save-as', (_, flag) => writeDownloadPref({ askSaveAs: !!flag }));

ipcMain.handle('pick-download-path', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win || undefined, {
    title: '첨부파일 저장 폴더 선택',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths?.[0]) {
    return { ...readDownloadPref(), canceled: true };
  }
  return { ...writeDownloadPref({ path: result.filePaths[0] }), canceled: false };
});

ipcMain.handle('clear-download-path', () => writeDownloadPref({ path: null }));

ipcMain.handle('save-file-to-download-path', async (event, { buffer, filename }) => {
  const pref = readDownloadPref();
  const safeName = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const win = BrowserWindow.fromWebContents(event.sender);
  let target = null;
  if (pref.askSaveAs) {
    const picked = await dialog.showSaveDialog(win || undefined, {
      title: '다른 이름으로 저장',
      defaultPath: pref.path ? path.join(pref.path, safeName) : safeName,
    });
    if (picked.canceled || !picked.filePath) return { ok: false, error: 'CANCELED' };
    target = picked.filePath;
  } else if (pref.path) {
    target = path.join(pref.path, safeName);
    if (fs.existsSync(target)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      target = path.join(pref.path, `${base}-${Date.now()}${ext}`);
    }
  } else {
    return { ok: false, error: 'NO_PATH' };
  }
  const data = Buffer.from(buffer);
  fs.writeFileSync(target, data);
  return { ok: true, path: target };
});

ipcMain.on('app-ready', (event) => {
  const showFn = windowReadyHandlers.get(event.sender.id);
  if (showFn) showFn();
});

ipcMain.on('emax-get-initial-route', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win?.__emaxInitialRoute ?? null;
});

ipcMain.handle('show-notification', (_, { title, body, roomId, icon, imagePreview }) => {
  showCustomNotification(title || 'TPA-Korea', body || '', { roomId: roomId || null, icon: icon || null, imagePreview: imagePreview || null });
});

// 앱 아이콘 배지 (맥 도크/윈도우 태스크바) - 안 읽은 개수를 그대로 표시
ipcMain.handle('set-badge-count', (_, count) => {
  if (typeof count !== 'number' || count < 0) return;
  try {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(count > 0 ? String(count) : '');
    } else if (process.platform === 'win32') {
      // 윈도우: setBadgeCount 미지원 → setOverlayIcon 사용 (이미지는 renderer에서 생성 후 set-overlay-icon으로 전달)
      app.setBadgeCount(0);
    } else {
      app.setBadgeCount(count);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[set-badge-count]', e?.message);
  }
});

// 윈도우 트레이 아이콘 배지 (새 메시지 있으면 빨간 N 표시)
ipcMain.handle('set-tray-badge', (_, dataUrl) => {
  if (process.platform !== 'win32' || !tray) return;
  try {
    const size = 16;
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img.isEmpty()) tray.setImage(img.resize({ width: size, height: size }));
    } else {
      const img = nativeImage.createFromPath(iconPath);
      const trayIcon = img.isEmpty() ? null : img.resize({ width: size, height: size });
      tray.setImage(trayIcon && !trayIcon.isEmpty() ? trayIcon : iconPath);
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[set-tray-badge]', e?.message);
  }
});

// 윈도우 태스크바 오버레이 아이콘 (N 배지 등)
ipcMain.handle('set-overlay-icon', (_, dataUrl) => {
  if (process.platform !== 'win32') return;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : BrowserWindow.getFocusedWindow();
  if (!win) return;
  try {
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      const img = nativeImage.createFromDataURL(dataUrl);
      win.setOverlayIcon(img, '새 메시지');
    } else {
      win.setOverlayIcon(null, '');
    }
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[set-overlay-icon]', e?.message);
  }
});

ipcMain.on('notification-clicked', () => {
  const roomId = pendingNotifRoomId;
  pendingNotifRoomId = null;
  if (customNotifWin && !customNotifWin.isDestroyed()) {
    customNotifWin.close();
    customNotifWin = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    if (roomId) {
      mainWindow.webContents.send('navigate-to-room', roomId);
    }
  }
});

ipcMain.handle('open-external', (_, url) => {
  if (url && typeof url === 'string') shell.openExternal(url);
});

// 설정 화면에서 업데이트 확인/설치용 IPC
ipcMain.handle('check-for-updates', async () => {
  if (isDev || !app.isPackaged) {
    return { success: false, error: '개발 모드에서는 업데이트를 확인할 수 없습니다.' };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const v = result?.updateInfo?.version;
    const current = app.getVersion();
    const hasUpdate = Boolean(v && v !== current);
    const downloaded = hasUpdate && pendingUpdateVersion === v;
    if (downloaded && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-downloaded');
    }
    return {
      success: true,
      hasUpdate,
      version: v || null,
      currentVersion: current,
      downloaded,
      requiresManualInstall: process.platform === 'darwin',
    };
  } catch (err) {
    const msg = err?.message || String(err);
    return { success: false, error: msg || '업데이트 확인에 실패했습니다.' };
  }
});

ipcMain.handle('quit-and-install', () => {
  if (isDev || !app.isPackaged) return { success: false, error: '개발 모드에서는 업데이트를 설치할 수 없습니다.' };
  if (process.platform === 'darwin') {
    const url = getReleaseDownloadUrl(pendingUpdateVersion || app.getVersion());
    shell.openExternal(url);
    return {
      success: false,
      requiresManualInstall: true,
      error: 'macOS에서는 DMG를 다운로드해 Applications 폴더에 다시 설치해 주세요.',
    };
  }
  try {
    autoUpdater.quitAndInstall(false, true);
    return { success: true };
  } catch (err) {
    const msg = err?.message || String(err);
    return { success: false, error: msg || '업데이트 설치에 실패했습니다.' };
  }
});

ipcMain.handle('open-update-download', (_, version) => {
  shell.openExternal(getReleaseDownloadUrl(version));
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-app-info', () => ({
  version: app.getVersion(),
  isPackaged: app.isPackaged,
  platform: process.platform,
}));

ipcMain.handle('set-title-bar-theme', (_, { isDark }) => {
  if (process.platform !== 'win32') return;
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    win.setTitleBarOverlay({
      color: isDark ? '#1e293b' : '#ffffff',
      symbolColor: isDark ? '#e2e8f0' : '#0f172a',
      height: 38,
    });
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') console.warn('[set-title-bar-theme]', e?.message);
  }
});

// CORS 우회: 메인 프로세스에서 사용자 아바타 fetch (Electron file:// 환경)
ipcMain.handle('fetch-user-avatar', async (_, { userId, baseUrl, token }) => {
  if (!userId || !baseUrl || !token) return null;
  try {
    const url = `${String(baseUrl).replace(/\/$/, '')}/users/${userId}/avatar`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${base64}`;
  } catch (e) {
    console.warn('[fetch-user-avatar]', e?.message);
    return null;
  }
});

function setupAutoUpdate() {
  if (isDev || !app.isPackaged) return;
  if (updaterBaseUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: updaterBaseUrl });
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', () => {
    showCustomNotification('TPA-Korea 업데이트', '새 버전을 다운로드 중입니다. 완료 후 앱을 재시작하면 적용됩니다.', { persistent: true, progress: 0 });
  });
  autoUpdater.on('download-progress', (progress) => {
    updateNotificationProgress(progress.percent);
  });
  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info?.version || null;
    updateDownloadedPending = true;
    const isMac = process.platform === 'darwin';
    showCustomNotification(
      'TPA-Korea 업데이트 준비됨',
      isMac
        ? '설정에서 DMG를 다운로드해 Applications에 다시 설치해 주세요.'
        : '3초 후 앱이 자동으로 재시작됩니다.',
    );
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('update-downloaded');
    }
    if (!isMac) {
      setTimeout(() => {
        if (updateDownloadedPending && app.isPackaged && !isDev) {
          updateDownloadedPending = false;
          autoUpdater.quitAndInstall(false, true);
        }
      }, 3000);
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });
  autoUpdater.checkForUpdates()
    .then(() => {
      // 업데이트 확인 완료 (별도 처리 불필요)
    })
    .catch((err) => {
      console.error('Update check failed:', err);
    });

  // 앱 실행 중 주기적 업데이트 확인 (30분마다)
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => console.error('Update check failed:', err));
  }, CHECK_INTERVAL_MS);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.tpakorea.message');
  }
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
    app.dock.setMenu(Menu.buildFromTemplate([
      { label: '로그아웃', click: () => broadcastLogout() },
      { type: 'separator' },
      { label: '종료', click: () => doQuit() },
    ]));
  }
  createWindow();
  createTray();
  setupAutoUpdate();
  const menu = Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '테스트',
      submenu: [
        {
          label: '새 창 열기 (다른 계정으로 로그인)',
          click: openSecondWindow,
        },
      ],
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '업데이트 확인',
          click: () => {
            if (!isDev && app.isPackaged) {
              autoUpdater.checkForUpdates()
                .then((r) => {
                  const v = r?.updateInfo?.version;
                  const current = app.getVersion();
                  const body = v ? (v === current ? '이미 최신 버전입니다.' : `새 버전 ${v}이(가) 있습니다. 다운로드 후 앱을 재시작하면 적용됩니다.`) : '업데이트 정보를 확인했습니다.';
                  showCustomNotification('TPA-Korea', body);
                })
                .catch((e) => {
                  console.error('Update check failed:', e);
                  showCustomNotification('TPA-Korea', '업데이트 확인에 실패했습니다. 네트워크를 확인하거나 나중에 다시 시도해 주세요.');
                });
            }
          },
        },
      ],
    },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
});

app.on('before-quit', (e) => {
  if (!isQuitting) isQuitting = true;
  // 종료 후 디스크에 대화·쪽지·조직도 캐시가 남지 않도록 정리(완료를 기다리지 않는 best-effort)
  clearAppCache();
  // 업데이트 대기 중이면 quitAndInstall로 설치 후 재시작 (한 번에 적용)
  if (updateDownloadedPending && app.isPackaged && !isDev) {
    updateDownloadedPending = false;
    e.preventDefault();
    setImmediate(() => {
      app.removeAllListeners('window-all-closed');
      BrowserWindow.getAllWindows().forEach((w) => { if (!w.isDestroyed()) w.destroy(); });
      autoUpdater.quitAndInstall(false, true);
    });
  }
});

app.on('window-all-closed', () => {
  // 메인 창은 닫기 시 hide되므로 destroy되지 않음. 앱은 트레이에서 계속 실행.
  // 사용자가 트레이/도크 메뉴에서 '종료'를 선택할 때만 app.quit() 호출됨.
});

app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
