import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, Check, Trash2, Volume2, VolumeX, BellPlus, X, Clock } from 'lucide-react';
import type { Notification } from '../lib/notifications';

const TYPE_STYLE: Record<string, { color: string; bg: string; icon: string }> = {
  tx_created:    { color: '#6B9FFF', bg: 'rgba(107,159,255,0.1)', icon: '✦' },
  tx_processing: { color: '#F0A500', bg: 'rgba(240,165,0,0.1)',   icon: '⟳' },
  tx_completed:  { color: '#00C896', bg: 'rgba(0,200,150,0.1)',   icon: '✓' },
  tx_failed:     { color: '#F87171', bg: 'rgba(248,113,113,0.1)', icon: '✕' },
  tx_expired:    { color: '#6B7280', bg: 'rgba(107,114,128,0.1)', icon: '⏱' },
  rate_alert:    { color: '#F0A500', bg: 'rgba(240,165,0,0.1)',   icon: '📈' },
  system:        { color: '#E2DDD0', bg: 'rgba(226,221,208,0.1)', icon: '·' },
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)       return 'À l\'instant';
  if (s < 3600)     return `Il y a ${Math.floor(s / 60)} min`;
  if (s < 86400)    return `Il y a ${Math.floor(s / 3600)} h`;
  return `Il y a ${Math.floor(s / 86400)} j`;
}

interface Props {
  notifs:       Notification[];
  unread:       number;
  soundOn:      boolean;
  pushGranted:  boolean;
  onMarkRead:   (id: string) => void;
  onMarkAllRead:() => void;
  onRemove:     (id: string) => void;
  onClear:      () => void;
  onToggleSound:() => void;
  onEnablePush: () => void;
}

export function NotificationCenter({
  notifs, unread, soundOn, pushGranted,
  onMarkRead, onMarkAllRead, onRemove, onClear,
  onToggleSound, onEnablePush,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(v => !v); if (unread > 0) onMarkAllRead(); }}
        style={{
          position: 'relative',
          background: open ? 'rgba(240,165,0,0.1)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${open ? 'rgba(240,165,0,0.25)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 10, padding: 7, cursor: 'pointer',
          color: open ? '#F0A500' : 'rgba(255,255,255,0.45)',
          transition: 'all 0.15s', display: 'flex', alignItems: 'center',
        }}
      >
        <Bell style={{ width: 15, height: 15 }} />
        <AnimatePresence>
          {unread > 0 && (
            <motion.div
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              style={{
                position: 'absolute', top: -3, right: -3,
                width: 16, height: 16, borderRadius: '50%',
                background: '#F0A500', border: '2px solid #070B14',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontSize: 9, fontWeight: 700, color: '#000',
              }}
            >
              {unread > 9 ? '9+' : unread}
            </motion.div>
          )}
        </AnimatePresence>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)',
              width: 360, maxHeight: 480,
              background: '#0D1220', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 20, overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
              display: 'flex', flexDirection: 'column',
              zIndex: 200,
            }}
          >
            {/* Header */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14 }}>
                Notifications
                {notifs.length > 0 && (
                  <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(255,255,255,0.3)', fontWeight: 400 }}>
                    {notifs.length}
                  </span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Sound toggle */}
                <button onClick={onToggleSound} title={soundOn ? 'Désactiver le son' : 'Activer le son'}
                  style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: soundOn ? 'var(--teal)' : 'rgba(255,255,255,0.3)' }}>
                  {soundOn ? <Volume2 style={{ width: 13, height: 13 }} /> : <VolumeX style={{ width: 13, height: 13 }} />}
                </button>
                {/* Push */}
                {!pushGranted && (
                  <button onClick={onEnablePush} title="Activer les notifications push"
                    style={{ background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'var(--teal)' }}>
                    <BellPlus style={{ width: 13, height: 13 }} />
                  </button>
                )}
                {/* Clear all */}
                {notifs.length > 0 && (
                  <button onClick={onClear} title="Tout effacer"
                    style={{ background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 8, padding: '5px 7px', cursor: 'pointer', color: 'rgba(255,255,255,0.3)' }}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                )}
              </div>
            </div>

            {/* List */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {notifs.length === 0 ? (
                <div style={{ padding: '40px 20px', textAlign: 'center', color: 'rgba(255,255,255,0.2)' }}>
                  <Bell style={{ width: 28, height: 28, margin: '0 auto 10px', opacity: 0.3 }} />
                  <p style={{ fontFamily: 'var(--font-display)', fontSize: 12, margin: 0 }}>
                    Aucune notification pour l'instant.<br/>
                    Vos transactions apparaîtront ici.
                  </p>
                </div>
              ) : (
                <div>
                  {notifs.map((n, i) => {
                    const style = TYPE_STYLE[n.type] ?? TYPE_STYLE.system;
                    return (
                      <motion.div key={n.id}
                        initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        style={{
                          padding: '12px 16px',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: n.read ? 'transparent' : 'rgba(255,255,255,0.02)',
                          cursor: 'pointer',
                          transition: 'background 0.15s',
                          position: 'relative',
                        }}
                        onClick={() => onMarkRead(n.id)}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.035)')}
                        onMouseLeave={e => (e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(255,255,255,0.02)')}
                      >
                        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                          {/* Icon */}
                          <div style={{ width: 30, height: 30, borderRadius: 9, background: style.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13, color: style.color }}>
                            {style.icon}
                          </div>
                          {/* Content */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: n.read ? 'rgba(255,255,255,0.6)' : 'var(--text)' }}>
                                {n.title}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(255,255,255,0.2)', flexShrink: 0 }}>
                                {timeAgo(n.ts)}
                              </span>
                            </div>
                            <p style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.4)', margin: '3px 0 0', lineHeight: 1.5 }}>
                              {n.body}
                            </p>
                          </div>
                          {/* Remove */}
                          <button onClick={e => { e.stopPropagation(); onRemove(n.id); }}
                            style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: 'rgba(255,255,255,0.15)', flexShrink: 0, opacity: 0, transition: 'opacity 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0')}
                          >
                            <X style={{ width: 12, height: 12 }} />
                          </button>
                        </div>
                        {/* Unread dot */}
                        {!n.read && (
                          <div style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', width: 5, height: 5, borderRadius: '50%', background: style.color }} />
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer — push CTA */}
            {!pushGranted && (
              <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,200,150,0.04)' }}>
                <button onClick={onEnablePush}
                  style={{ width: '100%', padding: '8px', borderRadius: 10, background: 'rgba(0,200,150,0.1)', border: '1px solid rgba(0,200,150,0.2)', color: 'var(--teal)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <BellPlus style={{ width: 13, height: 13 }} />
                  Activer les notifications push
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
