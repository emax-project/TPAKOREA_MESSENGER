const { app, BrowserWindow, Menu, ipcMain, Tray, screen, shell, nativeImage, dialog, session, safeStorage, powerMonitor, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');

// userData 폴더를 브랜드별로 분리한다(Roaming/TPA-Korea). package.json의 "name"은 모든 브랜드 빌드에서
// "client"로 같아서, 이름을 지정하지 않으면 같은 PC의 다른 브랜드 앱과 localStorage(서버 주소 등)가 섞인다.
// 패키징된 앱에서는 package.json의 build.productName을 읽지 못해 setName이 실행되지 않았으므로 직접 지정한다(CSIN-Tech와 동일).
// 반드시 app.getPath('userData')를 처음 쓰기 전에 호출할 것.
app.setName('TPA-Korea');

// 그래픽(GPU) 가속: 기본은 사용. 드라이버 문제로 GPU 프로세스가 반복 종료하는 PC나 사용자가
// 직접 끈 경우에만 소프트웨어 렌더링으로 내린다(정책은 gpuPolicy.js, 상태는 userData/gpu-state.json).
// GPU 샌드박스는 끄지 않는다 — 예전 무조건 --disable-gpu-sandbox 설정은 보안만 약하게 만들었다.
const gpuPolicy = require('./gpuPolicy');
const policyHelpers = require('./policyHelpers');
const GPU_STATE_FILE = path.join(app.getPath('userData'), 'gpu-state.json');

function readGpuState() {
  try {
    return gpuPolicy.normalizeState(JSON.parse(fs.readFileSync(GPU_STATE_FILE, 'utf8')));
  } catch {
    return gpuPolicy.emptyState();
  }
}

function writeGpuState(state) {
  try {
    fs.writeFileSync(GPU_STATE_FILE, JSON.stringify(state));
  } catch (err) {
    console.error('[gpu] state write failed', err);
  }
}

const gpuDecision = gpuPolicy.decideGpu({ env: process.env, argv: process.argv, state: readGpuState() });
if (gpuDecision.disable) {
  console.warn(`[gpu] 하드웨어 가속 비활성화 (${gpuDecision.reason})`);
  app.disableHardwareAcceleration();
}

app.on('child-process-gone', (_event, details) => {
  const before = readGpuState();
  const after = gpuPolicy.recordGpuExit(before, details);
  if (after !== before) {
    console.error('[gpu] GPU 프로세스 비정상 종료:', details.reason);
    writeGpuState(after);
  }
});

/** 트레이/앱 메뉴용 — 그래픽 가속 사용 여부를 사용자가 직접 바꾼다(재시작 후 적용). */
function gpuMenuItem() {
  const forced = readGpuState().forceDisable;
  return {
    label: '그래픽 가속 사용',
    type: 'checkbox',
    checked: !forced,
    click: async () => {
      writeGpuState(gpuPolicy.setUserForceDisable(readGpuState(), !forced));
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: ['지금 재시작', '나중에'],
        defaultId: 0,
        cancelId: 1,
        message: forced ? '그래픽 가속을 켰습니다.' : '그래픽 가속을 껐습니다.',
        detail: '화면이 검게 나오거나 깨질 때는 끄면 해결될 수 있습니다. 재시작하면 적용됩니다.',
      });
      if (response === 0) {
        app.relaunch();
        doQuit();
      }
    },
  };
}

// 단일 인스턴스 잠금: 두 번 실행하면 기존 창을 포커스하고 종료
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// 로그인 토큰을 OS 암호화 API(Windows DPAPI/macOS Keychain 기반 safeStorage)로
// 암호화해 저장 — 평문 localStorage 저장을 대체한다.
const TOKEN_FILE = path.join(app.getPath('userData'), 'token.enc');

function readTokenFile() {
  try {
    if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(TOKEN_FILE)) return null;
    return safeStorage.decryptString(fs.readFileSync(TOKEN_FILE));
  } catch (err) {
    console.error('[token] read failed', err);
    return null;
  }
}

function writeTokenFile(token) {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    fs.writeFileSync(TOKEN_FILE, safeStorage.encryptString(token));
    return true;
  } catch (err) {
    console.error('[token] write failed', err);
    return false;
  }
}

function clearTokenFile() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch (err) {
    console.error('[token] clear failed', err);
  }
}

// 아바타 등 토큰을 들고 나가는 요청이 렌더러가 부르는 임의 주소로 가지 않도록,
// 로그인마다 "신뢰할 서버 주소"를 메인 프로세스가 직접 기억해 둔다(민감정보 아님, 평문 저장).
const BASE_URL_FILE = path.join(app.getPath('userData'), 'base-url.txt');
let trustedBaseUrl = null;
try {
  if (fs.existsSync(BASE_URL_FILE)) trustedBaseUrl = fs.readFileSync(BASE_URL_FILE, 'utf8').trim() || null;
} catch {
  trustedBaseUrl = null;
}

ipcMain.handle('set-trusted-base-url', (_e, url) => {
  if (typeof url !== 'string' || !isAllowedExternalProtocol(url)) return false;
  trustedBaseUrl = url;
  try {
    fs.writeFileSync(BASE_URL_FILE, url, 'utf8');
  } catch (err) {
    console.error('[baseUrl] write failed', err);
  }
  return true;
});

ipcMain.on('token-read-sync', (event) => {
  event.returnValue = readTokenFile();
});
ipcMain.handle('token-write', (_e, token) => writeTokenFile(token));
ipcMain.handle('token-clear', () => {
  clearTokenFile();
  trustedBaseUrl = null;
  try { if (fs.existsSync(BASE_URL_FILE)) fs.unlinkSync(BASE_URL_FILE); } catch { /* ignore */ }
  return true;
});

// Remove credentials and cookies left by older desktop versions.
async function clearLegacyGroupwareData() {
  const file = path.join(app.getPath('userData'), 'gw-cred.enc');
  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    console.error('[groupware] legacy credentials cleanup failed', error);
  }
  try {
    await session.fromPartition('persist:groupware').clearStorageData();
  } catch (error) {
    console.error('[groupware] legacy session cleanup failed', error);
  }
}

const NOTIF_WIDTH = 360;
const NOTIF_HEIGHT = 100;
const NOTIF_HEIGHT_PROGRESS = 128;
const NOTIF_DURATION_MS = 4500;

// 메인 창 크기(width/height) 기억 — PC에서 사용자가 원하는 대로 넓혀 쓸 수 있도록
// 모바일 기본 규격(430x900)은 최초 실행 시에만 적용하고, 이후에는 마지막으로 사용한 크기를 복원한다.
const WINDOW_BOUNDS_PREF_PATH = path.join(app.getPath('userData'), 'window-bounds.json');
const DEFAULT_MAIN_WINDOW_WIDTH = 430;
const DEFAULT_MAIN_WINDOW_HEIGHT = 900;

function readWindowBoundsPref() {
  try {
    const raw = fs.readFileSync(WINDOW_BOUNDS_PREF_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const width = Number(parsed?.width);
    const height = Number(parsed?.height);
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

function writeWindowBoundsPref(bounds) {
  try {
    fs.writeFileSync(WINDOW_BOUNDS_PREF_PATH, JSON.stringify(bounds, null, 2), 'utf8');
  } catch {
    // 저장 실패(읽기 전용 FS 등)는 무시 — 다음 실행 때 기본 크기로 돌아갈 뿐
  }
}

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
  attachNavigationGuards(win);
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
// 시작 시/30분 주기/설정화면 수동확인/메뉴 수동확인, 총 4곳에서 checkForUpdates()를
// 부른다. 중복된 업데이트 조회를 피하기 위해,
// 진행 중인 검사가 있으면 새로 시작하지 않고 그 Promise를 그대로 재사용한다.
let updateCheckPromise = null;
let updateDownloadPromise = null;
function safeCheckForUpdates() {
  if (updateDownloadedPending) {
    // 이미 다운로드까지 끝나 설치 대기 중 — 다시 받을 필요 없음
    return Promise.resolve({ updateInfo: { version: pendingUpdateVersion } });
  }
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = autoUpdater.checkForUpdates().finally(() => {
    updateCheckPromise = null;
  });
  return updateCheckPromise;
}
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

/** 창에 평소 앱 화면을 (다시) 띄운다 — 초기 진입과 크래시 복구 재시도 양쪽에서 쓴다. */
function reloadWindowContent(win, initialRoute) {
  if (initialRoute) {
    loadRoute(win, initialRoute);
    return;
  }
  const url = getLoadURL();
  const file = getLoadFile();
  if (url) win.loadURL(url);
  else if (file) win.loadFile(file);
}

// 렌더러 반복 크래시를 진단할 수 있도록 사유·횟수만 기록한다(비밀번호·토큰·대화
// 내용 등 민감정보는 이 이벤트 자체에 포함되지 않으므로 그대로 적어도 안전함).
const CRASH_LOG_PATH = path.join(app.getPath('userData'), 'crash-log.jsonl');
function logCrash(entry) {
  try {
    const line = JSON.stringify({ ...entry, at: new Date().toISOString() }) + '\n';
    fs.appendFileSync(CRASH_LOG_PATH, line, 'utf8');
    // 무한정 커지지 않도록 너무 크면(약 200KB 이상) 앞부분을 잘라낸다
    const stat = fs.statSync(CRASH_LOG_PATH);
    if (stat.size > 200_000) {
      const lines = fs.readFileSync(CRASH_LOG_PATH, 'utf8').split('\n');
      fs.writeFileSync(CRASH_LOG_PATH, lines.slice(-500).join('\n'), 'utf8');
    }
  } catch (err) {
    console.error('[logCrash]', err);
  }
}

function showCrashRecoveryScreen(win, count, reason) {
  if (win.isDestroyed()) return;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
    <body style="margin:0;padding:40px;font-family:sans-serif;background:#fff;color:#1e293b;min-height:100vh;box-sizing:border-box;">
      <h2 style="color:#dc2626">화면에 반복적으로 문제가 발생했습니다</h2>
      <p>잠시 후 다시 시도해 주세요. 문제가 계속되면 아래 버튼 대신 앱을 완전히 종료했다가 다시 실행해 주세요.</p>
      <p style="color:#64748b;font-size:13px;">반복 횟수: ${count}회 · 마지막 원인: ${String(reason).replace(/[<>&]/g, '')}</p>
      <button id="__retry" style="margin-top:16px;padding:10px 20px;font-size:14px;border:none;border-radius:8px;background:#1e293b;color:#fff;cursor:pointer;">다시 시도</button>
      <script>
        document.getElementById('__retry').addEventListener('click', () => {
          window.electronAPI && window.electronAPI.restartAfterCrash && window.electronAPI.restartAfterCrash();
        });
      </script>
    </body></html>`;
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function isAllowedExternalProtocol(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// 새 창 열기(window.open)·페이지 이동(will-navigate)을 앱 자체 콘텐츠로만 제한한다.
// http/https 링크는 새 창/이동 대신 OS 기본 브라우저로 열고, 그 외(file:// 등)는 차단.
function attachNavigationGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalProtocol(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    const isAppContent = (isDev && url.startsWith('http://localhost:5173')) || url.startsWith('file://');
    if (isAppContent) return;
    event.preventDefault();
    if (isAllowedExternalProtocol(url)) shell.openExternal(url);
  });
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

  attachNavigationGuards(win);

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

  // 렌더러 크래시 복구: 처음 한 번은 조용히 자동 재시도하고, 반복되면(화면이 계속
  // 비정상 종료되면) 더 이상 무한 반복하지 않고 안내 화면 + 다시 시도 버튼을 보여준다.
  const MAX_SILENT_RELOADS = 1;
  win.__emaxCrashCount = 0;
  win.webContents.on('render-process-gone', (event, details) => {
    console.error('[window] render-process-gone:', details.reason);
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    win.__emaxCrashCount += 1;
    logCrash({ type: 'render-process-gone', reason: details.reason, exitCode: details.exitCode, count: win.__emaxCrashCount });
    readyShown = false;
    if (win.__emaxCrashCount <= MAX_SILENT_RELOADS) {
      reloadWindowContent(win, initialRoute);
    } else {
      showWindow();
      showCrashRecoveryScreen(win, win.__emaxCrashCount, details.reason);
    }
  });

  // F12로 DevTools 열기 (개발 빌드에서만 — 운영 빌드에서는 비활성)
  win.webContents.on('before-input-event', (event, input) => {
    if (isDev && input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools();
    }
  });

  if (isDev && process.argv.includes('--devtools')) {
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

    // 메인 화면(로그인 화면 제외)에서 사용자가 드래그로 크기를 바꾸면 기억해 뒀다가 다음 실행 때 복원
    let boundsSaveTimer = null;
    win.on('resize', () => {
      if (win.__emaxUiMode !== 'main' || win.isMaximized()) return;
      clearTimeout(boundsSaveTimer);
      boundsSaveTimer = setTimeout(() => {
        if (win.isDestroyed()) return;
        const [width, height] = win.getSize();
        writeWindowBoundsPref({ width, height });
      }, 400);
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
  const chatWindows = BrowserWindow.getAllWindows().filter(
    (w) => !w.isDestroyed() && typeof w.__emaxInitialRoute === 'string' && w.__emaxInitialRoute.startsWith('/chat/'),
  );
  const existing = chatWindows.find((w) => w.__emaxInitialRoute === `/chat/${roomId}`);
  if (existing) {
    // 이미 열려 있는 방이면 새로 만들지 않고 그 창을 앞으로 가져온다
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }
  if (!policyHelpers.canOpenChatWindow(chatWindows.length, maxChatWindows)) {
    showCustomNotification('CSIN-Tech', `대화창은 최대 ${maxChatWindows}개까지 열 수 있습니다. 다른 창을 닫고 다시 시도해 주세요.`);
    return;
  }
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
    gpuMenuItem(),
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

// ── 팝업 대화창 ↔ 메인 창 소켓 중계 ───────────────────────────────────
// 서버 실시간 연결은 메인 창 하나만 유지하고, 팝업 대화창은 이 중계를 통해 이벤트를 받고 보낸다.
// 메인 창이 아직 준비되지 않았거나 닫혀 있으면 available이 false라서 팝업이 자체 연결로 대신한다.
let socketRelayHost = null;
const isChatPopupWindow = (w) =>
  !!w && !w.isDestroyed() && typeof w.__emaxInitialRoute === 'string' && w.__emaxInitialRoute.startsWith('/chat/');
const relayHostAlive = () => !!socketRelayHost && !socketRelayHost.isDestroyed();

function broadcastRelayEvent(payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (isChatPopupWindow(w)) w.webContents.send('socket-relay:event', payload);
  }
}

ipcMain.on('socket-relay:host-register', (event) => {
  // 메인 창만 호스트가 될 수 있다(팝업·두 번째 창이 연결을 가로채지 못하게)
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) return;
  socketRelayHost = event.sender;
});

ipcMain.on('socket-relay:host-unregister', (event) => {
  if (socketRelayHost !== event.sender) return;
  socketRelayHost = null;
  broadcastRelayEvent({ event: '__disconnect', args: ['relay-host-gone'] });
});

ipcMain.handle('socket-relay:available', (event) => isChatPopupWindow(BrowserWindow.fromWebContents(event.sender)) && relayHostAlive());

ipcMain.on('socket-relay:request', (event, msg) => {
  if (!isChatPopupWindow(BrowserWindow.fromWebContents(event.sender)) || !msg || typeof msg.reqId !== 'number') return;
  if (!relayHostAlive()) {
    event.sender.send('socket-relay:response', { reqId: msg.reqId, error: 'RELAY_UNAVAILABLE' });
    return;
  }
  socketRelayHost.send('socket-relay:request', { ...msg, from: event.sender.id });
});

ipcMain.on('socket-relay:response', (event, msg) => {
  if (event.sender !== socketRelayHost || !msg) return;
  const target = webContents.fromId(msg.to);
  if (!target || target.isDestroyed()) return;
  const { to: _to, ...rest } = msg;
  target.send('socket-relay:response', rest);
});

ipcMain.on('socket-relay:event', (event, msg) => {
  if (event.sender !== socketRelayHost || !msg || typeof msg.event !== 'string') return;
  broadcastRelayEvent({ event: msg.event, args: Array.isArray(msg.args) ? msg.args : [] });
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
  win.__emaxUiMode = isLogin ? 'login' : 'main';
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
    const maxW = Math.max(wa.width, 430);
    const maxH = Math.max(wa.height, 900);
    win.setResizable(true);
    win.setMinimumSize(360, 560);
    win.setMaximumSize(maxW, maxH);
    // 로그인 창(모바일 고정 규격)에서 넘어온 직후에는 마지막으로 사용자가 조정한 크기를 복원하고,
    // 저장된 값이 없으면(최초 실행) 기본 모바일 규격을 사용한다.
    const pref = readWindowBoundsPref();
    const targetW = Math.min(Math.max(pref.width ?? DEFAULT_MAIN_WINDOW_WIDTH, 360), maxW);
    const targetH = Math.min(Math.max(pref.height ?? DEFAULT_MAIN_WINDOW_HEIGHT, 560), maxH);
    win.setSize(Math.round(targetW), Math.round(targetH));
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

// 반복 크래시 안내 화면의 '다시 시도' 버튼 — 그 창에 평소 앱 화면을 다시 띄우고
// 크래시 횟수를 리셋해(수동 복구는 성공으로 간주) 다음 크래시도 조용한 자동
// 재시도부터 다시 시작하게 한다.
ipcMain.handle('restart-after-crash', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  win.__emaxCrashCount = 0;
  reloadWindowContent(win, win.__emaxInitialRoute);
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

// 첨부파일을 렌더러를 거치지 않고 메인 프로세스에서 직접 내려받아 디스크에 스트리밍
// 저장한다 — 큰 파일을 통째로 메모리(blob/ArrayBuffer)에 올리지 않기 위함. 토큰·주소는
// 렌더러가 보내는 값을 믿지 않고(아바타 요청과 동일한 이유) 로그인 시 저장해 둔
// 암호화 토큰·신뢰 서버 주소를 그대로 쓴다.
ipcMain.handle('download-file-stream', async (event, { messageId, filename }) => {
  if (!messageId || !trustedBaseUrl) return { ok: false, error: 'NO_SERVER' };
  const token = readTokenFile();
  if (!token) return { ok: false, error: 'NO_TOKEN' };

  const pref = readDownloadPref();
  const safeName = String(filename || 'download').replace(/[\\/:*?"<>|]/g, '_');
  const win = BrowserWindow.fromWebContents(event.sender);
  const defaultDir = pref.path || app.getPath('downloads');
  let target;
  if (pref.askSaveAs) {
    const picked = await dialog.showSaveDialog(win || undefined, {
      title: '다른 이름으로 저장',
      defaultPath: path.join(defaultDir, safeName),
    });
    if (picked.canceled || !picked.filePath) return { ok: false, error: 'CANCELED' };
    target = picked.filePath;
  } else {
    target = path.join(defaultDir, safeName);
    if (fs.existsSync(target)) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      target = path.join(defaultDir, `${base}-${Date.now()}${ext}`);
    }
  }

  const url = `${trustedBaseUrl.replace(/\/$/, '')}/files/download/${messageId}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const failure = await res.json().catch(() => null);
      const error = failure?.code === 'FILE_DOWNLOAD_DISABLED' ? failure.code : `HTTP_${res.status}`;
      return { ok: false, error };
    }
    if (!res.body) return { ok: false, error: 'DOWNLOAD_FAILED' };
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target));
    return { ok: true, path: target };
  } catch (err) {
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target); // 실패·취소 시 불완전 파일 정리
    } catch {
      // ignore
    }
    console.error('[download-file-stream]', err);
    return { ok: false, error: err?.message || 'DOWNLOAD_FAILED' };
  }
});

ipcMain.on('app-ready', (event) => {
  const showFn = windowReadyHandlers.get(event.sender.id);
  if (showFn) showFn();
});

ipcMain.on('emax-get-initial-route', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  event.returnValue = win?.__emaxInitialRoute ?? null;
});

// 화면 잠금 상태(렌더러가 알려줌) — 잠겨 있으면 알림에 대화 내용·보낸 사람이 보이지 않게 한다
let screenLocked = false;
ipcMain.on('set-screen-locked', (_, locked) => {
  screenLocked = locked === true;
});

// 서버 보안 정책의 "동시에 열 수 있는 대화창 수"(0 = 제한 없음). 렌더러가 정책을 받으면 알려준다.
let maxChatWindows = 0;
ipcMain.on('set-max-chat-windows', (_, value) => {
  maxChatWindows = policyHelpers.sanitizeMaxChatWindows(value);
});

ipcMain.handle('show-notification', (_, { title, body, roomId, icon, imagePreview }) => {
  const n = policyHelpers.maskNotificationIfLocked(
    { title: title || 'TPA-Korea', body: body || '', roomId: roomId || null, icon: icon || null, imagePreview: imagePreview || null },
    screenLocked,
  );
  showCustomNotification(n.title, n.body, { roomId: n.roomId, icon: n.icon, imagePreview: n.imagePreview });
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
  if (typeof url === 'string' && isAllowedExternalProtocol(url)) shell.openExternal(url);
});

// 설정 화면에서 업데이트 확인/설치용 IPC
ipcMain.handle('check-for-updates', async () => {
  if (isDev || !app.isPackaged) {
    return { success: false, error: '개발 모드에서는 업데이트를 확인할 수 없습니다.' };
  }
  try {
    const result = await safeCheckForUpdates();
    const v = result?.updateInfo?.version;
    const current = app.getVersion();
    const hasUpdate = Boolean(v && v !== current);
    if (hasUpdate && !updateDownloadedPending && process.platform !== 'darwin') {
      const options = {
        type: 'info',
        message: `새 버전 v${v}을 다운로드할까요?`,
        buttons: ['다운로드', '나중에'],
        defaultId: 1,
        cancelId: 1,
      };
      const choice = mainWindow && !mainWindow.isDestroyed()
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      if (choice.response === 0 && !updateDownloadedPending) {
        updateDownloadPromise ??= autoUpdater.downloadUpdate().finally(() => {
          updateDownloadPromise = null;
        });
        await updateDownloadPromise;
      }
    }
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
  if (!updateDownloadedPending) return { success: false, error: '다운로드가 완료된 업데이트가 없습니다.' };
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

ipcMain.on('print-memo', (event) => {
  event.sender.print();
});

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
// 토큰·주소 모두 렌더러가 매 호출마다 보내는 값을 쓰지 않고, 로그인 시 저장해 둔
// 암호화 토큰·신뢰 서버 주소를 직접 쓴다 — 렌더러가 임의 주소를 넘겨도 토큰이
// 그 주소로 새 나가지 않도록 함.
ipcMain.handle('fetch-user-avatar', async (_, { userId }) => {
  if (!userId || !trustedBaseUrl) return null;
  const token = readTokenFile();
  if (!token) return null;
  try {
    const url = `${trustedBaseUrl.replace(/\/$/, '')}/users/${userId}/avatar`;
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

// 업데이트 설치 파일이 쌓이는 폴더 정리 (Windows: %LOCALAPPDATA%\csin-tech-updater\pending).
// 이전 버전은 앱 이름이 'client'라 %LOCALAPPDATA%\client-updater 를 썼고 설치 파일(약 166MB)이 그대로 남아 있다.
// - 현재 폴더: 가장 최근 설치 파일 1개(차등 업데이트 기준)만 남기고 나머지·미완성 파일 삭제
// - 옛 폴더: 더 이상 쓰이지 않으므로 pending 안의 파일 모두 삭제
async function pruneUpdaterCache() {
  if (updateDownloadPromise || updateDownloadedPending) return;
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return;
  const readFiles = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, mtimeMs: fs.statSync(path.join(dir, e.name)).mtimeMs }));
    } catch {
      return [];
    }
  };
  const remove = (dir, names) => {
    for (const name of names) {
      try {
        fs.unlinkSync(path.join(dir, name));
        console.log('[updater-cache] 삭제:', name);
      } catch (err) {
        console.warn('[updater-cache] 삭제 실패:', name, err?.message);
      }
    }
  };
  const cache = path.join(process.env.LOCALAPPDATA, 'csin-tech-updater');
  const current = path.join(cache, 'pending');
  const pendingFiles = readFiles(current);
  const staleFiles = policyHelpers.pickStaleUpdaterFiles(pendingFiles);
  remove(current, staleFiles);
  const cachedInstaller = pendingFiles.find(({ name }) => /\.exe$/i.test(name) && !staleFiles.includes(name));
  if (cachedInstaller) {
    const installedCopy = path.join(cache, 'installer.exe');
    const pendingCopy = path.join(current, cachedInstaller.name);
    const digest = async (file) => {
      const hash = createHash('sha512');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      return hash.digest('hex');
    };
    try {
      const [installedStat, pendingStat] = await Promise.all([fs.promises.stat(installedCopy), fs.promises.stat(pendingCopy)]);
      if (installedStat.size === pendingStat.size) {
        const [installedHash, pendingHash] = await Promise.all([digest(installedCopy), digest(pendingCopy)]);
        if (installedHash === pendingHash && !updateDownloadPromise && !updateDownloadedPending) {
          remove(current, [cachedInstaller.name]);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[updater-cache] 중복 확인 실패:', error.message);
    }
  }
  const legacy = path.join(process.env.LOCALAPPDATA, 'client-updater', 'pending');
  remove(legacy, readFiles(legacy).map((f) => f.name));
}

function setupAutoUpdate() {
  if (isDev || !app.isPackaged) return;
  // 설치 직후·재실행 때 한 번 정리(업데이트 확인과 겹치지 않도록 잠시 뒤에)
  setTimeout(pruneUpdaterCache, 60 * 1000);
  if (updaterBaseUrl) {
    // 업데이트 서버를 직접 지정하는 경우에도 평문(http)은 쓰지 않는다 — 중간자가 설치 파일을
    // 바꿔치기할 수 있다. https가 아니면 지정을 무시하고 기본(GitHub Releases) 경로를 쓴다.
    if (/^https:\/\//i.test(updaterBaseUrl)) {
      autoUpdater.setFeedURL({ provider: 'generic', url: updaterBaseUrl });
    } else {
      console.error('[updater] ELECTRON_UPDATER_BASE_URL은 https여야 합니다. 무시하고 기본 경로를 사용합니다.');
    }
  }
  // 다운그레이드·시험판 설치를 막는다. (설치 파일의 sha512 검증은 electron-updater가 항상 수행하고,
  // 서명된 빌드는 app-update.yml의 publisherName으로 Windows 코드 서명 발행자도 검증한다 — 아래 DEPLOY 문서 참고)
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let announcedVersion;
  autoUpdater.on('update-available', ({ version }) => {
    if (announcedVersion === version) return;
    announcedVersion = version;
    showCustomNotification('TPA-Korea 업데이트', `새 버전 v${version}이 있습니다. 설정에서 업데이트를 확인해 주세요.`);
  });
  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdateVersion = info?.version || null;
    updateDownloadedPending = true;
    const isMac = process.platform === 'darwin';
    showCustomNotification(
      'TPA-Korea 업데이트 준비됨',
      isMac
        ? '설정에서 DMG를 다운로드해 Applications에 다시 설치해 주세요.'
        : '설정에서 설치할 시점을 선택해 주세요.',
    );
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('update-downloaded');
    }
  });
  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });
  safeCheckForUpdates()
    .then(() => {
      // 업데이트 확인 완료 (별도 처리 불필요)
    })
    .catch((err) => {
      console.error('Update check failed:', err);
    });

  // 앱 실행 중 주기적 업데이트 확인 (30분마다)
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  setInterval(() => {
    safeCheckForUpdates().catch((err) => console.error('Update check failed:', err));
  }, CHECK_INTERVAL_MS);
}

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// OS 화면 잠금·절전 진입 시 열려 있는 모든 창에 알려 앱 화면도 함께 잠근다
function notifySystemLock() {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('system-lock');
  });
}

app.whenReady().then(() => {
  void clearLegacyGroupwareData();
  powerMonitor.on('lock-screen', notifySystemLock);
  powerMonitor.on('suspend', notifySystemLock);

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
    // 개발용 메뉴 — 운영 빌드에는 포함하지 않음
    ...(isDev ? [{
      label: '테스트',
      submenu: [
        {
          label: '새 창 열기 (다른 계정으로 로그인)',
          click: openSecondWindow,
        },
      ],
    }] : []),
    {
      label: '도움말',
      submenu: [
        gpuMenuItem(),
        { type: 'separator' },
        {
          label: '업데이트 확인',
          click: () => {
            if (!isDev && app.isPackaged) {
              safeCheckForUpdates()
                .then((r) => {
                  const v = r?.updateInfo?.version;
                  const current = app.getVersion();
                  const body = v ? (v === current ? '이미 최신 버전입니다.' : `새 버전 ${v}이(가) 있습니다. 설정에서 업데이트를 확인해 주세요.`) : '업데이트 정보를 확인했습니다.';
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

app.on('before-quit', () => {
  isQuitting = true;
  clearAppCache();
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
