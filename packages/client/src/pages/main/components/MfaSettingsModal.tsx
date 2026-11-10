import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../../../api';
import UIModal from '../../../components/ui/UIModal';
import MfaSetupPanel from '../../../components/MfaSetupPanel';
import { useAccentStyles } from '../../../hooks/useAccentStyles';

type View = 'status' | 'setup' | 'disable' | 'recovery';

/** 내 2차 인증(TOTP) 관리: 등록 · 해제 · 복구 코드 재발급 */
export default function MfaSettingsModal({ isDark, onClose }: { isDark: boolean; onClose: () => void }) {
  const accent = useAccentStyles(isDark);
  const queryClient = useQueryClient();
  const { data: status, refetch } = useQuery({ queryKey: ['mfa', 'status'], queryFn: authApi.mfaStatus });
  const [view, setView] = useState<View>('status');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const muted = isDark ? '#94a3b8' : '#64748b';
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
  const btn = { ...accent.primaryStyle } as React.CSSProperties;
  const btnClass = 'w-full rounded-lg border-none bg-gradient-to-br from-brand-light to-brand-dark px-3 py-2.5 text-[13px] font-semibold text-white cursor-pointer disabled:opacity-60';
  const secondaryClass = 'w-full rounded-lg border px-3 py-2.5 text-[13px] font-semibold cursor-pointer bg-transparent';

  const back = () => {
    setView('status');
    setPassword('');
    setCode('');
    setError('');
  };

  const reauth = async (action: 'disable' | 'recovery') => {
    if (!password || !code.trim()) return setError('비밀번호와 인증 코드를 모두 입력해 주세요.');
    setBusy(true);
    setError('');
    try {
      if (action === 'disable') {
        await authApi.mfaDisable(password, code.trim());
        await queryClient.invalidateQueries({ queryKey: ['mfa', 'status'] });
        back();
      } else {
        const r = await authApi.mfaRegenerateRecoveryCodes(password, code.trim());
        setNewCodes(r.recoveryCodes);
        await refetch();
        setView('recovery');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '요청에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const reauthForm = (action: 'disable' | 'recovery') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: muted }}>
        {action === 'disable'
          ? '2차 인증을 끄면 비밀번호만으로 로그인하게 됩니다. 본인 확인을 위해 비밀번호와 인증 코드(또는 복구 코드)를 입력하세요.'
          : '새 복구 코드를 만들면 기존 복구 코드는 모두 무효가 됩니다. 본인 확인을 위해 비밀번호와 인증 코드(또는 복구 코드)를 입력하세요.'}
      </p>
      <input type="password" autoFocus autoComplete="current-password" placeholder="비밀번호" value={password}
        onChange={(e) => { setPassword(e.target.value); setError(''); }} style={{ ...inputStyle, ...accent.inputStyle }} />
      <input type="text" autoComplete="one-time-code" placeholder="6자리 코드 또는 복구 코드" value={code}
        onChange={(e) => { setCode(e.target.value); setError(''); }} style={{ ...inputStyle, ...accent.inputStyle }} />
      {error && <p role="alert" style={{ margin: 0, fontSize: 12, color: '#dc2626' }}>{error}</p>}
      <button type="button" disabled={busy} className={btnClass} style={btn} onClick={() => { void reauth(action); }}>
        {busy ? '확인 중...' : action === 'disable' ? '2차 인증 끄기' : '복구 코드 다시 만들기'}
      </button>
      <button type="button" className={secondaryClass} style={{ borderColor: isDark ? '#475569' : '#e2e8f0', color: muted }} onClick={back}>
        취소
      </button>
    </div>
  );

  return (
    <UIModal title="2차 인증" onClose={onClose} width={400}>
      {view === 'setup' ? (
        <MfaSetupPanel
          onDone={async () => {
            await queryClient.invalidateQueries({ queryKey: ['mfa', 'status'] });
            back();
          }}
          onCancel={back}
        />
      ) : view === 'disable' ? (
        reauthForm('disable')
      ) : view === 'recovery' && newCodes ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: muted }}>
            새 복구 코드입니다. 각 코드는 한 번만 쓸 수 있고 <b>이 창을 닫으면 다시 볼 수 없습니다.</b>
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', padding: '10px 14px', borderRadius: 10, fontFamily: 'monospace', fontSize: 14, background: isDark ? '#1e293b' : '#f1f5f9', color: isDark ? '#e2e8f0' : '#0f172a' }}>
            {newCodes.map((c) => <span key={c}>{c}</span>)}
          </div>
          <button type="button" className={btnClass} style={btn} onClick={() => { setNewCodes(null); back(); }}>확인</button>
        </div>
      ) : view === 'recovery' ? (
        reauthForm('recovery')
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: isDark ? '#e2e8f0' : '#334155' }}>
            로그인할 때 비밀번호에 더해 휴대폰 인증 앱의 6자리 코드를 입력하도록 해서 계정을 더 안전하게 지킵니다.
          </p>
          <div style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13, background: isDark ? '#1e293b' : '#f8fafc', color: isDark ? '#e2e8f0' : '#334155' }}>
            상태: <b>{status ? (status.enabled ? '사용 중' : '사용 안 함') : '확인 중...'}</b>
            {status?.enabled && <span style={{ color: muted }}> · 남은 복구 코드 {status.recoveryCodesLeft}개</span>}
            {status?.required && <div style={{ marginTop: 4, color: muted }}>관리자가 모든 사용자에게 2차 인증을 필수로 설정했습니다.</div>}
          </div>
          {status && !status.enabled && (
            <button type="button" className={btnClass} style={btn} onClick={() => setView('setup')}>2차 인증 설정하기</button>
          )}
          {status?.enabled && (
            <>
              <button type="button" className={secondaryClass} style={{ borderColor: isDark ? '#475569' : '#e2e8f0', color: isDark ? '#e2e8f0' : '#334155' }} onClick={() => setView('recovery')}>
                복구 코드 다시 만들기
              </button>
              {!status.required && (
                <button type="button" className={secondaryClass} style={{ borderColor: '#fca5a5', color: '#dc2626' }} onClick={() => setView('disable')}>
                  2차 인증 끄기
                </button>
              )}
            </>
          )}
        </div>
      )}
    </UIModal>
  );
}
