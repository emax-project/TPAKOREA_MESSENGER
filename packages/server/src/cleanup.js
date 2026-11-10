import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { prisma } from './db.js';
import { UPLOAD_DIR } from './upload.js';

const FILE_AUDIT_RETENTION_DAYS = 180;

export function startCleanupJob() {
  // 파일 전송 감사 로그는 180일만 보관한다 (매일 03:10)
  cron.schedule('10 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - FILE_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
      const { count } = await prisma.fileTransferAudit.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (count > 0) console.log(`[cleanup] 파일 전송 감사 로그 ${count}건 삭제`);
    } catch (err) {
      console.error('[cleanup] 감사 로그 정리 실패:', err);
    }
  });

  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log('[cleanup] Starting expired file cleanup...');
    try {
      const now = new Date();

      const expiredMessages = await prisma.message.findMany({
        where: {
          fileExpiresAt: { lte: now },
          fileUrl: { not: null },
        },
        select: { id: true, fileUrl: true },
      });

      if (expiredMessages.length === 0) {
        console.log('[cleanup] No expired files found.');
        return;
      }

      console.log(`[cleanup] Found ${expiredMessages.length} expired file(s).`);

      for (const msg of expiredMessages) {
        if (msg.fileUrl) {
          const filename = path.basename(msg.fileUrl);
          const filePath = path.join(UPLOAD_DIR, filename);
          try {
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`[cleanup] Deleted file: ${filename}`);
            }
          } catch (fsErr) {
            console.error(`[cleanup] Failed to delete file ${filename}:`, fsErr.message);
          }
        }

        await prisma.message.update({
          where: { id: msg.id },
          data: {
            fileUrl: null,
            fileName: null,
            fileSize: null,
            fileMimeType: null,
            fileExpiresAt: null,
            content: '[파일 만료됨]',
          },
        });
      }

      console.log(`[cleanup] Cleanup complete. Processed ${expiredMessages.length} message(s).`);
    } catch (err) {
      console.error('[cleanup] Error during cleanup:', err);
    }
  });

  console.log('[cleanup] File cleanup job scheduled (every hour).');
}
