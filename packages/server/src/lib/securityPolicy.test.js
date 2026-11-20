import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret';
process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:1/x';

const { DEFAULT_POLICY, mergePolicy, evaluateFile, normalizeExtension } = await import('./securityPolicy.js');

test('normalizeExtension: 점 보정·소문자·형식 검증', () => {
  assert.equal(normalizeExtension('ZIP'), '.zip');
  assert.equal(normalizeExtension('.Pdf'), '.pdf');
  assert.equal(normalizeExtension(''), '');
  assert.equal(normalizeExtension('a/b'), '');
  assert.equal(normalizeExtension('..x'), '');
});

test('mergePolicy: 일부만 바꾸고 나머지는 유지', () => {
  const next = mergePolicy(DEFAULT_POLICY, { screenLockMinutes: 5, fileTransfer: { maxSizeMB: 100 } });
  assert.equal(next.screenLockMinutes, 5);
  assert.equal(next.fileTransfer.maxSizeMB, 100);
  assert.equal(next.twoFactor, 'optional');
  assert.deepEqual(next.fileTransfer.blockedExtensions, DEFAULT_POLICY.fileTransfer.blockedExtensions);
});

test('mergePolicy: 잘못된 값은 error', () => {
  assert.ok(mergePolicy(DEFAULT_POLICY, { screenLockMinutes: -1 }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { screenLockMinutes: 1.5 }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { screenLockMinutes: 99999 }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { twoFactor: 'maybe' }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { fileTransfer: { maxSizeMB: 0 } }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { fileTransfer: { maxSizeMB: 5000 } }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { fileTransfer: { blockedExtensions: ['ok', 'bad/ext'] } }).error);
});

test('mergePolicy: 확장자는 정규화·중복 제거', () => {
  const next = mergePolicy(DEFAULT_POLICY, { fileTransfer: { blockedExtensions: ['ZIP', '.zip', 'iso'] } });
  assert.deepEqual(next.fileTransfer.blockedExtensions, ['.zip', '.iso']);
});

test('evaluateFile: 기본 정책', () => {
  assert.equal(evaluateFile({ name: '보고서.pdf', size: 1000 }, DEFAULT_POLICY), null);
  assert.equal(evaluateFile({ name: 'a.EXE', size: 1 }, DEFAULT_POLICY).code, 'FILE_TYPE_BLOCKED');
  assert.equal(evaluateFile({ name: 'a.ps1', size: 1 }, DEFAULT_POLICY).code, 'FILE_TYPE_BLOCKED');
  assert.equal(evaluateFile({ name: 'noext', size: 1 }, DEFAULT_POLICY), null);
});

test('evaluateFile: 이중 확장자는 마지막 확장자로 판단', () => {
  assert.equal(evaluateFile({ name: 'invoice.pdf.exe', size: 1 }, DEFAULT_POLICY).code, 'FILE_TYPE_BLOCKED');
  assert.equal(evaluateFile({ name: 'invoice.exe.pdf', size: 1 }, DEFAULT_POLICY), null);
});

test('evaluateFile: 크기 제한', () => {
  const policy = mergePolicy(DEFAULT_POLICY, { fileTransfer: { maxSizeMB: 10 } });
  assert.equal(evaluateFile({ name: 'a.pdf', size: 10 * 1024 * 1024 }, policy), null);
  assert.equal(evaluateFile({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 }, policy).code, 'FILE_TOO_LARGE');
});

test('evaluateFile: 허용 목록 모드에서는 목록 밖 확장자 거부, 필수 차단은 허용 목록에 있어도 거부', () => {
  const policy = mergePolicy(DEFAULT_POLICY, { fileTransfer: { allowedExtensions: ['.pdf', '.exe'] } });
  assert.equal(evaluateFile({ name: 'a.pdf', size: 1 }, policy), null);
  assert.equal(evaluateFile({ name: 'a.png', size: 1 }, policy).code, 'FILE_TYPE_NOT_ALLOWED');
  assert.equal(evaluateFile({ name: 'a.exe', size: 1 }, policy).code, 'FILE_TYPE_BLOCKED');
});

test('evaluateFile: 전송 전체 비활성화', () => {
  const policy = mergePolicy(DEFAULT_POLICY, { fileTransfer: { enabled: false } });
  assert.equal(evaluateFile({ name: 'a.pdf', size: 1 }, policy).code, 'FILE_TRANSFER_DISABLED');
});

test('mergePolicy: 다운로드 허용 여부와 대화창 수 제한', () => {
  assert.equal(DEFAULT_POLICY.fileTransfer.downloadEnabled, true);
  assert.equal(DEFAULT_POLICY.maxChatWindows, 0);
  const next = mergePolicy(DEFAULT_POLICY, { maxChatWindows: 5, fileTransfer: { downloadEnabled: false } });
  assert.equal(next.maxChatWindows, 5);
  assert.equal(next.fileTransfer.downloadEnabled, false);
  assert.equal(next.fileTransfer.enabled, true); // 업로드 허용은 그대로
  assert.ok(mergePolicy(DEFAULT_POLICY, { maxChatWindows: -1 }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { maxChatWindows: 21 }).error);
  assert.ok(mergePolicy(DEFAULT_POLICY, { maxChatWindows: 2.5 }).error);
});
