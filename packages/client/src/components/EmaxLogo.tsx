import type { CSSProperties } from 'react';

type EmaxLogoVariant = 'dark' | 'light' | 'accent';
type EmaxLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface EmaxLogoProps {
  variant?: EmaxLogoVariant;
  size?: EmaxLogoSize;
  showTagline?: boolean;
  style?: CSSProperties;
}

const SIZE_MAP: Record<EmaxLogoSize, number> = {
  xs: 16,
  sm: 22,
  md: 28,
  lg: 36,
  xl: 44,
  '2xl': 64,
};

const TAGLINE_SCALE = 0.21;
const TAGLINE_TRACKING_EM = 0.42;

const LOGO_SRC = `${import.meta.env.BASE_URL}emax-logo.png`;

export function EmaxLogo({
  variant = 'dark',
  size = 'md',
  showTagline = false,
  style,
}: EmaxLogoProps) {
  const px = SIZE_MAP[size];
  const taglineColor = variant === 'light' ? 'rgba(255,255,255,0.72)' : '#94A3B8';

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', ...style }}>
      <img
        src={LOGO_SRC}
        alt="TPA-Korea"
        width={px}
        height={px}
        style={{ objectFit: 'contain', display: 'block' }}
        draggable={false}
      />
      {showTagline && (
        <span
          style={{
            marginTop: `${px * 0.32}px`,
            marginLeft: `${px * 0.04}px`,
            fontFamily: "'Montserrat','Helvetica Neue',Arial,sans-serif",
            fontSize: `${px * TAGLINE_SCALE}px`,
            fontWeight: 500,
            letterSpacing: `${TAGLINE_TRACKING_EM}em`,
            textTransform: 'uppercase',
            color: taglineColor,
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
          }}
        >
          Efficient Messaging for Agile eXecution
        </span>
      )}
    </div>
  );
}
