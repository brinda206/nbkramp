import { useMemo } from 'react';
import type { Rates } from '../types';

const PAIRS = [
  { key: 'USDC_FCFA', label: 'USDC/FCFA' },
  { key: 'USDT_FCFA', label: 'USDT/FCFA' },
  { key: 'USD_FCFA',  label: 'USD/FCFA'  },
  { key: 'USDC_USD',  label: 'USDC/USD'  },
  { key: 'USDT_USD',  label: 'USDT/USD'  },
];

function fmt(v: number, pair: string) {
  if (pair.includes('FCFA')) return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  return v.toFixed(4);
}

interface Props { rates: Rates | null; updatedAt: Date | null; }

export function RatesTicker({ rates, updatedAt }: Props) {
  // Double the items for seamless loop
  const items = useMemo(() => [...PAIRS, ...PAIRS], []);

  if (!rates) {
    return (
      <div className="h-8 shimmer w-full" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }} />
    );
  }

  const ageSeconds = updatedAt ? Math.round((Date.now() - updatedAt.getTime()) / 1000) : null;
  const isStale = ageSeconds !== null && ageSeconds > 60;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        height: '32px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.25)',
      }}
    >
      {/* Live indicator */}
      <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3 gap-1.5"
        style={{ background: 'linear-gradient(90deg, #070B14 60%, transparent)' }}>
        <span
          className="live-dot"
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: isStale ? '#F0A500' : '#00C896',
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.08em' }}>
          LIVE
        </span>
      </div>

      {/* Scrolling track */}
      <div className="ticker-track flex items-center h-full pl-20">
        {items.map((p, i) => {
          const v = rates[p.key as keyof Rates];
          return (
            <div key={i} className="flex items-center gap-2 px-5 whitespace-nowrap shrink-0">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.06em' }}>
                {p.label}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: '#E2DDD0' }}>
                {typeof v === 'number' ? fmt(v, p.key) : '—'}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.1)', fontSize: 10 }}>·</span>
            </div>
          );
        })}
      </div>

      {/* Fade right */}
      <div className="absolute right-0 top-0 bottom-0 w-12 pointer-events-none"
        style={{ background: 'linear-gradient(270deg, #070B14, transparent)' }} />
    </div>
  );
}
