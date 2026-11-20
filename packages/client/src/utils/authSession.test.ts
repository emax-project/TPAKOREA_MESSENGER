import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOGIN_DATE_KEY,
  clearSessionDate,
  getActiveToken,
  getStoredToken,
  isSessionFromToday,
  markSessionToday,
  todayLocalDate,
} from './authSession';

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

describe('authSession', () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  afterEach(() => {
    localStorage.removeItem('token');
    localStorage.removeItem(LOGIN_DATE_KEY);
  });

  it('todayLocalDate is yyyy-mm-dd', () => {
    expect(todayLocalDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getActiveToken is null without today mark', () => {
    localStorage.setItem('token', 'abc');
    expect(isSessionFromToday()).toBe(false);
    expect(getActiveToken()).toBeNull();
  });

  it('getActiveToken returns token after markSessionToday', () => {
    localStorage.setItem('token', 'abc');
    markSessionToday();
    expect(isSessionFromToday()).toBe(true);
    expect(getActiveToken()).toBe('abc');
  });

  it('yesterday session remains available for server logout only', () => {
    localStorage.setItem('token', 'abc');
    localStorage.setItem(LOGIN_DATE_KEY, '2020-01-01');
    expect(isSessionFromToday()).toBe(false);
    expect(getActiveToken()).toBeNull();
    expect(getStoredToken()).toBe('abc');
  });

  it('clearSessionDate drops the login date', () => {
    markSessionToday();
    clearSessionDate();
    expect(isSessionFromToday()).toBe(false);
  });
});
