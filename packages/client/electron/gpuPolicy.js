/**
 * GPU(그래픽) 가속 사용 여부 결정 로직.
 *
 * 예전에는 Windows에서 무조건 GPU를 끄고(--disable-gpu) GPU 샌드박스까지 꺼서, 모든 PC가
 * 소프트웨어 렌더링으로 느리게 돌았고 샌드박스도 약해졌다. 이제는 기본을 "가속 사용"으로 두고,
 * 아래 경우에만 소프트웨어 렌더링으로 내린다.
 *   1) 사용자가 직접 껐을 때(트레이 메뉴 → 그래픽 가속) 또는 EMAX_DISABLE_GPU=1 / --disable-gpu
 *   2) 최근 7일 안에 GPU 프로세스가 비정상 종료한 횟수가 한도(2회) 이상일 때 — 드라이버 문제가 있는 PC 자동 보호
 * 상태는 userData/gpu-state.json 에 저장한다. 순수 함수만 두어 Electron 없이 테스트할 수 있다.
 */

const CRASH_LIMIT = 2;
const CRASH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORED_CRASHES = 20;
// GPU 프로세스가 정상적으로 끝난 경우는 크래시로 세지 않는다
const BENIGN_REASONS = new Set(['clean-exit', 'killed']);

function emptyState() {
  return { forceDisable: false, crashes: [] };
}

function normalizeState(raw) {
  const state = emptyState();
  if (!raw || typeof raw !== 'object') return state;
  state.forceDisable = raw.forceDisable === true;
  if (Array.isArray(raw.crashes)) {
    state.crashes = raw.crashes
      .filter((c) => c && Number.isFinite(c.at))
      .map((c) => ({ at: c.at, reason: String(c.reason || 'unknown').slice(0, 40) }))
      .slice(-MAX_STORED_CRASHES);
  }
  return state;
}

function recentCrashCount(state, now) {
  return state.crashes.filter((c) => now - c.at < CRASH_WINDOW_MS).length;
}

/** 이번 실행에서 하드웨어 가속을 꺼야 하면 { disable: true, reason } */
function decideGpu({ env = {}, argv = [], state, now = Date.now() }) {
  if (env.EMAX_DISABLE_GPU === '1') return { disable: true, reason: 'env' };
  if (argv.includes('--disable-gpu')) return { disable: true, reason: 'argv' };
  if (state.forceDisable) return { disable: true, reason: 'user-setting' };
  if (recentCrashCount(state, now) >= CRASH_LIMIT) return { disable: true, reason: 'repeated-gpu-crash' };
  return { disable: false, reason: null };
}

/** GPU 프로세스 종료 정보를 상태에 반영한다. 정상 종료면 그대로 돌려준다. */
function recordGpuExit(state, details, now = Date.now()) {
  if (!details || details.type !== 'GPU' || BENIGN_REASONS.has(details.reason)) return state;
  const crashes = [...state.crashes, { at: now, reason: details.reason || 'unknown' }].slice(-MAX_STORED_CRASHES);
  return { ...state, crashes };
}

/** 사용자가 가속 사용/해제를 바꿀 때. 다시 켜면 누적된 크래시 기록도 비워 곧바로 재판정되지 않게 한다. */
function setUserForceDisable(state, disable) {
  return { forceDisable: !!disable, crashes: disable ? state.crashes : [] };
}

module.exports = {
  CRASH_LIMIT,
  CRASH_WINDOW_MS,
  emptyState,
  normalizeState,
  recentCrashCount,
  decideGpu,
  recordGpuExit,
  setUserForceDisable,
};
