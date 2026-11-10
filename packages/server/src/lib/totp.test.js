import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret';

const {
  base32Encode,
  base32Decode,
  generateCode,
  verifyCode,
  currentStep,
  encryptSecret,
  decryptSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  buildOtpauthUrl,
} = await import('./totp.js');

// RFC 6238 부록 B 테스트 벡터 (SHA-1, 비밀키 "12345678901234567890") — 뒤 6자리
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('base32 왕복 변환', () => {
  const buf = Buffer.from('hello world');
  assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  assert.throws(() => base32Decode('!!!'));
});

test('RFC 6238 테스트 벡터와 일치한다', () => {
  assert.equal(generateCode(RFC_SECRET, 59 * 1000), '287082');
  assert.equal(generateCode(RFC_SECRET, 1111111109 * 1000), '081804');
  assert.equal(generateCode(RFC_SECRET, 2000000000 * 1000), '279037');
});

test('verifyCode: 현재 코드는 통과하고 틀린 코드·형식 오류는 거부한다', () => {
  const now = 1111111109 * 1000;
  assert.equal(verifyCode(RFC_SECRET, '081804', { nowMs: now }), currentStep(now));
  assert.equal(verifyCode(RFC_SECRET, '000000', { nowMs: now }), null);
  assert.equal(verifyCode(RFC_SECRET, 'abcdef', { nowMs: now }), null);
  assert.equal(verifyCode(RFC_SECRET, '', { nowMs: now }), null);
});

test('verifyCode: ±1 step 오차는 허용하고 그 밖은 거부한다', () => {
  const now = 1111111109 * 1000;
  const prev = generateCode(RFC_SECRET, now - 30_000);
  const old = generateCode(RFC_SECRET, now - 90_000);
  assert.notEqual(verifyCode(RFC_SECRET, prev, { nowMs: now }), null);
  assert.equal(verifyCode(RFC_SECRET, old, { nowMs: now }), null);
});

test('verifyCode: 이미 쓴 step은 재사용할 수 없다(replay 방지)', () => {
  const now = 1111111109 * 1000;
  const step = verifyCode(RFC_SECRET, '081804', { nowMs: now });
  assert.equal(verifyCode(RFC_SECRET, '081804', { nowMs: now, lastUsedStep: step }), null);
});

test('비밀키 암호화 왕복, 변조 시 실패', () => {
  const enc = encryptSecret('ABCDEF234567');
  assert.notEqual(enc, 'ABCDEF234567');
  assert.equal(decryptSecret(enc), 'ABCDEF234567');
  const tampered = enc.slice(0, -3) + 'AAA';
  assert.throws(() => decryptSecret(tampered));
});

test('복구 코드: 8개 생성, 1회만 사용 가능, 대소문자·하이픈 무관', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.equal(new Set(codes).size, 8);
  const hashes = codes.map(hashRecoveryCode);
  const after = consumeRecoveryCode(hashes, codes[0].toUpperCase().replace('-', ' '));
  assert.equal(after.length, 7);
  assert.equal(consumeRecoveryCode(after, codes[0]), null);
  assert.equal(consumeRecoveryCode(hashes, 'zzzzz-zzzzz'), null);
});

test('otpauth URL 형식', () => {
  const url = buildOtpauthUrl({ secret: 'ABC', account: 'a@b.com', issuer: 'CSIN-Tech' });
  assert.match(url, /^otpauth:\/\/totp\/CSIN-Tech:a%40b\.com\?/);
  assert.match(url, /secret=ABC/);
  assert.match(url, /issuer=CSIN-Tech/);
});
