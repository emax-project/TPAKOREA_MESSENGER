import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessageId, isUniqueViolation } from './clientMessageId.js';

test('키가 없으면 허용(null)', () => {
  for (const v of [undefined, null, '']) assert.deepEqual(parseClientMessageId(v), { ok: true, value: null });
});

test('UUID·영숫자 키 허용', () => {
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.deepEqual(parseClientMessageId(uuid), { ok: true, value: uuid });
  assert.equal(parseClientMessageId('abcdEFGH_12-34').ok, true);
});

test('형식이 틀리면 거부', () => {
  for (const v of ['short', 'a'.repeat(65), 'has space 12345', '한글키한글키한글키', 12345678, {}, ['abcdefgh']]) {
    assert.equal(parseClientMessageId(v).ok, false, String(v));
  }
});

test('고유 제약 위반 판별', () => {
  assert.equal(isUniqueViolation({ code: 'P2002' }), true);
  assert.equal(isUniqueViolation({ code: 'P2025' }), false);
  assert.equal(isUniqueViolation(null), false);
});
