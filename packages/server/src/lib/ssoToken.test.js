import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSsoToken,
  hashSsoToken,
  sharedKeyMatches,
  emailLocalPart,
  normalizeSsoPath,
  SSO_DEFAULT_PATH,
} from './ssoToken.js';

describe('ssoToken', () => {
  it('generates unique url-safe tokens and hashes deterministically', () => {
    const a = generateSsoToken();
    const b = generateSsoToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hashSsoToken(a), hashSsoToken(a));
    assert.notEqual(hashSsoToken(a), hashSsoToken(b));
    assert.notEqual(hashSsoToken(a), a);
  });

  it('compares shared keys safely and rejects empty values', () => {
    assert.equal(sharedKeyMatches('secret', 'secret'), true);
    assert.equal(sharedKeyMatches('secret', 'Secret'), false);
    assert.equal(sharedKeyMatches('', ''), false);
    assert.equal(sharedKeyMatches(undefined, 'secret'), false);
    assert.equal(sharedKeyMatches('secret', undefined), false);
  });

  it('extracts the local part of an email', () => {
    assert.equal(emailLocalPart('hong@csin.kr'), 'hong');
    assert.equal(emailLocalPart('plain'), 'plain');
    assert.equal(emailLocalPart(''), '');
  });

  it('accepts only in-site sso paths', () => {
    assert.deepEqual(normalizeSsoPath(''), { path: SSO_DEFAULT_PATH });
    assert.deepEqual(normalizeSsoPath('/sso'), { path: '/sso' });
    assert.deepEqual(normalizeSsoPath(' /gw/sso.do '), { path: '/gw/sso.do' });
    for (const bad of ['sso', '//evil.com', 'https://evil.com/sso', '/a/../b', '/sso?x=1', '/한글', `/${'a'.repeat(201)}`]) {
      assert.ok(normalizeSsoPath(bad).error, `should reject ${bad}`);
    }
  });
});
