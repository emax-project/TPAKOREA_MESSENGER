import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { prisma } from '../db.js';
import { authMiddleware } from '../auth.js';
import { policyUpload, recordFileAudit, UPLOAD_DIR } from '../upload.js';
import { fileUploadLimiter } from '../lib/authRateLimit.js';
import { getSecurityPolicy } from '../lib/securityPolicy.js';

export const filesRouter = Router();

filesRouter.use(authMiddleware);

// BigInt → Number 변환 (JSON 직렬화용)
function toJson(obj) {
  return JSON.parse(JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  ));
}

const FILE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000; // 10분

// POST /files/upload — Upload a file and create a file message
filesRouter.post('/upload', fileUploadLimiter, (req, res, next) => {
  req.setTimeout(FILE_UPLOAD_TIMEOUT_MS);
  res.setTimeout(FILE_UPLOAD_TIMEOUT_MS);
  next();
}, policyUpload('file'), async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'roomId is required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const member = await prisma.roomMember.findFirst({
      where: { roomId, userId: req.userId },
    });
    if (!member) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Not a member of this room' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf-8');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const userContent = req.body.content?.trim();

    const message = await prisma.message.create({
      data: {
        roomId,
        senderId: req.userId,
        content: userContent || `[파일] ${originalName}`,
        fileUrl,
        fileName: originalName,
        fileSize: BigInt(req.file.size),
        fileMimeType: req.file.mimetype,
        fileExpiresAt: expiresAt,
      },
      include: {
        sender: { select: { id: true, name: true, email: true } },
      },
    });

    await prisma.room.update({
      where: { id: roomId },
      data: { updatedAt: now },
    });
    await prisma.roomMember.updateMany({
      where: { roomId, userId: req.userId },
      data: { lastReadAt: now },
    });

    void recordFileAudit({
      userId: req.userId,
      roomId,
      fileName: originalName,
      fileSize: req.file.size,
      allowed: true,
    });

    const jsonMessage = toJson(message);
    const io = req.app.get('io');
    if (io) {
      io.to(roomId).emit('message', { ...jsonMessage, readCount: 0 });
    }

    return res.status(201).json(jsonMessage);
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error(err);
    return res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /files/download/:messageId — Download a file by message ID
filesRouter.get('/download/:messageId', async (req, res) => {
  try {
    const message = await prisma.message.findUnique({
      where: { id: req.params.messageId },
    });

    if (!message || !message.fileUrl) {
      return res.status(404).json({ error: 'File not found' });
    }

    const member = await prisma.roomMember.findFirst({
      where: { roomId: message.roomId, userId: req.userId, leftAt: null },
    });
    if (!member) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (message.fileExpiresAt && new Date() > message.fileExpiresAt) {
      return res.status(410).json({ error: 'File has expired' });
    }

    // 관리자가 내려받기를 막아 둔 경우(앱 우회 방지를 위해 서버에서 강제)
    if (!(await getSecurityPolicy()).fileTransfer.downloadEnabled) {
      void recordFileAudit({
        userId: req.userId,
        roomId: message.roomId,
        fileName: message.fileName || path.basename(message.fileUrl),
        fileSize: message.fileSize ?? 0,
        allowed: false,
        reason: 'FILE_DOWNLOAD_DISABLED',
      });
      return res.status(403).json({ error: '파일 내려받기가 관리자에 의해 제한되어 있습니다', code: 'FILE_DOWNLOAD_DISABLED' });
    }

    const filename = path.basename(message.fileUrl);
    const filePath = path.join(UPLOAD_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File no longer exists on disk' });
    }

    const downloadName = message.fileName || filename;
    // RFC 5987: 한글 등 UTF-8 파일명이 깨지지 않도록 filename*=UTF-8'' 사용
    const asciiFallback = /^[\x20-\x7e]*$/.test(downloadName) ? downloadName : 'download';
    const encoded = encodeURIComponent(downloadName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`
    );
    if (message.fileMimeType) {
      res.setHeader('Content-Type', message.fileMimeType);
    }
    // 업로드 시 클라이언트가 보낸 Content-Type을 그대로 신뢰해 반영하므로,
    // 브라우저가 이를 실행 가능한 콘텐츠로 스니핑하지 않도록 명시적으로 막는다.
    // (Content-Disposition: attachment와 함께 저장형 XSS 경로를 이중으로 차단)
    res.setHeader('X-Content-Type-Options', 'nosniff');

    return res.sendFile(filePath);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Download failed' });
  }
});
