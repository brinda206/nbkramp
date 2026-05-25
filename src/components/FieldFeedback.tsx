import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { PhoneCarrier } from '../lib/validation';

type Severity = 'ok' | 'success' | 'warning' | 'error' | 'info';

interface Props {
  message?: string;
  severity: Severity;
  className?: string;
}

const COLORS: Record<Severity, string> = {
  ok:      'transparent',
  success: '#00C896',
  warning: '#F0A500',
  error:   '#F87171',
  info:    '#6B9FFF',
};

const ICONS: Record<Severity, React.ReactNode | null> = {
  ok:      null,
  success: <CheckCircle2 style={{ width: 12, height: 12 }} />,
  warning: <AlertTriangle style={{ width: 12, height: 12 }} />,
  error:   <AlertCircle style={{ width: 12, height: 12 }} />,
  info:    <Info style={{ width: 12, height: 12 }} />,
};

export function FieldFeedback({ message, severity }: Props) {
  if (!message || severity === 'ok') return null;
  const color = COLORS[severity];
  return (
    <AnimatePresence>
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: 'auto', opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.18 }}
        style={{ overflow: 'hidden' }}
      >
        <div style={{
          marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6,
          fontFamily: 'var(--font-display)', fontSize: 11, color, lineHeight: 1.5,
        }}>
          {ICONS[severity]}
          <span>{message}</span>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Carrier badge shown next to phone input
export function CarrierBadge({ carrier }: { carrier: PhoneCarrier | null }) {
  if (!carrier || carrier === 'inconnu') return null;
  const style: Record<string, { color: string; bg: string }> = {
    MTN:     { color: '#F0A500', bg: 'rgba(240,165,0,0.1)'  },
    Orange:  { color: '#F97316', bg: 'rgba(249,115,22,0.1)' },
    Nexttel: { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)'},
  };
  const s = style[carrier] ?? { color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.06)' };
  return (
    <motion.span
      initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      style={{
        fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 700,
        padding: '2px 7px', borderRadius: 20,
        color: s.color, background: s.bg,
        letterSpacing: '0.05em',
      }}
    >
      {carrier}
    </motion.span>
  );
}
