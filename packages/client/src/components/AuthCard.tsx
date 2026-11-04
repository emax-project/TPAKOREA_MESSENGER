import type { ReactNode } from 'react';
import { cn } from '../utils/cn';

// TODO: TPA코리아 전용 로고 파일을 받으면 `public/tpa-logo.png`로 추가하고 이 경로를 교체할 것.
// 그 전까지는 거래처(CSIN) 로고가 잘못 노출되는 것을 막기 위해 범용 EMAX 로고로 대체.
const LOGO_SRC = `${import.meta.env.BASE_URL}emax-logo.png`;

type Props = {
  children: ReactNode;
  title: string;
  subtext?: ReactNode;
  className?: string;
  /** 'flush'는 팝업 카드처럼 보이지 않도록 모서리 둥글림·그림자·여백 없이 창 전체를 채운다 */
  variant?: 'card' | 'flush';
};

export function AuthCard({ children, title, subtext, className, variant = 'card' }: Props) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden w-full max-w-full bg-white',
        variant === 'card' ? 'rounded-[24px] shadow-2xl' : 'h-full justify-center',
        className,
      )}
    >
      <div className="flex flex-col justify-center px-6 py-10 sm:px-8">
        <div className="flex flex-col items-center text-center mb-8">
          <img src={LOGO_SRC} alt="TPA Korea" className="mb-5 h-10 w-auto max-w-[240px] object-contain" />
          <h1 className="brand-title text-xl font-bold text-black">{title}</h1>
          {subtext ? <p className="mt-2 text-sm text-[#334155]">{subtext}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}
