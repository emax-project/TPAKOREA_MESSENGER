-- 메시지 전송 고유 키(멱등 키): 재전송돼도 같은 (보낸 사람, 키)는 한 번만 저장한다.
-- NULL은 서로 다른 값으로 취급되므로 키를 보내지 않는 기존 클라이언트·기존 메시지에는 영향이 없다.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Message_senderId_clientMessageId_key" ON "Message"("senderId", "clientMessageId");
