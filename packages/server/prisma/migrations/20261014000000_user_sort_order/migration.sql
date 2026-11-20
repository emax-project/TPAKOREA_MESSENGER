-- 부서 내 임직원 정렬 순서
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "User_departmentId_sortOrder_idx" ON "User"("departmentId", "sortOrder");
