/**
 * 2차 인증(TOTP, RFC 6238) 유틸 — 외부 의존성 없이 node:crypto만 사용한다.
 * 구글/MS Authenticator, Authy 등 표준 인증 앱과 호환된다(SHA-1, 6자리, 30초).
 */
import crypto from 'node:crypto';

const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error('INVALID_BASE32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 20바이트(160비트) 무작위 비밀키를 base32 문자열로 만든다. */
export function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuf, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function currentStep(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

export function generateCode(secret, nowMs = Date.now()) {
  return hotp(base32Decode(secret), currentStep(nowMs));
}

/**
 * 코드를 검증하고 일치한 time-step을 돌려준다(없으면 null).
 * 시계 오차를 감안해 앞뒤 1 step(±30초)까지 허용한다.
 * lastUsedStep 이하의 step은 거부해 같은 코드를 재사용(replay)하지 못하게 한다.
 */
export function verifyCode(secret, code, { nowMs = Date.now(), lastUsedStep = null, window = 1 } = {}) {
  const input = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(input)) return null;
  let secretBuf;
  try {
    secretBuf = base32Decode(secret);
  } catch {
    return null;
  }
  const step = currentStep(nowMs);
  const inputBuf = Buffer.from(input);
  let matched = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const candidate = step + delta;
    if (lastUsedStep != null && candidate <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secretBuf, candidate));
    if (crypto.timingSafeEqual(expected, inputBuf)) matched = candidate;
  }
  return matched;
}

export function buildOtpauthUrl({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ───── 비밀키 암호화(DB에 평문 저장 방지) ─────
// AES-256-GCM, 키는 MFA_ENC_KEY(없으면 JWT_SECRET)에서 scrypt로 파생한다.
// (단순 sha256은 비밀번호 해시로는 연산 비용이 너무 낮아 무차별 대입에 약하다)
const KDF_SALT = 'csin-tech:mfa-secret:v1';
let cachedKey = null; // { material, key } — scrypt는 일부러 느리므로 한 번만 계산해 재사용한다

function encKey() {
  const material = process.env.MFA_ENC_KEY || process.env.JWT_SECRET;
  if (!material) throw new Error('MFA_ENC_KEY or JWT_SECRET is required');
  if (cachedKey?.material !== material) {
    cachedKey = { material, key: crypto.scryptSync(material, KDF_SALT, 32) };
  }
  return cachedKey.key;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(payload) {
  const [ver, iv, tag, data] = String(payload || '').split('.');
  if (ver !== 'v1' || !iv || !tag || !data) throw new Error('INVALID_SECRET_PAYLOAD');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// ───── 복구 코드 ─────
const RECOVERY_COUNT = 8;

export function generateRecoveryCodes() {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const raw = crypto.randomBytes(5).toString('hex'); // 10자리 hex
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

function normalizeRecovery(code) {
  return String(code || '').toLowerCase().replace(/[^0-9a-f]/g, '');
}

export function hashRecoveryCode(code) {
  return crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');
}

/** 해시 목록에서 입력 코드를 찾아 소진 처리한 새 목록을 돌려준다. 없으면 null. */
export function consumeRecoveryCode(hashes, code) {
  const target = hashRecoveryCode(code);
  if (normalizeRecovery(code).length !== 10) return null;
  const idx = hashes.indexOf(target);
  if (idx === -1) return null;
  return hashes.filter((_, i) => i !== idx);
}
