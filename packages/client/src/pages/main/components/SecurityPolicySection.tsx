import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appSettingsApi, clearSecurityPolicyCache, type SecurityPolicy } from '../../../api';
import { useToastStore } from '../../../store';
import { useAccentStyles } from '../../../hooks/useAccentStyles';
import { cn } from '../../../utils/cn';

const REASON_LABEL: Record<string, string> = {
  FILE_TYPE_BLOCKED: '차단된 형식',
  FILE_TYPE_NOT_ALLOWED: '허용 목록 밖',
  FILE_TOO_LARGE: '크기 초과',
  FILE_TRANSFER_DISABLED: '전송 제한',
};

/** "zip, .iso\n7z" 같은 입력을 확장자 배열로. 형식이 틀리면 서버가 검증해서 알려준다. */
export function parseExtensionInput(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/** 관리자 보안 정책: 자동 화면 잠금 · 2차 인증 정책 · 파일 전송 통제 + 전송 감사 로그 */
export default function SecurityPolicySection({ isDark }: { isDark: boolean }) {
  const accent = useAccentStyles(isDark);
  const queryClient = useQueryClient();
  const showToast = useToastStore((s) => s.show);
  const { data } = useQuery({ queryKey: ['settings', 'security'], queryFn: appSettingsApi.getSecurity });

  const [lockMinutes, setLockMinutes] = useState('10');
  const [twoFactor, setTwoFactor] = useState<SecurityPolicy['twoFactor']>('optional');
  const [ftEnabled, setFtEnabled] = useState(true);
  const [maxSizeMB, setMaxSizeMB] = useState('2048');
  const [blocked, setBlocked] = useState('');
  const [allowed, setAllowed] = useState('');
  const [saving, setSaving] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [blockedOnly, setBlockedOnly] = useState(true);

  useEffect(() => {
    if (!data) return;
    setLockMinutes(String(data.screenLockMinutes));
    setTwoFactor(data.twoFactor);
    setFtEnabled(data.fileTransfer.enabled);
    setMaxSizeMB(String(data.fileTransfer.maxSizeMB));
    setBlocked(data.fileTransfer.blockedExtensions.join(', '));
    setAllowed(data.fileTransfer.allowedExtensions.join(', '));
  }, [data]);

  const { data: audit, refetch: refetchAudit, isFetching: auditLoading } = useQuery({
    queryKey: ['settings', 'file-audit', blockedOnly],
    queryFn: () => appSettingsApi.fileAudit({ blockedOnly, limit: 50 }),
    enabled: auditOpen,
  });

  const save = async () => {
    setSaving(true);
    try {
      const saved = await appSettingsApi.putSecurity({
        screenLockMinutes: Number(lockMinutes),
        twoFactor,
        fileTransfer: {
          enabled: ftEnabled,
          maxSizeMB: Number(maxSizeMB),
          blockedExtensions: parseExtensionInput(blocked),
          allowedExtensions: parseExtensionInput(allowed),
        },
      });
      queryClient.setQueryData(['settings', 'security'], saved);
      clearSecurityPolicyCache();
      showToast('보안 정책을 저장했습니다', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '저장에 실패했습니다', 'error');
    } finally {
      setSaving(false);
    }
  };

  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const title = isDark ? 'text-slate-200' : 'text-slate-800';
  const field = {
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`,
    background: isDark ? '#1e293b' : '#fff',
    color: isDark ? '#e2e8f0' : '#333',
    fontSize: 13,
    boxSizing: 'border-box' as const,
    ...accent.inputStyle,
  };

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg px-3 py-2.5', isDark ? 'bg-slate-800' : 'bg-white')}>
      <div>
        <div className={cn('text-[13px] font-semibold', title)}>보안 정책</div>
        <p className={cn('mt-1 mb-0 text-xs leading-relaxed', muted)}>
          모든 사용자에게 적용됩니다. 저장하면 바로 반영되며, 파일 전송 규칙은 서버에서 강제합니다.
        </p>
      </div>

      <label className="flex flex-col gap-1">
        <span className={cn('text-xs font-semibold', title)}>자동 화면 잠금 (분)</span>
        <input type="number" min={0} max={1440} value={lockMinutes} onChange={(e) => setLockMinutes(e.target.value)} style={{ ...field, width: 120 }} />
        <span className={cn('text-xs', muted)}>입력이 없으면 이 시간 뒤에 화면이 잠기고, 비밀번호로 해제합니다. 0이면 사용하지 않습니다.</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={cn('text-xs font-semibold', title)}>2차 인증</span>
        <select value={twoFactor} onChange={(e) => setTwoFactor(e.target.value as SecurityPolicy['twoFactor'])} style={{ ...field, width: 220 }}>
          <option value="optional">선택 (원하는 사용자만)</option>
          <option value="required">필수 (모든 사용자)</option>
        </select>
        <span className={cn('text-xs', muted)}>필수로 바꾸면 아직 등록하지 않은 사용자는 다음 로그인 때 인증 앱을 등록해야 로그인할 수 있습니다.</span>
      </label>

      <div className="flex flex-col gap-2">
        <span className={cn('text-xs font-semibold', title)}>파일 전송 통제</span>
        <label className={cn('flex items-center gap-2 text-xs', title)}>
          <input type="checkbox" checked={ftEnabled} onChange={(e) => setFtEnabled(e.target.checked)} className="h-4 w-4" />
          파일 전송 허용
        </label>
        <label className="flex flex-col gap-1">
          <span className={cn('text-xs', muted)}>파일 1개 최대 크기 (MB, 최대 2048)</span>
          <input type="number" min={1} max={2048} value={maxSizeMB} onChange={(e) => setMaxSizeMB(e.target.value)} style={{ ...field, width: 120 }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cn('text-xs', muted)}>
            추가 차단 확장자 (쉼표·공백 구분). 실행 파일(.exe 등)·웹 문서(.html, .svg)는 항상 차단됩니다.
          </span>
          <textarea rows={2} value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder=".ps1, .jar, .dll" style={{ ...field, resize: 'vertical' }} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={cn('text-xs', muted)}>허용 확장자 — 비워두면 제한 없음, 입력하면 여기 있는 형식만 전송할 수 있습니다.</span>
          <textarea rows={2} value={allowed} onChange={(e) => setAllowed(e.target.value)} placeholder=".pdf, .xlsx, .docx, .png, .jpg" style={{ ...field, resize: 'vertical' }} />
        </label>
      </div>

      <button
        type="button"
        style={accent.primaryStyle}
        disabled={saving}
        onClick={() => { void save(); }}
        className={cn('self-start px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer', saving && 'opacity-70 cursor-wait')}
      >
        {saving ? '저장 중' : '보안 정책 저장'}
      </button>

      <div className={cn('border-t pt-2', isDark ? 'border-slate-700' : 'border-slate-200')}>
        <button type="button" onClick={() => setAuditOpen((o) => !o)} className={cn('border-none bg-transparent p-0 text-xs font-semibold underline cursor-pointer', title)}>
          {auditOpen ? '파일 전송 기록 닫기' : '파일 전송 기록 보기'}
        </button>
        {auditOpen && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className={cn('flex items-center gap-1.5 text-xs', muted)}>
                <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} className="h-3.5 w-3.5" />
                차단된 것만
              </label>
              <button type="button" onClick={() => { void refetchAudit(); }} className={cn('border-none bg-transparent p-0 text-xs underline cursor-pointer', muted)}>
                {auditLoading ? '불러오는 중...' : '새로고침'}
              </button>
            </div>
            {audit && audit.length === 0 && <p className={cn('m-0 text-xs', muted)}>기록이 없습니다. (180일간 보관)</p>}
            <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {audit?.map((a) => (
                <div key={a.id} className={cn('rounded-md px-2 py-1.5 text-xs', isDark ? 'bg-slate-700 text-slate-200' : 'bg-slate-50 text-slate-700')}>
                  <div className="flex justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold">{a.fileName}</span>
                    <span className={a.allowed ? 'shrink-0 text-emerald-600' : 'shrink-0 text-red-600'}>
                      {a.allowed ? '허용' : (REASON_LABEL[a.reason ?? ''] ?? '차단')}
                    </span>
                  </div>
                  <div className={muted}>
                    {a.userName} · {formatSize(a.fileSize)} · {new Date(a.createdAt).toLocaleString('ko-KR')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
