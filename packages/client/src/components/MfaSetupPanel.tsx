import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { authApi, type LoginSuccess } from '../api';
import UITextInput from './ui/UITextInput';

type Props = {
  /** 로그인 도중(강제 등록)이면 중간 토큰, 설정 화면에서 호출하면 생략 */
  mfaToken?: string;
  /** 등록과 복구 코드 확인까지 끝났을 때. 강제 등록이면 완료된 로그인 정보가 함께 온다 */
  onDone: (login?: LoginSuccess) => void;
  onCancel?: () => void;
};

/** 인증 앱 등록(QR → 6자리 코드 확인 → 복구 코드 안내) 3단계 공용 패널 */
export default function MfaSetupPanel({ mfaToken, onDone, onCancel }: Props) {
  const [step, setStep] = useState<'scan' | 'recovery'>('scan');
  const [secret, setSecret] = useState('');
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[]>([]);
  const [pendingLogin, setPendingLogin] = useState<LoginSuccess | undefined>();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authApi.mfaSetupStart(mfaToken);
        const dataUrl = await QRCode.toDataURL(res.otpauthUrl, { margin: 1, width: 192 });
        if (cancelled) return;
        setSecret(res.secret);
        setQr(dataUrl);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '2차 인증 설정을 시작하지 못했습니다');
      }
    })();
    return () => { cancelled = true; };
  }, [mfaToken]);

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || code.trim().length < 6) return;
    setBusy(true);
    setError('');
    try {
      const res = await authApi.mfaSetupConfirm(code.trim(), mfaToken);
      setRecovery(res.recoveryCodes);
      if (res.token && res.user) setPendingLogin({ user: res.user, token: res.token, mustChangePassword: res.mustChangePassword });
      setStep('recovery');
    } catch (err) {
      setError(err instanceof Error ? err.message : '등록에 실패했습니다');
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recovery.join('\n'));
      setCopied(true);
    } catch {
      /* 클립보드를 못 써도 화면의 코드를 직접 적어 둘 수 있다 */
    }
  };

  if (step === 'recovery') {
    return (
      <div className="flex w-full flex-col gap-3">
        <h3 className="m-0 text-[16px] font-bold text-slate-900">복구 코드를 보관하세요</h3>
        <p className="m-0 text-[13px] leading-relaxed text-slate-600">
          휴대폰을 잃어버려 인증 앱을 쓸 수 없을 때 이 코드로 로그인할 수 있습니다. 각 코드는 한 번만 쓸 수 있고,
          <b> 이 화면을 닫으면 다시 볼 수 없습니다.</b>
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-slate-100 px-4 py-3 font-mono text-[14px] text-slate-900">
          {recovery.map((c) => <span key={c}>{c}</span>)}
        </div>
        <button type="button" onClick={() => { void copyCodes(); }} className="self-start rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-700">
          {copied ? '복사됨' : '복사'}
        </button>
        <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="h-4 w-4 accent-black" />
          복구 코드를 안전한 곳에 보관했습니다
        </label>
        <button
          type="button"
          disabled={!saved}
          onClick={() => onDone(pendingLogin)}
          className="w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white disabled:opacity-60"
        >
          완료
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => { void confirm(e); }} className="flex w-full flex-col gap-3">
      <h3 className="m-0 text-[16px] font-bold text-slate-900">2차 인증 등록</h3>
      <ol className="m-0 list-decimal pl-5 text-[13px] leading-relaxed text-slate-600">
        <li>휴대폰에 인증 앱(Google Authenticator, Microsoft Authenticator 등)을 설치합니다.</li>
        <li>앱에서 아래 QR 코드를 스캔합니다.</li>
        <li>앱에 표시된 6자리 코드를 입력합니다.</li>
      </ol>
      <div className="flex flex-col items-center gap-2">
        {qr ? <img src={qr} alt="2차 인증 QR 코드" width={192} height={192} className="rounded-lg border border-slate-200" /> : <div className="h-48 w-48 animate-pulse rounded-lg bg-slate-100" />}
        {secret && (
          <p className="m-0 break-all text-center text-[12px] text-slate-500">
            QR이 안 되면 키를 직접 입력: <span className="font-mono text-slate-800">{secret.match(/.{1,4}/g)?.join(' ')}</span>
          </p>
        )}
      </div>
      <UITextInput
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        placeholder="6자리 코드"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
        className="!px-4 !py-3 !rounded-xl !border !border-[#e2e8f0] !bg-[#f8fafc] !text-black"
      />
      {error && <p className="m-0 rounded-xl bg-red-50/80 px-3 py-2 text-[13px] text-red-600" role="alert">{error}</p>}
      <button type="submit" disabled={busy || !secret || code.trim().length < 6} className="w-full rounded-full bg-black py-3 text-[15px] font-semibold text-white disabled:opacity-60">
        {busy ? '확인 중...' : '확인'}
      </button>
      {onCancel && (
        <button type="button" onClick={onCancel} className="border-none bg-transparent py-1 text-[13px] text-slate-500 underline">
          취소
        </button>
      )}
    </form>
  );
}
