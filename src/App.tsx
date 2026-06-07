/**
 * src/App.tsx — NBK Finance / IPerCash
 *
 * Gestion des clients récurrents :
 *   - Première visite : formulaire complet → profil sauvegardé en localStorage
 *   - Retour client   : saisit son email → profil chargé → va directement au montant
 *   - "Se souvenir"   : email pré-rempli automatiquement à la prochaine visite
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { io } from 'socket.io-client';
import {
  ArrowRight, CheckCircle2, Loader2, Copy,
  DollarSign, Phone, User, Mail, Clock,
  ChevronDown, ChevronUp, ExternalLink,
  RefreshCw, LogIn,
} from 'lucide-react';

// ─── Devises supportées ───────────────────────────────────────────────────────
const FIAT_META = {
  USD: { symbol: '$',    label: 'Dollar américain', flag: '🇺🇸', min: 10 },
  EUR: { symbol: '€',   label: 'Euro',              flag: '🇪🇺', min: 9  },
  GBP: { symbol: '£',   label: 'Livre sterling',    flag: '🇬🇧', min: 8  },
  CAD: { symbol: 'CA$', label: 'Dollar canadien',   flag: '🇨🇦', min: 13 },
  CHF: { symbol: 'Fr',  label: 'Franc suisse',      flag: '🇨🇭', min: 9  },
} as const;
type FiatCurrency = keyof typeof FIAT_META;

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

const LS_PROFILE  = 'nbk_customer_profile';
const LS_EMAIL    = 'nbk_remember_email';

interface SavedProfile {
  harbor_uuid:    string;
  kyc_status:     string;
  agreement_link: string;
  kyc_link:       string | null;
  first_name:     string;
  last_name:      string;
  email:          string;
  phone_us:       string;
  birth_date:     string;
  saved_at:       string;
}

function loadProfile(): SavedProfile | null {
  try {
    const raw = localStorage.getItem(LS_PROFILE);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveProfile(profile: SavedProfile) {
  localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
}

function clearProfile() {
  localStorage.removeItem(LS_PROFILE);
}

function loadRememberedEmail(): string {
  return localStorage.getItem(LS_EMAIL) ?? '';
}

function saveRememberedEmail(email: string) {
  localStorage.setItem(LS_EMAIL, email);
}

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
  payment_method:        'wire' | 'debit_card';
  transfer_instructions: Record<string, string>;
  card_payment_url?:     string | null;
  expected_usdc:         string;
  expected_fcfa:         number;
}

interface Transaction {
  id:            string;
  reference:     string;
  status:        string;
  from_amount:   number;
  to_amount:     number;
  harbor_status?: string;
  created_at:    string;
}

type Step = 'lookup' | 'form' | 'transfer' | 'kyc' | 'instructions' | 'waiting' | 'done';

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

function fcfaEstimate(amount: number, currency: FiatCurrency): number {
  const rates: Record<FiatCurrency, number> = {
    USD: 606, EUR: 660, GBP: 770, CAD: 446, CHF: 674,
  };
  return Math.round(amount * (rates[currency] ?? 606));
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
  children: React.ReactNode; variant?: 'primary' | 'secondary' | 'ghost';
}) {
  return (
    <button
      onClick={onClick} disabled={disabled || loading}
      style={{
        width: '100%', padding: '12px', borderRadius: 12, border: 'none',
        background: variant === 'primary'
          ? (disabled || loading ? 'rgba(0,200,150,0.4)' : 'var(--teal)')
          : variant === 'secondary'
          ? 'rgba(255,255,255,0.07)'
          : 'transparent',
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

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: 'form',         label: 'Profil'       },
    { id: 'transfer',     label: 'Montant'      },
    { id: 'kyc',          label: 'Vérification' },
    { id: 'instructions', label: 'Paiement'     },
    { id: 'waiting',      label: 'Confirmation' },
    { id: 'done',         label: 'Terminé'      },
  ];
  const displaySteps = steps.filter(s => s.id !== 'lookup');
  const idx = displaySteps.findIndex(s => s.id === step);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {displaySteps.map((s, i) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: i < idx ? 'var(--teal)' : i === idx ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.06)',
              border: i === idx ? '2px solid var(--teal)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              color: i <= idx ? 'var(--teal)' : 'rgba(255,255,255,0.2)',
              transition: 'all 0.3s',
            }}>
              {i < idx ? <CheckCircle2 style={{ width: 13, height: 13 }} /> : i + 1}
            </div>
            <div style={{
              fontSize: 9, marginTop: 3, textAlign: 'center',
              color: i === idx ? 'var(--teal)' : 'rgba(255,255,255,0.2)',
              fontFamily: 'var(--font-display)',
            }}>{s.label}</div>
          </div>
          {i < displaySteps.length - 1 && (
            <div style={{
              height: 1, flex: 0.4,
              background: i < idx ? 'var(--teal)' : 'rgba(255,255,255,0.07)',
              marginBottom: 18, transition: 'background 0.3s',
            }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Étape 0 — Lookup (client nouveau ou connu) ────────────────────────────────

function LookupStep({ onNewClient, onReturningClient }: {
  onNewClient: () => void;
  onReturningClient: (profile: SavedProfile, customer: Customer) => void;
}) {
  const [email, setEmail]           = useState(loadRememberedEmail());
  const [loading, setLoading]       = useState(false);
  const [remember, setRemember]     = useState(!!loadRememberedEmail());

  const handleLookup = async () => {
    if (!email.trim()) return;
    setLoading(true);
    try {
      if (remember) saveRememberedEmail(email.trim());
      else localStorage.removeItem(LS_EMAIL);

      // Chercher le profil local d'abord
      const saved = loadProfile();
      if (saved && saved.email.toLowerCase() === email.trim().toLowerCase()) {
        // Profil trouvé localement — vérifier le statut KYC actuel sur Harbor
        const rawCustomer = await get(`/customers/${saved.harbor_uuid}`);
        // GET /customers/:uuid retourne { uuid } pas harbor_uuid — normaliser
        const customer: Customer = {
          harbor_uuid:    rawCustomer.harbor_uuid ?? rawCustomer.uuid ?? saved.harbor_uuid,
          kyc_status:     rawCustomer.kyc_status  ?? rawCustomer.status,
          agreement_link: rawCustomer.agreement_link ?? '',
          kyc_link:       rawCustomer.kyc_link ?? null,
        };
        toast.success(`Bon retour, ${saved.first_name} !`);
        onReturningClient(saved, customer);
        return;
      }

      // Chercher dans Supabase via email hash
      const result = await get(`/customers/lookup?email=${encodeURIComponent(email.trim())}`);
      if (result?.harbor_uuid) {
        const rawCustomer2 = await get(`/customers/${result.harbor_uuid}`);
        const customer: Customer = {
          harbor_uuid:    rawCustomer2.harbor_uuid ?? rawCustomer2.uuid ?? result.harbor_uuid,
          kyc_status:     rawCustomer2.kyc_status  ?? rawCustomer2.status,
          agreement_link: rawCustomer2.agreement_link ?? '',
          kyc_link:       rawCustomer2.kyc_link ?? null,
        };
        // Reconstruire le profil depuis la DB
        const restored: SavedProfile = {
          harbor_uuid:    result.harbor_uuid,
          kyc_status:     customer.kyc_status,
          agreement_link: customer.agreement_link ?? '',
          kyc_link:       customer.kyc_link,
          first_name:     result.first_name ?? '',
          last_name:      result.last_name  ?? '',
          email:          email.trim(),
          phone_us:       result.phone_us   ?? '',
          birth_date:     result.birth_date ?? '',
          saved_at:       new Date().toISOString(),
        };
        saveProfile(restored);
        toast.success(`Bon retour, ${restored.first_name || 'client'} !`);
        onReturningClient(restored, customer);
        return;
      }

      // Client inconnu → formulaire complet
      onNewClient();
    } catch (err: any) {
      // Erreur 404 = client non trouvé → formulaire complet
      if (err.message?.includes('404') || err.message?.includes('introuvable')) {
        onNewClient();
      } else {
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>👋</div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 6 }}>
          Bienvenue sur NBK Finance
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>
          Entrez votre email pour commencer
        </div>
      </div>

      <Field label="Adresse email" icon={<Mail style={{ width: 11, height: 11 }} />}>
        <Input
          type="email"
          placeholder="jean@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLookup()}
          autoFocus
        />
      </Field>

      {/* Se souvenir de moi */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        marginBottom: 18, cursor: 'pointer',
      }} onClick={() => setRemember(v => !v)}>
        <div style={{
          width: 18, height: 18, borderRadius: 5, flexShrink: 0,
          background: remember ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
          border: `1px solid ${remember ? 'var(--teal)' : 'rgba(255,255,255,0.15)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}>
          {remember && <CheckCircle2 style={{ width: 11, height: 11, color: '#070B14' }} />}
        </div>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
          Se souvenir de moi sur cet appareil
        </span>
      </div>

      <Btn onClick={handleLookup} loading={loading} disabled={!email.trim()}>
        Continuer <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>

      <div style={{
        marginTop: 14, padding: '10px 14px', borderRadius: 10,
        background: 'rgba(107,159,255,0.05)', border: '1px solid rgba(107,159,255,0.1)',
        fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.35)',
        lineHeight: 1.6, textAlign: 'center',
      }}>
        Client existant ? Votre profil sera retrouvé automatiquement.<br />
        Première fois ? Un formulaire s'ouvrira pour créer votre compte.
      </div>
    </motion.div>
  );
}

// ─── Étape 1a — Formulaire complet (nouveau client) ───────────────────────────

function NewClientForm({ email, onNext }: {
  email: string;
  onNext: (data: {
    customer: Customer; transaction: Transaction;
    transfer: Transfer; phone: string; profile: SavedProfile;
  }) => void;
}) {
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    email_field: email, // pré-rempli depuis le lookup
    phone_us: '', birth_date: '',
    currency: 'USD' as FiatCurrency, amount_usd: '',
    payment_method: 'wire' as 'wire' | 'debit_card',
    beneficiary_phone: '', beneficiary_name: '',
  });
  const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const valid =
    form.first_name && form.last_name &&
    (email || form.email_field) &&
    form.phone_us && form.birth_date &&
    Number(form.amount_usd) >= (FIAT_META[form.currency]?.min ?? 10) &&
    form.beneficiary_phone && form.beneficiary_name;

  const handleSubmit = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const customer = await post('/customers', {
        first_name:         form.first_name,
        last_name:          form.last_name,
        email:              email || form.email_field,
        phone_country_code: 'US',
        phone_number:       form.phone_us,
        birth_date:         form.birth_date,
        description:        `NBK Finance — ${form.first_name} ${form.last_name}`,
      });

      const tx: Transaction = await post('/transactions', {
        type:          'on-ramp',
        from_currency: form.currency,
        to_currency:   'USDC',
        from_amount:   Number(form.amount_usd),
        phone:         form.beneficiary_phone,
        wallet_address: import.meta.env.VITE_PLATFORM_WALLET ?? '0x0000000000000000000000000000000000000000',
        network:       'polygon',
      });

      const transfer = await post(`/customers/${customer.harbor_uuid}/transfers`, {
        amount:            form.amount_usd,
        currency:          form.currency,
        payment_method:    form.payment_method,
        network:           'polygon',
        reference:         tx.reference,
        beneficiary_phone: form.beneficiary_phone,
      });

      // Sauvegarder le profil en localStorage
      const profile: SavedProfile = {
        harbor_uuid:    customer.harbor_uuid,
        kyc_status:     customer.kyc_status,
        agreement_link: customer.agreement_link,
        kyc_link:       customer.kyc_link,
        first_name:     form.first_name,
        last_name:      form.last_name,
        email:          email || form.email_field,
        phone_us:       form.phone_us,
        birth_date:     form.birth_date,
        saved_at:       new Date().toISOString(),
      };
      saveProfile(profile);

      onNext({ customer, transaction: tx, transfer, phone: form.beneficiary_phone, profile });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Email en lecture seule */}
      <div style={{
        padding: '9px 13px', borderRadius: 10, marginBottom: 14,
        background: 'rgba(0,200,150,0.06)', border: '1px solid rgba(0,200,150,0.15)',
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--teal)',
      }}>
        ✉ {email}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
        <Field label="Prénom" icon={<User style={{ width: 11, height: 11 }} />}>
          <Input placeholder="Jean" value={form.first_name} onChange={set('first_name')} />
        </Field>
        <Field label="Nom" icon={<User style={{ width: 11, height: 11 }} />}>
          <Input placeholder="Dupont" value={form.last_name} onChange={set('last_name')} />
        </Field>
      </div>

      {/* Email — affiché uniquement si pas encore fourni via lookup */}
      {!email && (
        <Field label="Email" icon={<Mail style={{ width: 11, height: 11 }} />}>
          <Input type="email" placeholder="jean@email.com"
            value={form.email_field}
            onChange={e => setForm(f => ({ ...f, email_field: e.target.value }))} />
        </Field>
      )}

      <Field label="Téléphone (USA)" icon={<Phone style={{ width: 11, height: 11 }} />}>
        <Input type="tel" placeholder="555-555-1234" value={form.phone_us} onChange={set('phone_us')} />
      </Field>

      <Field label="Date de naissance" icon={<User style={{ width: 11, height: 11 }} />}>
        <Input type="date" value={form.birth_date} onChange={set('birth_date')}
          max={new Date(Date.now() - 18 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]} />
      </Field>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '6px 0 14px' }} />

      <Field label="Montant et devise" icon={<DollarSign style={{ width: 11, height: 11 }} />}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value as FiatCurrency }))}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: '10px', color: 'var(--text)',
              fontFamily: 'var(--font-display)', fontSize: 13, cursor: 'pointer', outline: 'none', flexShrink: 0,
            }}>
            {(Object.entries(FIAT_META) as [FiatCurrency, typeof FIAT_META[FiatCurrency]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.flag} {k}</option>
            ))}
          </select>
          <Input type="number" min={FIAT_META[form.currency]?.min ?? 10}
            placeholder={String(FIAT_META[form.currency]?.min ?? 10)}
            value={form.amount_usd} onChange={set('amount_usd')} />
        </div>
        {Number(form.amount_usd) > 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 5, fontFamily: 'var(--font-display)' }}>
            {FIAT_META[form.currency]?.symbol}{form.amount_usd} {form.currency}
            {' '}≈ {fmt(fcfaEstimate(Number(form.amount_usd), form.currency))} FCFA
          </div>
        )}
      </Field>

      <Field label="Numéro Mobile Money bénéficiaire" icon={<Phone style={{ width: 11, height: 11 }} />}>
        <Input type="tel" placeholder="+237 6XX XXX XXX" value={form.beneficiary_phone} onChange={set('beneficiary_phone')} />
      </Field>

      <Field label="Nom du bénéficiaire" icon={<User style={{ width: 11, height: 11 }} />}>
        <Input placeholder="Marie Dupont" value={form.beneficiary_name} onChange={set('beneficiary_name')} />
      </Field>

      <Field label="Méthode de paiement" icon={<DollarSign style={{ width: 11, height: 11 }} />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([
            { id: 'wire',       label: 'Virement Wire',  sub: 'ACH / Wire bancaire', flag: '🏦' },
            { id: 'debit_card', label: 'Carte de débit', sub: 'Visa Direct (USA)',   flag: '💳' },
          ] as const).map(m => (
            <button key={m.id} type="button"
              onClick={() => setForm(f => ({ ...f, payment_method: m.id }))}
              style={{
                padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: form.payment_method === m.id ? 'rgba(0,200,150,0.1)' : 'rgba(255,255,255,0.04)',
                outline: form.payment_method === m.id ? '1.5px solid var(--teal)' : '1px solid rgba(255,255,255,0.08)',
                textAlign: 'left', transition: 'all 0.15s',
              }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{m.flag}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: form.payment_method === m.id ? 'var(--teal)' : 'var(--text)' }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{m.sub}</div>
            </button>
          ))}
        </div>
        {form.payment_method === 'debit_card' && (
          <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(240,165,0,0.06)', border: '1px solid rgba(240,165,0,0.15)', fontFamily: 'var(--font-display)', fontSize: 11, color: '#F0A500' }}>
            ⚠ Carte de débit américaine uniquement (Visa Direct). Nécessite activation Harbor.
          </div>
        )}
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

// ─── Étape 1b — Formulaire rapide (client connu) ──────────────────────────────

function ReturningClientForm({ profile, customer, onNext, onReset }: {
  profile: SavedProfile;
  customer: Customer;
  onNext: (data: {
    transaction: Transaction; transfer: Transfer; phone: string;
  }) => void;
  onReset: () => void;
}) {
  const [form, setForm] = useState({
    currency:          'USD' as FiatCurrency,
    amount_usd:        '',
    payment_method:    'wire' as 'wire' | 'debit_card',
    beneficiary_phone: '',
    beneficiary_name:  '',
  });
  const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const valid =
    Number(form.amount_usd) >= (FIAT_META[form.currency]?.min ?? 10) &&
    form.beneficiary_phone && form.beneficiary_name;

  const handleSubmit = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      const tx: Transaction = await post('/transactions', {
        type:           'on-ramp',
        from_currency:  form.currency,
        to_currency:    'USDC',
        from_amount:    Number(form.amount_usd),
        phone:          form.beneficiary_phone,
        wallet_address: import.meta.env.VITE_PLATFORM_WALLET ?? '0x0000000000000000000000000000000000000000',
        network:        'polygon',
      });

      const transfer = await post(`/customers/${customer.harbor_uuid}/transfers`, {
        amount:            form.amount_usd,
        currency:          form.currency,
        payment_method:    form.payment_method,
        network:           'polygon',
        reference:         tx.reference,
        beneficiary_phone: form.beneficiary_phone,
      });

      // Mettre à jour le profil sauvegardé
      saveProfile({ ...profile, kyc_status: customer.kyc_status, saved_at: new Date().toISOString() });

      onNext({ transaction: tx, transfer, phone: form.beneficiary_phone });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      {/* Profil client */}
      <div style={{
        padding: '13px 15px', borderRadius: 14, marginBottom: 18,
        background: 'rgba(0,200,150,0.06)', border: '1px solid rgba(0,200,150,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--teal)' }}>
            {profile.first_name} {profile.last_name}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            {profile.email}
          </div>
          <div style={{ marginTop: 4 }}>
            <span style={{
              padding: '2px 8px', borderRadius: 20, fontSize: 10, fontFamily: 'var(--font-display)', fontWeight: 700,
              background: customer.kyc_status === 'verified' ? 'rgba(0,200,150,0.15)' : 'rgba(240,165,0,0.15)',
              color: customer.kyc_status === 'verified' ? 'var(--teal)' : '#F0A500',
            }}>
              KYC {customer.kyc_status === 'verified' ? 'Vérifié ✓' : customer.kyc_status}
            </span>
          </div>
        </div>
        <button onClick={onReset}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.3)', fontSize: 11, fontFamily: 'var(--font-display)', padding: '4px 8px' }}>
          Changer
        </button>
      </div>

      <Field label="Montant et devise" icon={<DollarSign style={{ width: 11, height: 11 }} />}>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={form.currency}
            onChange={e => setForm(f => ({ ...f, currency: e.target.value as FiatCurrency }))}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10, padding: '10px', color: 'var(--text)',
              fontFamily: 'var(--font-display)', fontSize: 13, cursor: 'pointer', outline: 'none', flexShrink: 0,
            }}>
            {(Object.entries(FIAT_META) as [FiatCurrency, typeof FIAT_META[FiatCurrency]][]).map(([k, v]) => (
              <option key={k} value={k}>{v.flag} {k}</option>
            ))}
          </select>
          <Input type="number" min={FIAT_META[form.currency]?.min ?? 10}
            placeholder={String(FIAT_META[form.currency]?.min ?? 10)}
            value={form.amount_usd} onChange={set('amount_usd')} autoFocus />
        </div>
        {Number(form.amount_usd) > 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 5, fontFamily: 'var(--font-display)' }}>
            {FIAT_META[form.currency]?.symbol}{form.amount_usd} {form.currency}
            {' '}≈ {fmt(fcfaEstimate(Number(form.amount_usd), form.currency))} FCFA
          </div>
        )}
      </Field>

      <Field label="Numéro Mobile Money bénéficiaire" icon={<Phone style={{ width: 11, height: 11 }} />}>
        <Input type="tel" placeholder="+237 6XX XXX XXX" value={form.beneficiary_phone} onChange={set('beneficiary_phone')} />
      </Field>

      <Field label="Nom du bénéficiaire" icon={<User style={{ width: 11, height: 11 }} />}>
        <Input placeholder="Marie Dupont" value={form.beneficiary_name} onChange={set('beneficiary_name')} />
      </Field>

      <Field label="Méthode de paiement" icon={<DollarSign style={{ width: 11, height: 11 }} />}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {([
            { id: 'wire',       label: 'Virement Wire',  sub: 'ACH / Wire bancaire', flag: '🏦' },
            { id: 'debit_card', label: 'Carte de débit', sub: 'Visa Direct (USA)',   flag: '💳' },
          ] as const).map(m => (
            <button key={m.id} type="button"
              onClick={() => setForm(f => ({ ...f, payment_method: m.id }))}
              style={{
                padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: form.payment_method === m.id ? 'rgba(0,200,150,0.1)' : 'rgba(255,255,255,0.04)',
                outline: form.payment_method === m.id ? '1.5px solid var(--teal)' : '1px solid rgba(255,255,255,0.08)',
                textAlign: 'left', transition: 'all 0.15s',
              }}>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{m.flag}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, color: form.payment_method === m.id ? 'var(--teal)' : 'var(--text)' }}>{m.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>{m.sub}</div>
            </button>
          ))}
        </div>
      </Field>

      <Btn onClick={handleSubmit} disabled={!valid} loading={loading}>
        Envoyer <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>
    </motion.div>
  );
}

// ─── Étape KYC ────────────────────────────────────────────────────────────────

function KycStep({ customer, onNext }: { customer: Customer; onNext: () => void }) {
  const [status, setStatus]             = useState(customer.kyc_status);
  const [checking, setChecking]         = useState(false);
  const [agreementOpened, setAgrOpened] = useState(false);
  const [kycOpened, setKycOpened]       = useState(false);
  const isVerified = status === 'verified';

  useEffect(() => {
    if (!kycOpened && !agreementOpened) return;
    if (isVerified) return;
    const interval = setInterval(async () => {
      try {
        const res = await get(`/customers/${customer.harbor_uuid}`);
        setStatus(res.kyc_status);
        if (res.kyc_status === 'verified') {
          toast.success('Vérification confirmée ! ✓');
          // Mettre à jour le profil sauvegardé
          const saved = loadProfile();
          if (saved) saveProfile({ ...saved, kyc_status: 'verified' });
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
      else toast.info(`Statut : ${res.kyc_status}`);
    } catch (err: any) { toast.error(err.message); }
    finally { setChecking(false); }
  };

  const STATUS_INFO: Record<string, { label: string; color: string; hint: string }> = {
    deactivated: { label: 'En attente',      color: '#6B7280', hint: 'Signez l\'accord ci-dessus' },
    unfinished:  { label: 'KYC à compléter', color: '#F0A500', hint: 'Ouvrez le lien KYC' },
    finished:    { label: 'Soumis',          color: '#6B9FFF', hint: 'Harbor vérifie…' },
    verifying:   { label: 'Vérification…',   color: '#A78BFA', hint: '1-2 min en sandbox' },
    verified:    { label: 'Vérifié ✓',       color: '#00C896', hint: 'Prêt à transférer' },
    rejected:    { label: 'Rejeté',          color: '#F87171', hint: 'Vérifiez vos informations' },
  };
  const info = STATUS_INFO[status] ?? { label: status, color: '#888', hint: '' };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ marginBottom: 16 }}>
        {/* Étape 1 */}
        <div style={{ padding: '14px', borderRadius: 12, marginBottom: 8,
          background: agreementOpened ? 'rgba(0,200,150,0.05)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${agreementOpened ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.08)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: agreementOpened ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: agreementOpened ? '#070B14' : 'rgba(255,255,255,0.4)' }}>
              {agreementOpened ? '✓' : '1'}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>Signer l'accord Harbor</span>
          </div>
          <a href={customer.agreement_link} target="_blank" rel="noreferrer"
            onClick={() => setAgrOpened(true)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '9px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 9,
              textDecoration: 'none', color: 'var(--teal)', fontFamily: 'var(--font-display)', fontSize: 12 }}>
            Ouvrir l'accord <ExternalLink style={{ width: 13, height: 13 }} />
          </a>
        </div>

        {/* Étape 2 */}
        <div style={{ padding: '14px', borderRadius: 12, marginBottom: 8,
          background: kycOpened ? 'rgba(107,159,255,0.05)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${kycOpened ? 'rgba(107,159,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
          opacity: !agreementOpened ? 0.5 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              background: isVerified ? 'var(--teal)' : 'rgba(255,255,255,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: isVerified ? '#070B14' : 'rgba(255,255,255,0.4)' }}>
              {isVerified ? '✓' : '2'}
            </div>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13 }}>Vérifier votre identité (KYC)</span>
          </div>
          {customer.kyc_link ? (
            <a href={customer.kyc_link} target="_blank" rel="noreferrer"
              onClick={() => setKycOpened(true)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '9px 12px', background: 'rgba(255,255,255,0.05)', borderRadius: 9,
                textDecoration: 'none', color: '#6B9FFF', fontFamily: 'var(--font-display)', fontSize: 12,
                pointerEvents: !agreementOpened ? 'none' : 'auto' }}>
              Ouvrir la vérification KYC <ExternalLink style={{ width: 13, height: 13 }} />
            </a>
          ) : (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)', padding: '4px 0' }}>
              Disponible après signature de l'accord
            </div>
          )}
        </div>

        {/* Statut */}
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14,
          background: `${info.color}12`, border: `1px solid ${info.color}30`,
          display: 'flex', alignItems: 'center', gap: 10 }}>
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
          <RefreshCw style={{ width: 14, height: 14 }} /> Actualiser le statut
        </Btn>
      ) : (
        <Btn onClick={onNext}>
          Continuer <ArrowRight style={{ width: 15, height: 15 }} />
        </Btn>
      )}

      <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-display)' }}>
        Mise à jour automatique toutes les 5 secondes
      </p>
    </motion.div>
  );
}

// ─── Étape instructions paiement ──────────────────────────────────────────────

function InstructionsStep({ transfer, transaction, onNext }: {
  transfer: Transfer; transaction: Transaction; onNext: () => void;
}) {
  const isCard = transfer.payment_method === 'debit_card';
  const inst   = transfer.transfer_instructions ?? {};

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{
        padding: '14px', borderRadius: 14, marginBottom: 16,
        background: isCard ? 'rgba(107,159,255,0.06)' : 'rgba(0,200,150,0.06)',
        border: `1px solid ${isCard ? 'rgba(107,159,255,0.2)' : 'rgba(0,200,150,0.2)'}`,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, marginBottom: 4, color: isCard ? '#6B9FFF' : 'var(--teal)' }}>
          {isCard ? '💳 Paiement par carte de débit' : '🏦 Virement bancaire Wire / ACH'}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>
          {isCard
            ? 'Cliquez sur le bouton pour payer avec votre carte Visa Direct.'
            : 'Utilisez ces coordonnées pour votre virement depuis votre banque américaine.'}
        </div>
      </div>

      {isCard && transfer.card_payment_url && (
        <div style={{ marginBottom: 16 }}>
          <a href={transfer.card_payment_url} target="_blank" rel="noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '13px', borderRadius: 12, background: '#6B9FFF',
              color: '#fff', textDecoration: 'none',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, marginBottom: 10,
            }}>
            Payer avec ma carte Visa <ExternalLink style={{ width: 15, height: 15 }} />
          </a>
        </div>
      )}

      {!isCard && Object.entries(inst).map(([key, value]) => (
        <CopyRow key={key}
          label={key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
          value={value} />
      ))}

      <div style={{
        padding: '10px 14px', borderRadius: 10, marginTop: 8, marginBottom: 16,
        background: 'rgba(107,159,255,0.06)', border: '1px solid rgba(107,159,255,0.12)',
        fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6,
      }}>
        Référence : <strong style={{ color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
          {transaction.reference}
        </strong><br />
        Montant : <strong style={{ color: '#6B9FFF' }}>${transfer.expected_usdc} USDC</strong>
        {transfer.expected_fcfa > 0 && <> · {fmt(transfer.expected_fcfa)} FCFA</>}
      </div>

      <Btn onClick={onNext}>
        {isCard ? 'J\'ai payé avec ma carte' : 'J\'ai effectué le virement'} <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>
    </motion.div>
  );
}

// ─── Étape attente ────────────────────────────────────────────────────────────

function WaitingStep({ transaction, onDone }: {
  transaction: Transaction; onDone: (tx: Transaction) => void;
}) {
  const [tx, setTx]       = useState(transaction);
  const [expanded, setExp] = useState(false);

  const HARBOR_LABELS: Record<string, string> = {
    pending_customer_transfer_start: 'En attente de votre virement',
    pending_harbor:                  'Harbor traite votre paiement…',
    completed:                       'USDC reçus ✓',
    reject:                          'Rejeté par Harbor',
    expired:                         'Expiré',
  };

  useEffect(() => {
    const socket = io();
    socket.emit('subscribe', tx.reference);
    socket.on('tx_update', ({ reference, status }: { reference: string; status: string }) => {
      if (reference === tx.reference) {
        const updated = { ...tx, status };
        setTx(updated);
        if (status === 'completed') onDone(updated);
      }
    });
    return () => { socket.off('tx_update'); socket.disconnect(); };
  }, []);

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ textAlign: 'center', padding: '24px 0 20px' }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: 'rgba(107,159,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
        }}>
          <Clock style={{ width: 28, height: 28, color: '#6B9FFF' }} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          En attente de confirmation
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Harbor surveille votre virement. Délai habituel : 1-3 jours ouvrés.
        </div>
      </div>

      <div style={{ padding: '14px', background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--teal)' }}>
            {tx.reference}
          </span>
          <StatusBadge status={tx.status} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
          {tx.harbor_status ? (HARBOR_LABELS[tx.harbor_status] ?? tx.harbor_status) : 'Transfer Harbor en cours…'}
        </div>
      </div>

      <button onClick={() => setExp(v => !v)}
        style={{ width: '100%', padding: '10px', borderRadius: 10,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          fontFamily: 'var(--font-display)', fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
        Que se passe-t-il ensuite ?
        {expanded ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderRadius: '0 0 10px 10px',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
              borderTop: 'none', fontFamily: 'var(--font-display)', fontSize: 12,
              color: 'rgba(255,255,255,0.4)', lineHeight: 1.8 }}>
              1. Harbor confirme la réception de votre virement USD<br />
              2. Les USDC sont envoyés sur le wallet NBK Finance<br />
              3. L'équipe NBK envoie les FCFA sur le Mobile Money du bénéficiaire<br />
              4. Confirmation par email
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Étape succès ─────────────────────────────────────────────────────────────

function DoneStep({ transaction, phone, onNewTransfer }: {
  transaction: Transaction; phone: string; onNewTransfer: () => void;
}) {
  const { copied, copy } = useCopy(transaction.reference);

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          transition={{ type: 'spring', delay: 0.1 }}
          style={{ width: 64, height: 64, borderRadius: '50%',
            background: 'rgba(0,200,150,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
          <CheckCircle2 style={{ width: 30, height: 30, color: 'var(--teal)' }} />
        </motion.div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, marginBottom: 8 }}>
          USDC reçus par NBK Finance ✓
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6 }}>
          Les FCFA seront envoyés sur le numéro {phone} sous peu.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>RÉFÉRENCE</div>
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

      <Btn onClick={onNewTransfer}>
        Nouveau transfert <ArrowRight style={{ width: 15, height: 15 }} />
      </Btn>
    </motion.div>
  );
}

// ─── App principale ───────────────────────────────────────────────────────────

export default function App() {
  const [step,        setStep]        = useState<Step>('lookup');
  const [customer,    setCustomer]    = useState<Customer | null>(null);
  const [savedProfile,setProfile]     = useState<SavedProfile | null>(null);
  const [isReturning, setIsReturning] = useState(false);
  const [emailInput,  setEmailInput]  = useState('');
  const [transfer,    setTransfer]    = useState<Transfer | null>(null);
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [phone,       setPhone]       = useState('');

  // Réinitialiser pour un nouveau transfert (garde le profil)
  const resetToTransfer = () => {
    setStep('transfer');
    setTransfer(null);
    setTransaction(null);
    setPhone('');
  };

  // Réinitialiser complètement (changer de compte)
  const fullReset = () => {
    setStep('lookup');
    setCustomer(null);
    setProfile(null);
    setIsReturning(false);
    setEmailInput('');
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

      <nav style={{ width: '100%', maxWidth: 480, display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <Logo />
        <div style={{ padding: '4px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
          fontFamily: 'var(--font-display)', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
          Sandbox
        </div>
      </nav>

      <div style={{ width: '100%', maxWidth: 480,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 24, padding: '24px' }}>

        {step !== 'lookup' && <StepIndicator step={step} />}

        <AnimatePresence mode="wait">

          {/* Étape 0 — Lookup */}
          {step === 'lookup' && (
            <LookupStep key="lookup"
              onNewClient={() => setStep('form')}
              onReturningClient={(profile, cust) => {
                setProfile(profile);
                setCustomer(cust);
                setEmailInput(profile.email);
                setIsReturning(true);
                // Si KYC déjà vérifié → formulaire rapide directement
                if (cust.kyc_status === 'verified') {
                  setStep('transfer');
                } else {
                  // KYC non terminé → reprendre là où on s'était arrêté
                  setStep('kyc');
                }
              }}
            />
          )}

          {/* Étape 1a — Nouveau client */}
          {step === 'form' && !isReturning && (
            <NewClientForm key="form" email={emailInput || ''}
              onNext={({ customer: c, transaction: tx, transfer: tr, phone: p, profile }) => {
                setCustomer(c); setTransaction(tx); setTransfer(tr); setPhone(p);
                setProfile(profile);
                if (c.kyc_status === 'verified') setStep('instructions');
                else setStep('kyc');
              }}
            />
          )}

          {/* Étape 1b — Client connu : formulaire rapide montant */}
          {step === 'transfer' && savedProfile && customer && (
            <ReturningClientForm key="transfer"
              profile={savedProfile} customer={customer}
              onNext={({ transaction: tx, transfer: tr, phone: p }) => {
                setTransaction(tx); setTransfer(tr); setPhone(p);
                if (customer.kyc_status === 'verified') setStep('instructions');
                else setStep('kyc');
              }}
              onReset={fullReset}
            />
          )}

          {/* Étape KYC */}
          {step === 'kyc' && customer && (
            <KycStep key="kyc" customer={customer}
              onNext={() => {
                // Mettre à jour le statut KYC du customer
                setCustomer(c => c ? { ...c, kyc_status: 'verified' } : c);
                setStep('instructions');
              }}
            />
          )}

          {/* Étape instructions paiement */}
          {step === 'instructions' && transfer && transaction && (
            <InstructionsStep key="instructions"
              transfer={transfer} transaction={transaction}
              onNext={() => setStep('waiting')}
            />
          )}

          {/* Étape attente */}
          {step === 'waiting' && transaction && (
            <WaitingStep key="waiting" transaction={transaction}
              onDone={tx => { setTransaction(tx); setStep('done'); }}
            />
          )}

          {/* Étape succès */}
          {step === 'done' && transaction && (
            <DoneStep key="done" transaction={transaction}
              phone={phone} onNewTransfer={resetToTransfer}
            />
          )}

        </AnimatePresence>
      </div>

      <p style={{ marginTop: 20, fontFamily: 'var(--font-display)', fontSize: 11,
        color: 'rgba(255,255,255,0.15)', textAlign: 'center' }}>
        NBK Finance · IPerCash · Sécurisé par OwlPay Harbor
      </p>
    </div>
  );
}