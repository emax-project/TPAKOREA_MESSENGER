import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';

// 필수 환경변수 검증 — 서버 시작 전 누락 시 즉시 종료
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET'];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[startup] 필수 환경변수가 설정되지 않았습니다: ${missingEnv.join(', ')}`);
  process.exit(1);
}
if (process.env.JWT_SECRET === 'change-me-in-production') {
  console.warn('[startup] 경고: JWT_SECRET이 기본값입니다. 운영 환경에서는 반드시 변경하세요.');
}

// 처리되지 않은 예외를 로깅하여 서버가 조용히 죽는 것 방지
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason, promise);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { roomsRouter } from './routes/rooms.js';
import { orgRouter } from './routes/org.js';
import { filesRouter } from './routes/files.js';
import { announcementRouter } from './routes/announcement.js';
import { eventsRouter } from './routes/events.js';
import { pollsRouter } from './routes/polls.js';
import { projectsRouter } from './routes/projects.js';
import { bookmarksRouter } from './routes/bookmarks.js';
import { mentionsRouter } from './routes/mentions.js';
import { memosRouter } from './routes/memos.js';
import { linkPreviewRouter } from './routes/linkPreview.js';
import { foldersRouter } from './routes/folders.js';
import { orgGroupsRouter } from './routes/orgGroups.js';
import { settingsRouter } from './routes/settings.js';
import { prisma } from './db.js';
import { authMiddleware, verifySessionToken } from './auth.js';
import { registerSocketHandlers } from './socket.js';
import { UPLOAD_DIR } from './upload.js';
import { startCleanupJob } from './cleanup.js';
import { checkLdapConnection, isLdapEnabled } from './lib/ldap.js';


const app = express();
const httpServer = createServer(app);
// Socket.io 롱커넥션을 위해 서버 수준 타임아웃은 0 유지
// 파일 업로드는 /files/upload 라우트에서 개별 타임아웃 관리
httpServer.timeout = 0;
httpServer.requestTimeout = 30000;  // 일반 API: 30초
httpServer.headersTimeout = 35000;  // requestTimeout보다 약간 크게

app.use(cors({ origin: true }));
app.use(express.json());

// 기본적으로 모든 응답은 디스크·브라우저 캐시에 남기지 않음(대화·쪽지·조직도 등 민감정보 보호).
// 공개 이미지(아바타, 링크 미리보기)처럼 캐싱이 필요한 라우트는 각자 Cache-Control을 뒤에서 덮어씀.
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Public avatar endpoints (no auth required, used by <img> / <Image> tags)
app.get('/users/:id/avatar', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { avatarUrl: true },
    });
    if (!user?.avatarUrl) return res.status(404).json({ error: 'Avatar not found' });
    const filePath = path.resolve(UPLOAD_DIR, user.avatarUrl);
    return res.sendFile(filePath, { maxAge: 86400 }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Avatar not found' });
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch avatar' });
  }
});
// /api 접두사 지원 (모바일·배포 시 baseUrl에 /api 포함 시)
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/org', orgRouter);
app.use('/api/files', filesRouter);
app.use('/api/announcement', announcementRouter);
app.use('/api/events', eventsRouter);
app.use('/api/polls', pollsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/mentions', mentionsRouter);
app.use('/api/memos', memosRouter);
app.use('/api/link-preview', linkPreviewRouter());
app.use('/api/folders', foldersRouter);
app.use('/api/org-groups', orgGroupsRouter);
app.use('/api/settings', settingsRouter);
// 기존 경로도 유지 (하위 호환)
app.use('/auth', authRouter);
app.use('/users', usersRouter);
app.use('/rooms', roomsRouter);
app.use('/org', orgRouter);
app.use('/files', filesRouter);
app.use('/announcement', announcementRouter);
app.use('/events', eventsRouter);
app.use('/polls', pollsRouter);
app.use('/projects', projectsRouter);
app.use('/bookmarks', bookmarksRouter);
app.use('/mentions', mentionsRouter);
app.use('/memos', memosRouter);
app.use('/link-preview', linkPreviewRouter());
app.use('/folders', foldersRouter);
app.use('/org-groups', orgGroupsRouter);
app.use('/settings', settingsRouter);
// Disable public uploads to enforce auth/expiry checks via /files/download
// app.use('/uploads', express.static(UPLOAD_DIR));

// Health check
app.get('/health', (_, res) => res.json({ ok: true }));
app.get('/health/avatar', (_, res) => res.json({ ok: true }));
app.get('/health/db', async (_, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.json({ ok: true, db: 'connected' });
  } catch (e) {
    // 인증 없이 열려 있는 엔드포인트라 드라이버 원본 에러(내부 DB 진단 정보)는
    // 서버 로그에만 남기고, 응답에는 상태만 내려준다.
    console.error('[health/db]', e);
    return res.status(503).json({ ok: false, db: 'disconnected' });
  }
});
app.get('/health/ldap', async (_, res) => {
  // 인증 없이 열려 있는 엔드포인트이므로 내부 LDAP 서버 주소/검색 base DN 같은
  // 토폴로지 정보는 내려주지 않고 연결 상태만 알려준다.
  const result = await checkLdapConnection();
  return res.status(result.ok ? 200 : 503).json({ ok: result.ok, enabled: result.enabled, bound: result.bound });
});

// API 안내 (예전처럼 "이 주소는 API 서버입니다" 화면이 필요할 때)
app.get('/api-info', (_, res) => {
  res.type('html').send(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>TPA-Korea API</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem;">
  <h1>TPA-Korea 메신저 API</h1>
  <p>이 주소는 <strong>API 서버</strong>입니다. 채팅·로그인은 <strong>TPA-Korea 데스크톱 앱</strong> 또는 브라우저에서 <a href="/">/</a> 로 접속해 주세요.</p>
  <p><a href="/health">/health</a> — 서버 상태 확인</p>
</body>
</html>
  `);
});

// 배포 확인용 (브라우저에서 이 주소 열어서 클라이언트 서빙 여부 확인 가능)
app.get('/debug-client', (_, res) => {
  const hasIndex = fs.existsSync(clientIndexPath);
  const hasAssets = fs.existsSync(path.join(clientDist, 'assets'));
  res.json({ ok: true, clientServed: hasIndex, hasAssets });
});

// API 404: 매칭되지 않은 API 경로는 JSON으로 응답 (클라이언트가 에러 메시지 파싱 가능)
const API_PREFIXES = ['/auth', '/users', '/rooms', '/org', '/files', '/announcement', '/events', '/polls', '/projects', '/bookmarks', '/mentions', '/memos', '/link-preview', '/folders', '/settings', '/api'];
app.use((req, res, next) => {
  if (API_PREFIXES.some((p) => req.path.startsWith(p))) {
    return res.status(404).json({ error: '요청한 API 경로를 찾을 수 없습니다. 서버를 최신 버전으로 업데이트해 주세요.' });
  }
  next();
});

// 웹 클라이언트(SPA) 서빙: client-dist에 index.html이 있으면 정적 파일 + SPA 폴백
const clientDist = process.env.CLIENT_DIST || path.join(__dirname, '..', 'client-dist');
const clientIndexPath = path.join(clientDist, 'index.html');
if (fs.existsSync(clientIndexPath)) {
  app.use(express.static(clientDist, { index: false }));
  // 확장자 있는 요청(asset)은 static에서 처리, 나머지만 SPA index.html
  app.get('*', (req, res) => {
    if (path.extname(req.path)) return res.status(404).send('Not found');
    res.sendFile(clientIndexPath);
  });
} else {
  app.get('/', (_, res) => {
    res.type('html').send(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>TPA-Korea</title></head>
<body style="font-family:sans-serif;max-width:560px;margin:2rem auto;padding:0 1rem;">
  <h1>TPA-Korea 메신저 API</h1>
  <p>이 주소는 <strong>API 서버</strong>입니다. 채팅·로그인은 <strong>TPA-Korea 데스크톱 앱</strong>으로 접속해 주세요.</p>
  <p><a href="/health">/health</a> — 서버 상태 확인</p>
</body>
</html>
    `);
  });
}

const PORT = process.env.PORT || 3001;

// API 요청은 항상 JSON 에러 응답 (HTML "Internal Server Error" 방지)
app.use((err, req, res, _next) => {
  console.error('Express error:', err);
  const status = err.code === 'LIMIT_FILE_SIZE' ? 400 : (err.status || 500);
  const message = err.code === 'LIMIT_FILE_SIZE' ? '파일이 너무 큽니다 (최대 10MB)' : (err.message || '서버 오류가 발생했습니다.');
  res.status(status).json({ error: message });
});

// Socket.io with CORS for Electron
const io = new Server(httpServer, {
  cors: { origin: true },
  path: '/socket.io',
});

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('auth required'));
  const payload = await verifySessionToken(token);
  if (!payload) return next(new Error('invalid token'));
  socket.userId = payload.userId;
  socket.sessionId = payload.sessionId;
  const rawDevice = socket.handshake.auth?.device ?? socket.handshake.query?.device;
  socket.device = rawDevice === 'mobile' ? 'mobile' : 'desktop';
  next();
});

registerSocketHandlers(io);
app.set('io', io);

async function runMigrations() {
  // isTopic 컬럼이 추가되기 전에 생성된 아젠다 방들을 보정:
  // 1) viewMode='board' 인 방 (아젠다 전용 뷰)
  // 2) "아젠다를 만들었습니다" 시스템 메시지가 있는 방
  try {
    const result = await prisma.$executeRaw`
      UPDATE "Room"
      SET "isTopic" = true
      WHERE "isGroup" = true
        AND "isTopic" = false
        AND (
          "viewMode" = 'board'
          OR id IN (
            SELECT DISTINCT "roomId"
            FROM "Message"
            WHERE content LIKE '%아젠다를 만들었습니다%'
          )
        )
    `;
    if (result > 0) {
      console.log(`[migration] isTopic 보정: ${result}개 방을 아젠다로 복구했습니다.`);
    }
  } catch (e) {
    console.warn('[migration] isTopic 보정 실패 (무시):', e?.message);
  }
}

async function main() {
  await prisma.$connect();
  await runMigrations();
  startCleanupJob();
  const host = process.env.HOST || '0.0.0.0';
  httpServer.listen(PORT, host, () => {
    console.log(`Server running at http://${host}:${PORT}`);
    console.log(`[startup] LDAP: ${isLdapEnabled() ? 'enabled' : 'disabled'}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
