import { motion } from 'motion/react';
import type { Transaction } from '../types';

interface Step {
  key:     string;
  label:   string;
  detail:  string;
  status:  'done' | 'active' | 'pending' | 'error';
}

function buildSteps(tx: Transaction): Step[] {
  const isFiatSrc  = tx.from_currency === 'FCFA' || tx.from_currency === 'USD';
  const isCryptoSrc = tx.from_currency === 'USDC' || tx.from_currency === 'USDT';
  const isCompleted = tx.status === 'completed';
  const isFailed    = tx.status === 'failed';
  const isProcessing= tx.status === 'processing';

  if (isFiatSrc) {
    // On-ramp flow
    return [
      {
        key: 'created',
        label: 'Transaction créée',
        detail: `Réf ${tx.reference} enregistrée`,
        status: 'done',
      },
      {
        key: 'payment',
        label: 'Paiement Mobile Money',
        detail: isCompleted || isProcessing
          ? 'Paiement reçu et vérifié'
          : isFailed ? 'Échec du paiement'
          : 'En attente de votre confirmation sur le téléphone',
        status: isCompleted ? 'done' : isFailed ? 'error' : isProcessing ? 'active' : 'pending',
      },
      {
        key: 'conversion',
        label: 'Conversion en cours',
        detail: isCompleted ? 'Stablecoins transférés' : 'Traitement de la conversion',
        status: isCompleted ? 'done' : isProcessing ? 'active' : 'pending',
      },
      {
        key: 'delivery',
        label: 'Livraison sur votre wallet',
        detail: isCompleted
          ? `${tx.to_amount.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${tx.to_currency} envoyés`
          : 'En attente de la confirmation de paiement',
        status: isCompleted ? 'done' : 'pending',
      },
    ];
  } else if (isCryptoSrc) {
    // Off-ramp flow
    return [
      {
        key: 'created',
        label: 'Transaction initiée',
        detail: `Réf ${tx.reference}`,
        status: 'done',
      },
      {
        key: 'escrow',
        label: 'Tokens verrouillés en escrow',
        detail: tx.tx_hash
          ? `Hash: ${tx.tx_hash.slice(0, 10)}…${tx.tx_hash.slice(-6)}`
          : 'En attente de la confirmation MetaMask',
        status: tx.tx_hash ? 'done' : isProcessing ? 'active' : 'pending',
      },
      {
        key: 'dispatch',
        label: 'Envoi Mobile Money',
        detail: isCompleted
          ? 'Paiement FCFA envoyé sur votre téléphone'
          : isFailed ? 'Échec de l\'envoi FCFA'
          : isProcessing ? 'Paiement FCFA en cours'
          : 'En attente du verrouillage des tokens',
        status: isCompleted ? 'done' : isFailed ? 'error' : isProcessing && tx.tx_hash ? 'active' : 'pending',
      },
      {
        key: 'release',
        label: 'Finalisation',
        detail: isCompleted
          ? 'Escrow libéré, transaction complète'
          : 'Libération de l\'escrow après confirmation FCFA',
        status: isCompleted ? 'done' : 'pending',
      },
    ];
  } else {
    // Swap
    return [
      { key: 'created',    label: 'Swap initié',    detail: `Réf ${tx.reference}`, status: 'done' },
      { key: 'processing', label: 'Conversion',      detail: 'Échange en cours sur la plateforme', status: isCompleted ? 'done' : isProcessing ? 'active' : 'pending' },
      { key: 'completed',  label: 'Swap complété',   detail: isCompleted ? `${tx.to_amount.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${tx.to_currency} disponibles` : 'En attente', status: isCompleted ? 'done' : 'pending' },
    ];
  }
}

const STATUS_STYLE = {
  done:    { color: '#00C896', bg: 'rgba(0,200,150,0.15)',   line: '#00C896' },
  active:  { color: '#F0A500', bg: 'rgba(240,165,0,0.15)',   line: '#F0A500' },
  pending: { color: 'rgba(255,255,255,0.2)', bg: 'rgba(255,255,255,0.05)', line: 'rgba(255,255,255,0.08)' },
  error:   { color: '#F87171', bg: 'rgba(248,113,113,0.15)', line: '#F87171' },
};

export function TransactionTimeline({ tx }: { tx: Transaction }) {
  const steps = buildSteps(tx);

  return (
    <div style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((step, i) => {
        const s = STATUS_STYLE[step.status];
        const isLast = i === steps.length - 1;
        return (
          <div key={step.key} style={{ display: 'flex', gap: 12, position: 'relative' }}>
            {/* Vertical line */}
            {!isLast && (
              <div style={{
                position: 'absolute', left: 12, top: 26, bottom: -4,
                width: 1, background: STATUS_STYLE[steps[i + 1].status].line,
                transition: 'background 0.5s',
              }} />
            )}
            {/* Dot */}
            <div style={{ flexShrink: 0, paddingTop: 2 }}>
              <motion.div
                animate={step.status === 'active' ? { scale: [1, 1.2, 1] } : {}}
                transition={step.status === 'active' ? { repeat: Infinity, duration: 1.5 } : {}}
                style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: s.bg, border: `1.5px solid ${s.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, color: s.color, fontWeight: 700,
                  transition: 'all 0.4s',
                }}
              >
                {step.status === 'done'    ? '✓' :
                 step.status === 'error'   ? '✕' :
                 step.status === 'active'  ? '·' : '○'}
              </motion.div>
            </div>

            {/* Text */}
            <div style={{ paddingBottom: 20 }}>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: step.status !== 'pending' ? 600 : 400,
                color: step.status === 'pending' ? 'rgba(255,255,255,0.3)' : 'var(--text)',
                marginBottom: 2, transition: 'color 0.4s',
              }}>
                {step.label}
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                {step.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
