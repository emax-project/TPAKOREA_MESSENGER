-- 2차 인증(TOTP) 필드
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpLastStep" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totpRecoveryCodes" TEXT;

-- 파일 전송 통제 감사 로그
CREATE TABLE IF NOT EXISTS "FileTransferAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL DEFAULT 0,
    "allowed" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileTransferAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "FileTransferAudit_createdAt_idx" ON "FileTransferAudit"("createdAt");
CREATE INDEX IF NOT EXISTS "FileTransferAudit_userId_createdAt_idx" ON "FileTransferAudit"("userId", "createdAt");
