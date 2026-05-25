import { useEffect, useRef, useState } from 'react';
import type { Rates } from '../types';

const HISTORY_KEY = 'luma_rate_history';
const MAX_POINTS  = 60; // 60 × 30s = 30 min of history

interface Point { t: number; v: number; }

function loadHistory(pair: string): Point[] {
  try {
    const raw = localStorage.getItem(`${HISTORY_KEY}_${pair}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveHistory(pair: string, pts: Point[]) {
  try { localStorage.setItem(`${HISTORY_KEY}_${pair}`, JSON.stringify(pts.slice(-MAX_POINTS))); }
  catch { /* storage full */ }
}

const PAIRS = [
  { key: 'USDC_FCFA', label: 'USDC', color: '#00C896' },
  { key: 'USDT_FCFA', label: 'USDT', color: '#F0A500' },
  { key: 'USD_FCFA',  label: 'USD',  color: '#6B9FFF' },
];

interface Props { rates: Rates | null; }

export function RatesChart({ rates }: Props) {
  const [selected, setSelected]  = useState('USDC_FCFA');
  const [history,  setHistory]   = useState<Point[]>(() => loadHistory('USDC_FCFA'));
  const [hovered,  setHovered]   = useState<Point | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pair = PAIRS.find(p => p.key === selected)!;

  // Append new point when rates update
  useEffect(() => {
    if (!rates) return;
    const v = rates[selected as keyof Rates];
    if (typeof v !== 'number') return;
    setHistory(prev => {
      const last = prev[prev.length - 1];
      // Don't duplicate if same timestamp bucket (30s)
      if (last && Date.now() - last.t < 15_000) return prev;
      const next = [...prev, { t: Date.now(), v }].slice(-MAX_POINTS);
      saveHistory(selected, next);
      return next;
    });
  }, [rates, selected]);

  // Reset history when pair changes
  useEffect(() => {
    setHistory(loadHistory(selected));
    setHovered(null);
  }, [selected]);

  // Build SVG path from history
  const W = 400, H = 80, PAD = 4;
  const pts = history.length < 2
    ? null
    : (() => {
        const vals = history.map(p => p.v);
        const min  = Math.min(...vals);
        const max  = Math.max(...vals);
        const range = max - min || 1;
        return history.map((p, i) => ({
          x: PAD + (i / (history.length - 1)) * (W - PAD * 2),
          y: PAD + (1 - (p.v - min) / range) * (H - PAD * 2),
          raw: p,
        }));
      })();

  const pathD = pts
    ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    : '';

  const fillD = pts
    ? `${pathD} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`
    : '';

  const currentVal = rates?.[selected as keyof Rates];
  const firstVal   = history[0]?.v;
  const delta      = currentVal && firstVal ? ((currentVal - firstVal) / firstVal) * 100 : null;
  const isUp       = delta !== null && delta >= 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!pts || !svgRef.current) return;
    const rect  = svgRef.current.getBoundingClientRect();
    const mx    = ((e.clientX - rect.left) / rect.width) * W;
    let closest = pts[0];
    let dist    = Math.abs(mx - pts[0].x);
    for (const p of pts) {
      const d = Math.abs(mx - p.x);
      if (d < dist) { dist = d; closest = p; }
    }
    setHovered(closest.raw);
  };

  const fmtFCFA = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 20,
      padding: '18px 20px',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Taux en temps réel
          </div>
          {currentVal && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="num-flip" key={currentVal?.toFixed(1)} style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: 'var(--text)' }}>
                {hovered ? fmtFCFA(hovered.v) : fmtFCFA(currentVal as number)}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>FCFA</span>
              {delta !== null && !hovered && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isUp ? '#00C896' : '#F87171', letterSpacing: '0.04em' }}>
                  {isUp ? '+' : ''}{delta.toFixed(2)}%
                </span>
              )}
              {hovered && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                  {fmtTime(hovered.t)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Pair selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {PAIRS.map(p => (
            <button key={p.key} onClick={() => setSelected(p.key)}
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                fontWeight: selected === p.key ? 600 : 400,
                padding: '4px 10px',
                borderRadius: 8,
                border: `1px solid ${selected === p.key ? p.color + '40' : 'rgba(255,255,255,0.06)'}`,
                background: selected === p.key ? p.color + '12' : 'transparent',
                color: selected === p.key ? p.color : 'rgba(255,255,255,0.35)',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* SVG chart */}
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block', cursor: pts ? 'crosshair' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHovered(null)}
        >
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={pair.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={pair.color} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {pts ? (
            <>
              {/* Fill */}
              <path d={fillD} fill="url(#chartGrad)" />
              {/* Line */}
              <path d={pathD} fill="none" stroke={pair.color} strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
              {/* Hover dot */}
              {hovered && (() => {
                const p = pts.find(pt => pt.raw === hovered);
                if (!p) return null;
                return (
                  <>
                    <line x1={p.x} y1={PAD} x2={p.x} y2={H - PAD}
                      stroke="rgba(255,255,255,0.1)" strokeWidth="1" strokeDasharray="3 3" />
                    <circle cx={p.x} cy={p.y} r="4" fill={pair.color} />
                    <circle cx={p.x} cy={p.y} r="7" fill={pair.color} fillOpacity="0.15" />
                  </>
                );
              })()}
            </>
          ) : (
            // No data — skeleton
            <rect x={PAD} y={H / 2 - 1} width={W - PAD * 2} height="2" rx="1"
              fill="rgba(255,255,255,0.05)" />
          )}
        </svg>

        {!pts && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.2)',
          }}>
            Accumulation des données…
          </div>
        )}
      </div>

      {/* X-axis labels */}
      {history.length >= 2 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          {[history[0], history[Math.floor(history.length / 2)], history[history.length - 1]].map((p, i) => (
            <span key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
              {fmtTime(p.t)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
