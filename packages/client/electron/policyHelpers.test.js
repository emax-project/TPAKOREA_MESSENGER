const test = require('node:test');
const assert = require('node:assert/strict');
const { maskNotificationIfLocked, canOpenChatWindow, sanitizeMaxChatWindows, pickStaleUpdaterFiles } = require('./policyHelpers');

test('잠금 중에는 알림의 제목·본문·이미지를 가린다', () => {
  const p = { title: '홍길동', body: '비밀 내용', roomId: 'r1', icon: 'data:x', imagePreview: 'data:y' };
  const masked = maskNotificationIfLocked(p, true);
  assert.equal(masked.title, 'CSIN-Tech');
  assert.ok(!JSON.stringify(masked).includes('홍길동'));
  assert.ok(!JSON.stringify(masked).includes('비밀'));
  assert.equal(masked.icon, null);
  assert.equal(masked.imagePreview, null);
  assert.equal(masked.roomId, 'r1');
});

test('잠금이 아니면 알림을 그대로 둔다', () => {
  const p = { title: 'a', body: 'b', roomId: null, icon: null, imagePreview: null };
  assert.equal(maskNotificationIfLocked(p, false), p);
});

test('대화창 수 제한: 0은 무제한, 한도에 도달하면 더 못 연다', () => {
  assert.equal(canOpenChatWindow(99, 0), true);
  assert.equal(canOpenChatWindow(99, undefined), true);
  assert.equal(canOpenChatWindow(2, 3), true);
  assert.equal(canOpenChatWindow(3, 3), false);
  assert.equal(canOpenChatWindow(5, 3), false);
});

test('대화창 수 값 정리', () => {
  assert.equal(sanitizeMaxChatWindows(5), 5);
  assert.equal(sanitizeMaxChatWindows('7'), 7);
  for (const bad of [-1, 21, 1.5, 'x', null, undefined]) assert.equal(sanitizeMaxChatWindows(bad), 0);
});

test('pending 정리: 최신 설치 파일 1개는 남기고 나머지·미완성 파일을 고른다', () => {
  const files = [
    { name: 'CSIN-Tech-Setup-1.2.90.exe', mtimeMs: 100 },
    { name: 'CSIN-Tech-Setup-1.2.94.exe', mtimeMs: 300 },
    { name: 'CSIN-Tech-Setup-1.2.92.exe', mtimeMs: 200 },
    { name: 'download.tmp', mtimeMs: 400 },
    { name: 'update-info.json', mtimeMs: 50 },
  ];
  assert.deepEqual(pickStaleUpdaterFiles(files).sort(), ['CSIN-Tech-Setup-1.2.90.exe', 'CSIN-Tech-Setup-1.2.92.exe', 'download.tmp'].sort());
  assert.deepEqual(pickStaleUpdaterFiles([{ name: 'only.exe', mtimeMs: 1 }]), []);
  assert.deepEqual(pickStaleUpdaterFiles([]), []);
});
