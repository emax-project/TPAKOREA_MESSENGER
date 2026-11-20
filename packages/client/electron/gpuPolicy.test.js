const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CRASH_WINDOW_MS,
  emptyState,
  normalizeState,
  decideGpu,
  recordGpuExit,
  setUserForceDisable,
} = require('./gpuPolicy');

const NOW = 1_800_000_000_000;

test('기본은 GPU 가속 사용', () => {
  assert.deepEqual(decideGpu({ state: emptyState(), now: NOW }), { disable: false, reason: null });
});

test('환경변수·실행 인자·사용자 설정으로 끌 수 있다', () => {
  assert.equal(decideGpu({ state: emptyState(), env: { EMAX_DISABLE_GPU: '1' }, now: NOW }).reason, 'env');
  assert.equal(decideGpu({ state: emptyState(), argv: ['--disable-gpu'], now: NOW }).reason, 'argv');
  assert.equal(decideGpu({ state: { ...emptyState(), forceDisable: true }, now: NOW }).reason, 'user-setting');
});

test('GPU 비정상 종료 1회로는 끄지 않고, 7일 안에 2회면 끈다', () => {
  let s = recordGpuExit(emptyState(), { type: 'GPU', reason: 'crashed' }, NOW);
  assert.equal(decideGpu({ state: s, now: NOW + 1000 }).disable, false);
  s = recordGpuExit(s, { type: 'GPU', reason: 'launch-failed' }, NOW + 5000);
  assert.deepEqual(decideGpu({ state: s, now: NOW + 6000 }), { disable: true, reason: 'repeated-gpu-crash' });
});

test('오래된 크래시 기록은 세지 않는다', () => {
  let s = recordGpuExit(emptyState(), { type: 'GPU', reason: 'crashed' }, NOW);
  s = recordGpuExit(s, { type: 'GPU', reason: 'crashed' }, NOW + 1000);
  assert.equal(decideGpu({ state: s, now: NOW + CRASH_WINDOW_MS + 5000 }).disable, false);
});

test('정상 종료와 GPU가 아닌 프로세스는 크래시가 아니다', () => {
  const s = emptyState();
  assert.equal(recordGpuExit(s, { type: 'GPU', reason: 'clean-exit' }, NOW), s);
  assert.equal(recordGpuExit(s, { type: 'GPU', reason: 'killed' }, NOW), s);
  assert.equal(recordGpuExit(s, { type: 'Utility', reason: 'crashed' }, NOW), s);
  assert.equal(recordGpuExit(s, null, NOW), s);
});

test('사용자가 다시 켜면 크래시 기록을 비운다', () => {
  let s = recordGpuExit(emptyState(), { type: 'GPU', reason: 'crashed' }, NOW);
  s = recordGpuExit(s, { type: 'GPU', reason: 'crashed' }, NOW + 1);
  s = setUserForceDisable(s, false);
  assert.equal(decideGpu({ state: s, now: NOW + 2 }).disable, false);
  assert.equal(setUserForceDisable(s, true).forceDisable, true);
});

test('깨진 상태 파일도 안전하게 정규화', () => {
  assert.deepEqual(normalizeState(null), emptyState());
  assert.deepEqual(normalizeState('x'), emptyState());
  const s = normalizeState({ forceDisable: 'yes', crashes: [{ at: 'a' }, { at: 5, reason: 'r' }, null] });
  assert.equal(s.forceDisable, false);
  assert.deepEqual(s.crashes, [{ at: 5, reason: 'r' }]);
});
