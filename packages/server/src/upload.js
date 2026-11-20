import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { prisma } from './db.js';
import { evaluateFile, getSecurityPolicy } from './lib/securityPolicy.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB

const AVATAR_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
function avatarFileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!AVATAR_EXTENSIONS.includes(ext)) {
    return cb(new Error('이미지 파일만 업로드할 수 있습니다 (jpg, png, gif, webp)'), false);
  }
  cb(null, true);
}

export const avatarUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: avatarFileFilter,
});


// ───── 파일 전송 통제 정책 (채팅 파일 업로드 전용) ─────

const POLICY_STATUS = {
  FILE_TRANSFER_DISABLED: 403,
  FILE_TYPE_BLOCKED: 400,
  FILE_TYPE_NOT_ALLOWED: 400,
  FILE_TOO_LARGE: 413,
};

function decodeName(raw) {
  // multer는 multipart 파일명을 latin1로 읽는다 — files.js와 동일하게 UTF-8로 복원
  return Buffer.from(String(raw || ''), 'latin1').toString('utf-8');
}

/** 감사 로그 기록. 로그 실패가 업로드 자체를 막으면 안 되므로 예외는 삼킨다. */
export async function recordFileAudit({ userId, roomId, fileName, fileSize, allowed, reason }) {
  try {
    await prisma.fileTransferAudit.create({
      data: {
        userId: String(userId),
        roomId: roomId ? String(roomId) : null,
        fileName: String(fileName || '').slice(0, 255),
        fileSize: BigInt(Math.max(0, Math.floor(Number(fileSize) || 0))),
        allowed: !!allowed,
        reason: reason || null,
      },
    });
  } catch (err) {
    console.error('[file-audit] 기록 실패:', err?.message || err);
  }
}

/**
 * 관리자 정책(전송 허용 여부·최대 크기·확장자 차단/허용)을 적용하는 업로드 미들웨어.
 * 정책은 요청마다(짧은 캐시) 읽어 multer 인스턴스를 만들므로 설정을 바꾸면 곧바로 반영된다.
 * 차단되면 JSON { error, code }로 응답하고 감사 로그를 남긴다.
 */
export function policyUpload(fieldName) {
  return async (req, res, next) => {
    let policy;
    try {
      policy = await getSecurityPolicy();
    } catch (err) {
      return next(err);
    }

    let denied = null;
    const deniedFile = { name: '', size: 0 };
    const uploader = multer({
      storage,
      limits: { fileSize: Math.min(MAX_FILE_SIZE, policy.fileTransfer.maxSizeMB * 1024 * 1024) },
      fileFilter: (_req, file, cb) => {
        const name = decodeName(file.originalname);
        // 크기는 이 시점에 알 수 없으므로 확장자·전송 허용 여부만 먼저 본다(크기는 limits가 강제)
        const verdict = evaluateFile({ name, size: 0 }, policy);
        if (verdict) {
          denied = verdict;
          deniedFile.name = name;
          return cb(null, false);
        }
        cb(null, true);
      },
    }).single(fieldName);

    uploader(req, res, async (err) => {
      const audit = (verdict, name, size) =>
        recordFileAudit({
          userId: req.userId,
          roomId: req.body?.roomId,
          fileName: name,
          fileSize: size,
          allowed: false,
          reason: verdict.code,
        });

      if (denied) {
        await audit(denied, deniedFile.name, Number(req.headers['content-length']) || 0);
        return res.status(POLICY_STATUS[denied.code] || 400).json({ error: denied.message, code: denied.code });
      }
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          const verdict = { code: 'FILE_TOO_LARGE', message: `파일 크기는 ${policy.fileTransfer.maxSizeMB}MB 이하여야 합니다` };
          await audit(verdict, '(크기 초과)', Number(req.headers['content-length']) || 0);
          return res.status(413).json({ error: verdict.message, code: verdict.code });
        }
        return next(err);
      }
      next();
    });
  };
}
