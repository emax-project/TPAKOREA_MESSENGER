// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_KEY, LOCK_KEY, isIdleExpired, readLastActivity, useScreenLockStore } from './screenLock';

describe('isIdleExpired', () => {
  it('설정 시간이 지나면 true, 경계 포함', () => {
    expect(isIdleExpired(0, 10 * 60_000 - 1, 10)).toBe(false);
    expect(isIdleExpired(0, 10 * 60_000, 10)).toBe(true);
    expect(isIdleExpired(1000, 1000 + 11 * 60_000, 10)).toBe(true);
  });
  it('0분(사용 안 함)이나 잘못된 값이면 절대 만료되지 않는다', () => {
    expect(isIdleExpired(0, 99 * 60 * 60_000, 0)).toBe(false);
    expect(isIdleExpired(0, 99 * 60 * 60_000, -1)).toBe(false);
    expect(isIdleExpired(0, 99 * 60 * 60_000, NaN)).toBe(false);
  });
});

function installMemoryStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}

describe('useScreenLockStore', () => {
  beforeEach(() => {
    installMemoryStorage();
    useScreenLockStore.setState({ locked: false });
  });

  it('lock은 상태를 저장하고, unlock은 지우면서 활동 시각을 갱신한다', () => {
    useScreenLockStore.getState().lock();
    expect(useScreenLockStore.getState().locked).toBe(true);
    expect(localStorage.getItem(LOCK_KEY)).toBe('1');

    const before = Date.now();
    useScreenLockStore.getState().unlock();
    expect(useScreenLockStore.getState().locked).toBe(false);
    expect(localStorage.getItem(LOCK_KEY)).toBeNull();
    expect(readLastActivity()).toBeGreaterThanOrEqual(before);
  });

  it('다른 창의 storage 이벤트로 잠금이 전파된다', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK_KEY, newValue: '1' }));
    expect(useScreenLockStore.getState().locked).toBe(true);
    window.dispatchEvent(new StorageEvent('storage', { key: LOCK_KEY, newValue: null }));
    expect(useScreenLockStore.getState().locked).toBe(false);
  });

  it('관련 없는 키 변경은 무시한다', () => {
    window.dispatchEvent(new StorageEvent('storage', { key: ACTIVITY_KEY, newValue: '123' }));
    expect(useScreenLockStore.getState().locked).toBe(false);
  });
});
