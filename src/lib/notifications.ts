/**
 * Luma Ramp — Système de notifications avancé
 *
 * Types : tx_created | tx_processing | tx_completed | tx_failed |
 *         rate_alert | system
 *
 * Canaux : toast sonner + centre de notifications (persisté) + push navigateur
 */
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export type NotifType =
  | 'tx_created'
  | 'tx_processing'
  | 'tx_completed'
  | 'tx_failed'
  | 'tx_expired'
  | 'rate_alert'
  | 'system';

export interface Notification {
  id:        string;
  type:      NotifType;
  title:     string;
  body:      string;
  reference?: string;   // transaction reference
  ts:        number;
  read:      boolean;
  action?:   { label: string; href?: string; onClick?: () => void };
}

const STORAGE_KEY = 'luma_notifications';
const MAX_STORED  = 50;

// ─── Persist ──────────────────────────────────────────────────────────────────
function load(): Notification[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

function save(notifs: Notification[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(notifs.slice(0, MAX_STORED))); }
  catch { /* storage full */ }
}

// ─── Sound ────────────────────────────────────────────────────────────────────
function playTone(type: 'success' | 'error' | 'info') {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const freqs: Record<string, number[]> = {
      success: [440, 554, 659],  // A4-C#5-E5 (major chord arpeggio)
      error:   [330, 277],       // E4-C#4 (descending minor)
      info:    [440],            // A4 (single neutral)
    };

    const notes = freqs[type];
    let t = ctx.currentTime;
    for (const freq of notes) {
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.08, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      t += 0.14;
    }
    osc.start(ctx.currentTime);
    osc.stop(t + 0.1);
  } catch { /* AudioContext not available */ }
}

// ─── Push notifications ───────────────────────────────────────────────────────
async function requestPushPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function sendPush(title: string, body: string, icon = '/icons/icon-192.svg') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, icon, badge: icon, silent: true });
    setTimeout(() => n.close(), 8000);
  } catch { /* ignore */ }
}

// ─── UX copy per type ────────────────────────────────────────────────────────
export function buildNotification(
  type: NotifType,
  opts: { reference?: string; from?: string; to?: string; fromAmt?: number; toAmt?: number; error?: string }
): Omit<Notification, 'id' | 'ts' | 'read'> {
  const { reference, from, to, fromAmt, toAmt, error } = opts;
  const pair = from && to ? `${fromAmt?.toLocaleString('fr-FR')} ${from} → ${toAmt?.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${to}` : '';

  switch (type) {
    case 'tx_created':
      return {
        type, reference,
        title: '✦ Transaction créée',
        body: `${pair} · Réf ${reference}\nSuivez sa progression dans Historique.`,
      };
    case 'tx_processing':
      return {
        type, reference,
        title: '⟳ En cours de traitement',
        body: `Votre échange ${pair} est en cours. Vous recevrez une confirmation sous peu.`,
      };
    case 'tx_completed':
      return {
        type, reference,
        title: '✓ Échange complété 🎉',
        body: `${pair} a été traité avec succès. Les fonds sont en route.`,
        action: reference ? { label: 'Voir le détail', href: `#history` } : undefined,
      };
    case 'tx_failed':
      return {
        type, reference,
        title: '✕ Transaction échouée',
        body: error
          ? `${pair} — ${error}`
          : `${pair} n'a pas pu être traitée. Vos fonds sont en sécurité.`,
        action: { label: 'Réessayer' },
      };
    case 'tx_expired':
      return {
        type, reference,
        title: '⏱ Transaction expirée',
        body: `${pair} a expiré. Vous pouvez récupérer vos fonds depuis l'historique.`,
        action: reference ? { label: 'Récupérer mes fonds' } : undefined,
      };
    case 'rate_alert':
      return {
        type,
        title: '📈 Taux mis à jour',
        body: opts.error ?? 'Les taux de change viennent d\'être actualisés.',
      };
    default:
      return { type, title: 'Luma Ramp', body: opts.error ?? '' };
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useNotifications() {
  const [notifs,      setNotifs]      = useState<Notification[]>(load);
  const [soundOn,     setSoundOn]     = useState(() => localStorage.getItem('luma_sound') !== 'off');
  const [pushGranted, setPushGranted] = useState(
    typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
  );

  const unread = notifs.filter(n => !n.read).length;

  // Sync to localStorage on every change
  useEffect(() => { save(notifs); }, [notifs]);

  const add = useCallback((
    type: NotifType,
    opts: Parameters<typeof buildNotification>[1],
    toastOptions?: { duration?: number }
  ) => {
    const built = buildNotification(type, opts);
    const notif: Notification = {
      ...built,
      id:   `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ts:   Date.now(),
      read: false,
    };

    setNotifs(prev => [notif, ...prev]);

    // Sound
    if (soundOn) {
      if (type === 'tx_completed') playTone('success');
      else if (type === 'tx_failed' || type === 'tx_expired') playTone('error');
      else playTone('info');
    }

    // Push notification (background)
    sendPush(notif.title, notif.body);

    // Toast with personality
    const dur = toastOptions?.duration ?? 6000;
    const toastCopy = notif.body.length > 80 ? notif.body.slice(0, 78) + '…' : notif.body;

    switch (type) {
      case 'tx_completed':
        toast.success(notif.title, { description: toastCopy, duration: dur });
        break;
      case 'tx_failed':
      case 'tx_expired':
        toast.error(notif.title, { description: toastCopy, duration: dur });
        break;
      case 'tx_processing':
        toast.info(notif.title, { description: toastCopy, duration: dur });
        break;
      default:
        toast(notif.title, { description: toastCopy, duration: dur });
    }

    return notif.id;
  }, [soundOn]);

  const markRead = useCallback((id: string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const remove = useCallback((id: string) => {
    setNotifs(prev => prev.filter(n => n.id !== id));
  }, []);

  const clear = useCallback(() => { setNotifs([]); }, []);

  const toggleSound = useCallback(() => {
    setSoundOn(v => {
      localStorage.setItem('luma_sound', !v ? 'on' : 'off');
      return !v;
    });
  }, []);

  const enablePush = useCallback(async () => {
    const granted = await requestPushPermission();
    setPushGranted(granted);
    return granted;
  }, []);

  return {
    notifs, unread,
    add, markRead, markAllRead, remove, clear,
    soundOn, toggleSound,
    pushGranted, enablePush,
  };
}
