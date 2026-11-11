-- prisma db push 전에 실행한다(Dockerfile CMD).
-- db push는 유니크 제약 추가를 "데이터 손실 가능" 경고로 보고 --accept-data-loss 없이는
-- 실패하므로(서버가 뜨지 못함), 새 컬럼에 대한 유니크 인덱스를 여기서 먼저 만들어 둔다.
-- 모두 IF NOT EXISTS라 몇 번 실행해도 안전하고, 테이블이 아직 없는 새 DB에서는 건너뛴다.
DO $$
BEGIN
  IF to_regclass('"Message"') IS NOT NULL THEN
    ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS "Message_senderId_clientMessageId_key" ON "Message"("senderId", "clientMessageId");
  END IF;
END $$;
