import type { SecurityPolicy } from '../api';

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? '' : name.slice(i).toLowerCase();
}

/**
 * 파일이 관리자 정책에 걸리는지 미리 검사한다. 통과하면 null, 아니면 사용자에게 보여줄 메시지.
 * 서버(lib/securityPolicy.js evaluateFile)와 같은 규칙이다 — 이쪽은 불필요한 업로드를
 * 줄이는 용도이고 최종 판단은 항상 서버가 한다.
 */
export function evaluateFilePolicy(
  file: { name: string; size: number },
  policy: Pick<SecurityPolicy, 'fileTransfer' | 'alwaysBlockedExtensions'>,
): string | null {
  const ft = policy.fileTransfer;
  if (!ft.enabled) return '파일 전송이 관리자에 의해 제한되어 있습니다';
  const ext = extOf(file.name);
  if (policy.alwaysBlockedExtensions.includes(ext)) return '실행 파일은 업로드할 수 없습니다';
  if (ft.blockedExtensions.includes(ext)) return `${ext} 형식의 파일은 전송할 수 없습니다`;
  if (ft.allowedExtensions.length > 0 && !ft.allowedExtensions.includes(ext)) {
    return `허용되지 않은 파일 형식입니다 (허용: ${ft.allowedExtensions.join(', ')})`;
  }
  if (file.size > ft.maxSizeMB * 1024 * 1024) return `파일 크기는 ${ft.maxSizeMB}MB 이하여야 합니다`;
  return null;
}
