import { useEffect, useState } from 'react';
import { useAccentStyles } from '../../../hooks/useAccentStyles';
import { cn } from '../../../utils/cn';
import { authApi, type PasswordPolicy } from '../../../api';
import UIModal from '../../../components/ui/UIModal';
import { useAuthStore } from '../../../store';
import { rememberGroupwareCredentials } from '../../../utils/groupware';

const DEFAULT_POLICY: PasswordPolicy = {
  ldapEnabled: false,
  minLength: 4,
  requireUpper: false,
  requireLower: false,
  requireDigit: false,
  requireSpecial: false,
  hint: '4자 이상',
};

export function passwordErrorMessage(err: unknown, policy: PasswordPolicy): string {
  const msg = err instanceof Error ? err.message : String(err);
  const map: Record<string, string> = {
    CURRENT_PASSWORD_MISMATCH: '현재 비밀번호가 맞지 않습니다.',
    CURRENT_PASSWORD_REQUIRED: '현재 비밀번호를 입력해 주세요.',
    PASSWORD_TOO_SHORT: policy.ldapEnabled
      ? `새 비밀번호는 ${policy.minLength}자 이상이어야 합니다.`
      : '새 비밀번호는 4자 이상이어야 합니다.',
    PASSWORD_UNCHANGED: '지금 쓰는 비밀번호와 같습니다.',
    PASSWORD_POLICY: policy.hint || '비밀번호 정책을 확인해 주세요.',
    LDAP_USER_NOT_FOUND: 'LDAP에서 계정을 찾을 수 없습니다.',
    LDAP_UNAVAILABLE: 'LDAP 서버에 연결할 수 없습니다.',
    ACCOUNT_LOCKED: '로그인 시도가 많아 계정이 잠겼습니다. 잠시 후 다시 시도해 주세요.',
  };
  return map[msg] || msg;
}

type Props = {
  isDark: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  forced?: boolean;
};

export default function PasswordChangeModal({ isDark, onClose, onSuccess, forced = false }: Props) {
  const accent = useAccentStyles(isDark);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);

  useEffect(() => {
    authApi.passwordPolicy().then(setPolicy).catch(() => {});
  }, []);

  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: `1px solid ${isDark ? '#475569' : '#e2e8f0'}`,
    background: isDark ? '#1e293b' : '#fff',
    color: isDark ? '#e2e8f0' : '#333',
    fontSize: 14,
    boxSizing: 'border-box' as const,
  };
  const labelStyle = { display: 'block', fontSize: 12, color: isDark ? '#94a3b8' : '#64748b', marginBottom: 4 };

  const submit = async () => {
    setError(null);
    if (!current) return setError('현재 비밀번호를 입력해 주세요.');
    if (next.length < policy.minLength) {
      return setError(`새 비밀번호는 ${policy.minLength}자 이상이어야 합니다.`);
    }
    if (next !== confirm) return setError('새 비밀번호가 서로 다릅니다.');

    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      // LDAP 계정은 그룹웨어와 공유되므로 자동 로그인용 비밀번호도 새 것으로 갱신
      const email = useAuthStore.getState().user?.email;
      if (email) rememberGroupwareCredentials(email, next);
      setDone(true);
      onSuccess?.();
      if (!forced) setTimeout(onClose, 1200);
    } catch (err) {
      setError(passwordErrorMessage(err, policy));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UIModal
      title={forced ? '초기 비밀번호 변경' : '비밀번호 변경'}
      onClose={forced ? undefined : onClose}
      closable={!forced}
      width={380}
    >
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: isDark ? '#94a3b8' : '#64748b' }}>
          {forced
            ? '관리자가 초기화한 비밀번호입니다. 계속 사용하려면 먼저 새 비밀번호로 바꿔 주세요.'
            : '바꾸면 다른 기기에 남아 있는 로그인은 끊기고, 지금 이 창은 그대로 쓸 수 있습니다.'}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: isDark ? '#94a3b8' : '#64748b' }}>
          규칙: {policy.hint}
        </p>
        <div>
          <label style={labelStyle}>현재 비밀번호</label>
          <input
            autoFocus
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(e) => { setCurrent(e.target.value); setError(null); }}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        <div>
          <label style={labelStyle}>새 비밀번호</label>
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            placeholder={policy.hint}
            onChange={(e) => { setNext(e.target.value); setError(null); }}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        <div>
          <label style={labelStyle}>새 비밀번호 확인</label>
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(e) => { setConfirm(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            style={{ ...inputStyle, ...accent.inputStyle }}
          />
        </div>
        {error && <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>}
        {done && <div style={{ fontSize: 12, color: isDark ? '#34d399' : '#059669' }}>비밀번호를 바꿨습니다.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
          <button
            type="button"
            className="flex-1 px-4 py-2 border-none rounded-lg bg-gradient-to-br from-brand-light to-brand-dark text-white text-[13px] font-semibold cursor-pointer disabled:opacity-60"
            style={accent.primaryStyle}
            disabled={saving || done || !current || !next || !confirm}
            onClick={() => void submit()}
          >
            {saving ? '변경 중...' : '변경'}
          </button>
          {!forced && (
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'px-4 py-2 rounded-lg border text-[13px] font-semibold cursor-pointer',
                isDark ? 'border-slate-600 bg-transparent text-slate-200' : accent.custom ? 'border-[var(--color-brand-dark)] bg-transparent text-[var(--color-brand-dark)]' : 'border-slate-200 bg-transparent text-slate-700',
              )}
            >
              닫기
            </button>
          )}
        </div>
      </div>
    </UIModal>
  );
}
