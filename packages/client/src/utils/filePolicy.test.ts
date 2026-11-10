import { describe, expect, it } from 'vitest';
import { evaluateFilePolicy } from './filePolicy';

const policy = {
  alwaysBlockedExtensions: ['.exe', '.html'],
  fileTransfer: { enabled: true, maxSizeMB: 10, blockedExtensions: ['.ps1'], allowedExtensions: [] as string[] },
};

describe('evaluateFilePolicy', () => {
  it('정상 파일은 통과', () => {
    expect(evaluateFilePolicy({ name: '보고서.pdf', size: 1000 }, policy)).toBeNull();
    expect(evaluateFilePolicy({ name: 'README', size: 1 }, policy)).toBeNull();
  });
  it('필수 차단·정책 차단 확장자(대소문자 무관)를 막는다', () => {
    expect(evaluateFilePolicy({ name: 'a.EXE', size: 1 }, policy)).toMatch(/실행 파일/);
    expect(evaluateFilePolicy({ name: 'a.ps1', size: 1 }, policy)).toMatch(/\.ps1/);
  });
  it('이중 확장자는 마지막 확장자로 판단', () => {
    expect(evaluateFilePolicy({ name: 'invoice.pdf.exe', size: 1 }, policy)).not.toBeNull();
    expect(evaluateFilePolicy({ name: 'invoice.exe.pdf', size: 1 }, policy)).toBeNull();
  });
  it('크기 제한 경계', () => {
    expect(evaluateFilePolicy({ name: 'a.pdf', size: 10 * 1024 * 1024 }, policy)).toBeNull();
    expect(evaluateFilePolicy({ name: 'a.pdf', size: 10 * 1024 * 1024 + 1 }, policy)).toMatch(/10MB/);
  });
  it('허용 목록 모드', () => {
    const p = { ...policy, fileTransfer: { ...policy.fileTransfer, allowedExtensions: ['.pdf'] } };
    expect(evaluateFilePolicy({ name: 'a.pdf', size: 1 }, p)).toBeNull();
    expect(evaluateFilePolicy({ name: 'a.png', size: 1 }, p)).toMatch(/허용되지 않은/);
  });
  it('전송 비활성화', () => {
    const p = { ...policy, fileTransfer: { ...policy.fileTransfer, enabled: false } };
    expect(evaluateFilePolicy({ name: 'a.pdf', size: 1 }, p)).toMatch(/제한/);
  });
});
