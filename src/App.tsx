/**
 * src/App.tsx — NBK Finance / IPerCash
 * Interface 100% sans crypto côté utilisateur.
 * Flux : inscription → montant USD → KYC Harbor → instructions bancaires → suivi
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { io } from 'socket.io-client';
import {
  ArrowRight, CheckCircle2, Loader2, Copy,
  DollarSign, Phone, User, Mail, Clock,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';


// ─── Devises supportées ───────────────────────────────────────────────────────
const FIAT_META = {
  USD: { symbol: '$',   label: 'Dollar américain', flag: '🇺🇸', min: 10 },
  EUR: { symbol: '€',  label: 'Euro',              flag: '🇪🇺', min: 9  },
  GBP: { symbol: '£',  label: 'Livre sterling',    flag: '🇬🇧', min: 8  },
  CAD: { symbol: 'CA$', label: 'Dollar canadien',  flag: '🇨🇦', min: 13 },
  CHF: { symbol: 'Fr', label: 'Franc suisse',      flag: '🇨🇭', min: 9  },
} as const;
type FiatCurrency = keyof typeof FIAT_META;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Customer {
  harbor_uuid:    string;
  kyc_status:     string;
  agreement_link: string;
  kyc_link:       string | null;
}

interface Transfer {
  transfer_uuid:         string;
  status:                string;
  transfer_instructions: Record<string, string>;
  expected_usdc:         string;
  expected_fcfa:         number;
}

interface Transaction {
  id:           string;
  reference:    string;
  status:       string;
  from_amount:  number;
  to_amount:    number;
  harbor_status?: string;
  created_at:   string;
}

type Step = 'form' | 'kyc' | 'instructions' | 'waiting' | 'done';

// ─── API helpers ──────────────────────────────────────────────────────────────

const API = (path: string) => `/api${path}`;

async function post(path: string, body: unknown) {
  const r = await fetch(API(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? `Erreur ${r.status}`);
  return json;
}

async function get(path: string) {
  const r = await fetch(API(path));
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? `Erreur ${r.status}`);
  return json;
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function fmt(n: number, d = 0) {
  return n.toLocaleString('fr-FR', { maximumFractionDigits: d });
}

function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return { copied, copy };
}

// ─── Composants UI ────────────────────────────────────────────────────────────

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10,
        background: 'linear-gradient(135deg,#1D9E75,#185FA5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 800, fontSize: 15, color: '#fff',
      }}>N</div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1 }}>NBK Finance</div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.3 }}>Transfert diaspora</div>
      </div>
    </div>
  );
}

function Field({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
        color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em',
        textTransform: 'uppercase', marginBottom: 7,
      }}>
        {icon} {label}
      </div>
      {children}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={{
        width: '100%', boxSizing: 'border-box',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 10, padding: '10px 13px',
        fontFamily: 'var(--font-mono)', fontSize: 14,
        color: 'var(--text)', outline: 'none',
        transition: 'border-color 0.15s',
      }}
    />
  );
}

function Btn({
  onClick, disabled, loading, children, variant = 'primary',
}: {
  onClick: () => void; disabled?: boolean; loading?: boolean;
  children: React.ReactNode; variant?: 'primary' | 'secondary';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      style={{
        width: '100%', padding: '12px',
        borderRadius: 12, border: 'none',
        background: variant === 'primary'
          ? (disabled || loading ? 'rgba(0,200,150,0.4)' : 'var(--teal)')
          : 'rgba(255,255,255,0.07)',
        color: variant === 'primary' ? '#fff' : 'rgba(255,255,255,0.6)',
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'all 0.15s',
      }}>
      {loading && <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />}
      {children}
    </button>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { copied, copy } = useCopy(value);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 12px', background: 'rgba(255,255,255,0.04)',
      borderRadius: 9, marginBottom: 7,
    }}>
      <div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{value}</div>
      </div>
      <button onClick={copy}
        style={{ background: 'none', border: 'none', cursor: 'pointer',
          color: copied ? 'var(--teal)' : 'rgba(255,255,255,0.3)', padding: 4 }}>
        {copied ? <CheckCircle2 style={{ width: 15, height: 15 }} /> : <Copy style={{ width: 15, height: 15 }} />}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    pending:    { label: 'En attente',   color: '#F0A500' },
    processing: { label: 'En cours',     color: '#6B9FFF' },
    completing: { label: 'Finalisation', color: '#A78BFA' },
    completed:  { label: 'Complétée',   color: '#00C896' },
    failed:     { label: 'Échouée',      color: '#F87171' },
    expired:    { label: 'Expirée',      color: '#6B7280' },
  };
  const s = map[status] ?? { label: status, color: '#888' };
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 20,
      background: `${s.color}18`, color: s.color,
      fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
    }}>{s.label}</span>
  );
}

// ─── Étapes ───────────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'form',         label: 'Informations' },
    { id: 'kyc',          label: 'Vérification' },
    { id: 'instructions', label: 'Paiement' },
    { id: 'waiting',      label: 'Confirmation' },
    { id: 'done',         label: 'Terminé' },
  ];
  const idx = steps.findIndex(s => s.id === step);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {steps.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: i < idx ? 'var(--teal)' : i === idx ? 'rgba(0,200,150,0.3)' : 'rgba(255,255,255,0.07)',
              border: i === idx ? '2px solid var(--teal)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700,
              color: i <= idx ? 'var(--teal)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.3s',
            }}>
              {i < idx ? <CheckCircle2 style={{ width: 14, height: 14 }} /> : i + 1}
            </div>
            <div style={{
              fontSize: 10, marginTop: 4, textAlign: 'center',
              color: i === idx ? 'var(--teal)' : 'rgba(255,255,255,0.25)',
              fontFamily: 'var(--font-display)',
            }}>{s.label}</div>
          </div>
          {i < steps.length - 1 && (
            <div style={{
              height: 1, flex: 0.5,
              background: i < idx ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
              marginBottom: 20, transition: 'background 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Formulaire principal ─────────────────────────────────────────────────────

function FormStep({ onNext }: {
  onNext: (data: {
    customer: Customer; transaction: Transaction;
    transfer: Transfer; phone: string;
  }) => void;
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '',
    phone_us: '', currency: 'USD' as FiatCurrency, amount_usd: '',
    birth_date: '',
    beneficiary_phone: '', beneficiary_name: '',
  });
  const [loading, setLoading] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const valid = form.first_name && form.last_name && form.email &&
    form.phone_us && form.birth_date && Number(form.amount_usd) >= (FIAT_META[form.currency as FiatCurrency]?.min ?? 10) &&
    form.beneficiary_phone && form.beneficiary_name;

  const handleSubmit = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      // 1. Créer le customer Harbor
      const customer = await post('/customers', {
        first_name:         form.first_name,
        last_name:          form.last_name,
        email:              form.email,
        phone_country_code: 'US',
        phone_number:       form.phone_us,
        birth_date:         form.birth_date,
        description:        `NBK Finance — Transfert vers ${form.beneficiary_name}`,
      });

      // 2. Créer la transaction en base
      const tx: Transaction = await post('/transactions', {
        type:              'on-ramp',
        from_currency:     form.currency,
        to_currency:       'USDC',
        from_amount:       Number(form.amount_usd),
        phone:             form.beneficiary_phone,
        wallet_address:    import.meta.env.VITE_PLATFORM_WALLET ?? '0x0000000000000000000000000000000000000000',
        network:           'polygon',
      });

      // 3. Initier le transfer Harbor
      const transfer = await post(`/customers/${customer.harbor_uuid}/transfers`, {
        amount:            form.amount_usd,
        currency:          form.currency,
        network:           'polygon',
        reference:         tx.reference,
        beneficiary_phone: form.beneficiary_phone,
      });

      onNext({ customer, transaction: tx, transfer, phone: form.beneficiary_phone });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px',
      }}>
        <Field label="Prénom" icon={<User style={{ width: 11, height: 11 }} />}>
          <Input placeholder="Jean" value={form.first_name} onChange={set('first_name')} />
        </Field>
        <Field label="Nom" icon={<User style={{ width: 11, height: 11 }} />}>
          <Input placeholder="Dupont" value={form.last_name} onChange={set('last_name')} />
        </Field>
      </div>

      <Field label="Email" icon={<Mail style={{ width: 11, height: 11 }} />}>
        <Input type="email" placeholder="jean@email.com" value={form.email} onChange={set('email')} />
      </Field>

      <Field label="Téléphone (USA)" icon={<Phone style={{ width: 11, height: 11 }} />}>
        <Input type="tel" placeholder="555-555-1234" value={form.phone_us} onChange={set('phone_us')} />
      </Field>

      <Field label="Date de naissance" icon={<User style={{ width: 11, height: 11 }} />}>
        <Input
          type="date"
          value={form.birth_date}
          onChange={set('birth_date')}
          max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}
        />
      </Field>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '6px 0 14px' }} />

      <Field label="Montant et devise" icon={<DollarSign style={{ width: 11, height: 11 }} />}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value as FiatCurrency }))}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: '10px 10px', color: 'var(--text)',
              fontFamily: 'var(--font-display)', fontSize: 13, cursor: 'pointer',
              outline: 'none', flexShrink: 0,
            }}>
            {(Object.entries(FIAT_META) as [FiatCurrency, typeof FIAT_META[FiatCurrency]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.flag} {k}</option>
            ))}
          </select>
          <Input
            type="number"
            min={FIAT_META[form.currency as FiatCurrency]?.min ?? 10}
            placeholder={String(FIAT_META[form.currency as FiatCurrency]?.min ?? 10)}
            value={form.amount_usd}
            onChange={set('amount_usd')}
          />
        </div>
        {Number(form.amount_usd) > 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 5, fontFamily: 'var(--font-display)' }}>
            {FIAT_META[form.currency as FiatCurrency]?.symbol}{form.amount_usd} {form.currency}
            {' '}≈ {fmt(Number(form.amount_usd) * (form.currency === 'USD' ? 606 : form.currency === 'EUR' ? 660 : form.currency === 'GBP' ? 770 : form.currency === 'CAD' ? 446 : 674))} FCFA
          </div>
        )}
      </Field>

      <Field label="Numéro Mobile Money bénéficiaire" icon={<Phone style={{ width: 11, height: 11 }} />}>
        <Input type="tel" placeholder="+237 6XX XXX XXX" value={form.beneficiary_phone} onChange={set('beneficiary_phone')} />
      </Field>

      <Field label="Nom du bénéficiaire" icon={<User style={{ width: 11, height: 11 }} />}>
        <Input placeholder="Marie Dupont" value={form.beneficiary_name} onChange={set('beneficiary_name')} />
      </Field>

      <Btn onClick={handleSubmit} disabled={!valid} loading={loading}>
        Continuer <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>

      <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10, fontFamily: 'var(--font-display)' }}>
        Vos données sont protégées · KYC requis par la réglementation
      </p>
    </motion.div>
  );
}

// ─── Étape KYC ────────────────────────────────────────────────────────────────

function KycStep({ customer, onNext }: { customer: Customer; onNext: () => void }) {
  const [status, setStatus] = useState(customer.kyc_status);
  const [checking, setChecking] = useState(false);
  const [agreementOpened, setAgreementOpened] = useState(false);
  const [kycOpened, setKycOpened] = useState(false);
  const isVerified = status === 'verified';

  // Polling automatique toutes les 5s une fois le KYC ouvert
  useEffect(() => {
    if (!kycOpened && !agreementOpened) return;
    if (isVerified) return;
    const interval = setInterval(async () => {
      try {
        const res = await get(`/customers/${customer.harbor_uuid}`);
        setStatus(res.kyc_status);
        if (res.kyc_status === 'verified') {
          toast.success('Vérification confirmée ! ✓');
          clearInterval(interval);
        }
      } catch { /* silencieux */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [kycOpened, agreementOpened, isVerified]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await get(`/customers/${customer.harbor_uuid}`);
      setStatus(res.kyc_status);
      if (res.kyc_status === 'verified') toast.success('Vérification confirmée ! ✓');
      else toast.info(`Statut actuel : ${res.kyc_status}`);
    } catch (err: any) { toast.error(err.message); }
    finally { setChecking(false); }
  };

  const STATUS_INFO: Record<string, { label: string; color: string; hint: string }> = {
    deactivated: { label: 'En attente',         color: '#6B7280', hint: 'Signez d\'abord l\'accord ci-dessus' },
    unfinished:  { label: 'KYC à compléter',    color: '#F0A500', hint: 'Ouvrez le lien KYC et remplissez le formulaire' },
    finished:    { label: 'Soumis',             color: '#6B9FFF', hint: 'Harbor vérifie vos informations…' },
    verifying:   { label: 'Vérification…',      color: '#A78BFA', hint: 'Validation automatique en cours (1-2 min)' },
    verified:    { label: 'Vérifié ✓',          color: '#00C896', hint: 'Vous pouvez procéder au paiement' },
    rejected:    { label: 'Rejeté',             color: '#F87171', hint: 'Vérifiez vos informations et réessayez' },
  };
  const info = STATUS_INFO[status] ?? { label: status, color: '#888', hint: '' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Étapes numérotées */}
      <div style={{ marginBottom: 16 }}>
        {/* Étape 1 — Accord */}
        <div style={{
          padding: '14px', borderRadius: 12, marginBottom: 8,
          background: agreementOpened ? 'rgba(0,200,150,0.05)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${agreementOpened ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.08)'}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: agreementOpened ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: agreementOpened ? '#070B14' : 'rgba(255,255,255,0.4)',
            }}>
              {agreementOpened ? '✓' : '1'}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>
              Signer l'accord Harbor
            </span>
          </div>
          <a href={customer.agreement_link} target="_blank" rel="noreferrer"
            onClick={() => setAgreementOpened(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '9px 12px', background: 'rgba(255,255,255,0.05)',
              borderRadius: 9, textDecoration: 'none', color: 'var(--teal)',
              fontFamily: 'var(--font-display)', fontSize: 12,
            }}>
            Ouvrir l'accord <ExternalLink style={{ width: 13, height: 13 }} />
          </a>
        </div>

        {/* Étape 2 — KYC */}
        <div style={{
          padding: '14px', borderRadius: 12, marginBottom: 8,
          background: kycOpened ? 'rgba(107,159,255,0.05)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${kycOpened ? 'rgba(107,159,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          opacity: !agreementOpened ? 0.5 : 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: isVerified ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: isVerified ? '#070B14' : 'rgba(255,255,255,0.4)',
            }}>
              {isVerified ? '✓' : '2'}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>
              Vérifier votre identité (KYC)
            </span>
          </div>
          {customer.kyc_link ? (
            <a href={customer.kyc_link} target="_blank" rel="noreferrer"
              onClick={() => setKycOpened(true)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 12px', background: 'rgba(255,255,255,0.05)',
                borderRadius: 9, textDecoration: 'none', color: '#6B9FFF',
                fontFamily: 'var(--font-display)', fontSize: 12,
                pointerEvents: !agreementOpened ? 'none' : 'auto',
              }}>
              Ouvrir la vérification KYC <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          ) : (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)', padding: '4px 0' }}>
              Le lien KYC apparaît après signature de l'accord
            </div>
          )}
        </div>

        {/* Statut */}
        <div style={{
          padding: '10px 14px', borderRadius: 10, marginBottom: 14,
          background: `${info.color}12`,
          border: `1px solid ${info.color}30`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {(status === 'verifying' || status === 'finished') && (
            <Loader2 style={{ width: 14, height: 14, color: info.color, animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          )}
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: info.color }}>
              {info.label}
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              {info.hint}
            </div>
          </div>
        </div>
      </div>

      {!isVerified ? (
        <Btn onClick={checkStatus} loading={checking} variant="secondary">
          <Clock style={{ width: 14, height: 14 }} /> Actualiser le statut
        </Btn>
      ) : (
        <Btn onClick={onNext}>
          Continuer <ArrowRight style={{ width: 15, height: 15 }} />
        </Btn>
      )}

      <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-display)' }}>
        Le statut se met à jour automatiquement toutes les 5 secondes
      </p>
    </motion.div>
  );
}

// ─── Étape instructions bancaires ─────────────────────────────────────────────

function InstructionsStep({ transfer, transaction, onNext }: {
  transfer: Transfer; transaction: Transaction; onNext: () => void;
}) {
  const inst = transfer.transfer_instructions;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{
        padding: '14px', background: 'rgba(0,200,150,0.06)',
        border: '1px solid rgba(0,200,150,0.2)', borderRadius: 14, marginBottom: 16,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 4, color: 'var(--teal)' }}>
          Effectuez votre virement bancaire
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          Utilisez ces informations pour votre virement Wire ou ACH depuis votre banque américaine.
        </div>
      </div>

      {Object.entries(inst).map(([key, value]) => (
        <CopyRow
          key={key}
          label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          value={value}
        />
      ))}

      <div style={{
        padding: '10px 14px', borderRadius: 10, marginTop: 8, marginBottom: 16,
        background: 'rgba(107,159,255,0.06)', border: '1px solid rgba(107,159,255,0.12)',
        fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6,
      }}>
        Référence transaction : <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {transaction.reference}
        </strong><br />
        Montant attendu : <strong style={{ color: '#6B9FFF' }}>
          ${transfer.expected_usdc} USDC
        </strong>
        {transfer.expected_fcfa > 0 && (
          <> · {fmt(transfer.expected_fcfa)} FCFA</>
        )}
      </div>

      <Btn onClick={onNext}>
        J'ai effectué le virement <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>
    </motion.div>
  );
}

// ─── Étape attente confirmation ────────────────────────────────────────────────

function WaitingStep({ transaction, onDone }: {
  transaction: Transaction; onDone: (tx: Transaction) => void;
}) {
  const [tx, setTx] = useState(transaction);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const socket = io();
    socket.emit('subscribe', tx.reference);
    socket.on('tx_update', ({ reference, status }: { reference: string; status: string }) => {
      if (reference === tx.reference) {
        const updated = { ...tx, status };
        setTx(updated);
        if (status === 'completed') {
          onDone(updated);
        }
      }
    });
    return () => { socket.off('tx_update'); socket.disconnect(); };
  }, []);

  const HARBOR_STATUS_LABELS: Record<string, string> = {
    pending_customer_transfer_start: 'En attente de votre virement',
    pending_harbor:                  'Harbor traite votre paiement',
    completed:                       'USDC reçus ✓',
    reject:                          'Rejeté par Harbor',
    expired:                         'Expiré',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ textAlign: 'center', padding: '24px 0 20px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: 'rgba(107,159,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <Clock style={{ width: 28, height: 28, color: '#6B9FFF' }} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          En attente de confirmation
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Harbor surveille votre virement. Vous serez notifié dès réception des fonds.
          Le délai habituel est de 1-3 jours ouvrés pour un Wire.
        </div>
      </div>

      <div style={{
        padding: '14px', background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 14,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--teal)' }}>
            {tx.reference}
          </span>
          <StatusBadge status={tx.status} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {tx.harbor_status
            ? (HARBOR_STATUS_LABELS[tx.harbor_status] ?? tx.harbor_status)
            : 'Transfer Harbor en cours…'}
        </div>
      </div>

      <button onClick={() => setExpanded(v => !v)}
        style={{
          width: '100%', padding: '10px', borderRadius: 10,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.4)',
        }}>
        Que se passe-t-il ensuite ?
        {expanded
          ? <ChevronUp style={{ width: 14, height: 14 }} />
          : <ChevronDown style={{ width: 14, height: 14 }} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div style={{
              padding: '12px 14px', borderRadius: '0 0 10px 10px',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
              borderTop: 'none', fontFamily: 'var(--font-display)', fontSize: 12,
              color: 'rgba(255,255,255,0.4)', lineHeight: 1.8,
            }}>
              1. Harbor confirme la réception de votre virement USD<br />
              2. Les USDC sont envoyés sur le wallet NBK Finance<br />
              3. L'équipe NBK envoie les FCFA sur le Mobile Money du bénéficiaire<br />
              4. Vous recevez une confirmation par email
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Étape succès ─────────────────────────────────────────────────────────────

function DoneStep({ transaction, phone, onReset }: {
  transaction: Transaction; phone: string; onReset: () => void;
}) {
  const { copied, copy } = useCopy(transaction.reference);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <motion.div
          initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(0,200,150,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
          <CheckCircle2 style={{ width: 30, height: 30, color: 'var(--teal)' }} />
        </motion.div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>
          USDC reçus par NBK Finance ✓
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Les FCFA seront envoyés sur le numéro {phone} sous peu par l'équipe NBK.
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'rgba(255,255,255,0.04)',
        borderRadius: 12, marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>
            RÉFÉRENCE
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--teal)', fontSize: 16 }}>
            {transaction.reference}
          </span>
        </div>
        <button onClick={copy}
          style={{ background: 'none', border: 'none', cursor: 'pointer',
            color: copied ? 'var(--teal)' : 'rgba(255,255,255,0.3)', padding: 4 }}>
          {copied ? <CheckCircle2 style={{ width: 15, height: 15 }} /> : <Copy style={{ width: 15, height: 15 }} />}
        </button>
      </div>

      <Btn onClick={onReset} variant="secondary">
        Nouveau transfert
      </Btn>
    </motion.div>
  );
}

// ─── App principale ───────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<Step>('form');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [phone, setPhone] = useState('');

  const reset = () => {
    setStep('form');
    setCustomer(null);
    setTransfer(null);
    setTransaction(null);
    setPhone('');
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', padding: '20px 16px 60px',
    }}>
      <div style={{ position: 'fixed', top: 0, left: '25%', width: '50%', height: '30vh',
        background: 'radial-gradient(ellipse, rgba(0,200,150,0.04) 0%, transparent 70%)',
        pointerEvents: 'none' }} />

      <Toaster position="top-right" theme="dark" richColors closeButton />

      <nav style={{
        width: '100%', maxWidth: 480,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 28,
      }}>
        <Logo />
        <div style={{
          padding: '4px 10px', borderRadius: 8,
          background: 'rgba(255,255,255,0.04)',
          fontFamily: 'var(--font-display)', fontSize: 11,
          color: 'rgba(255,255,255,0.3)',
        }}>
          Sandbox
        </div>
      </nav>

      <div style={{
        width: '100%', maxWidth: 480,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '24px',
      }}>
        <StepIndicator step={step} />

        <AnimatePresence mode="wait">
          {step === 'form' && (
            <FormStep key="form" onNext={({ customer: c, transaction: tx, transfer: tr, phone: p }) => {
              setCustomer(c); setTransaction(tx); setTransfer(tr); setPhone(p);
              // Si déjà verified, sauter le KYC
              if (c.kyc_status === 'verified') setStep('instructions');
              else setStep('kyc');
            }} />
          )}

          {step === 'kyc' && customer && (
            <KycStep key="kyc" customer={customer}
              onNext={() => setStep('instructions')} />
          )}

          {step === 'instructions' && transfer && transaction && (
            <InstructionsStep key="instructions"
              transfer={transfer} transaction={transaction}
              onNext={() => setStep('waiting')} />
          )}

          {step === 'waiting' && transaction && (
            <WaitingStep key="waiting" transaction={transaction}
              onDone={(tx) => { setTransaction(tx); setStep('done'); }} />
          )}

          {step === 'done' && transaction && (
            <DoneStep key="done" transaction={transaction}
              phone={phone} onReset={reset} />
          )}
        </AnimatePresence>
      </div>

      <p style={{
        marginTop: 20, fontFamily: 'var(--font-display)', fontSize: 11,
        color: 'rgba(255,255,255,0.15)', textAlign: 'center',
      }}>
        NBK Finance · IPerCash · Sécurisé par OwlPay Harbor
      </p>
    </div>
  );
}