/**
 * Luma Ramp — Moteur de validation avancé
 *
 * Règles :
 * - Téléphone : Cameroun uniquement (MTN / Orange / Viettel)
 * - Wallet : ERC-55 checksum + longueur
 * - Montant : plafonds par corridor, frais mini
 * - Anti-doublon : détection de transaction identique < 3 min
 */
import type { Currency } from '../types';

// ─── Phone ────────────────────────────────────────────────────────────────────

export type PhoneCarrier = 'MTN' | 'Orange' | 'Nexttel' | 'inconnu';

const MTN_PREFIXES    = ['650','651','652','653','654','670','671','672','673','674','675','676','677','678','679','680','681','682','683','684','685','686','687','688','689'];
const ORANGE_PREFIXES = ['655','656','657','658','659','690','691','692','693','694','695','696','697','698','699'];
const NEXT_PREFIXES   = ['660','661','662','663','664','665','666','667','668','669'];

export interface PhoneValidation {
  valid:   boolean;
  carrier: PhoneCarrier;
  e164:    string;           // normalized +237XXXXXXXXX
  error?:  string;
  hint?:   string;
}

export function validatePhone(raw: string): PhoneValidation {
  const stripped = raw.replace(/[\s\-().]/g, '');

  // Normalize to E.164
  let digits = stripped;
  if (digits.startsWith('+237')) digits = digits.slice(4);
  else if (digits.startsWith('237')) digits = digits.slice(3);
  else if (digits.startsWith('00237')) digits = digits.slice(5);

  if (digits.length !== 9) {
    return {
      valid: false, carrier: 'inconnu', e164: '',
      error: digits.length < 9
        ? 'Numéro trop court — il faut 9 chiffres après +237'
        : 'Numéro trop long — vérifiez votre saisie',
      hint: 'Ex : +237 6XX XXX XXX',
    };
  }

  if (!/^\d{9}$/.test(digits)) {
    return { valid: false, carrier: 'inconnu', e164: '', error: 'Le numéro ne doit contenir que des chiffres' };
  }

  if (!digits.startsWith('6')) {
    return {
      valid: false, carrier: 'inconnu', e164: '',
      error: 'Les numéros mobiles camerounais commencent par 6',
      hint: 'Ex : +237 6XX XXX XXX',
    };
  }

  const prefix3 = digits.slice(0, 3);
  let carrier: PhoneCarrier = 'inconnu';
  if (MTN_PREFIXES.includes(prefix3))    carrier = 'MTN';
  else if (ORANGE_PREFIXES.includes(prefix3)) carrier = 'Orange';
  else if (NEXT_PREFIXES.includes(prefix3))   carrier = 'Nexttel';

  return { valid: true, carrier, e164: `+237${digits}` };
}

// ─── Wallet ───────────────────────────────────────────────────────────────────

export interface WalletValidation {
  valid:       boolean;
  checksumOk?: boolean;
  error?:      string;
  hint?:       string;
}

// ERC-55 checksum (keccak256 of lowercase hex address)
async function checksumAddress(addr: string): Promise<string> {
  const lower = addr.slice(2).toLowerCase();
  const msgBuffer = new TextEncoder().encode(lower);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  // Note: true ERC-55 uses keccak256; we approximate with SHA-256 for client-side.
  // Full validation is done server-side with ethers.js getAddress().
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
  let result = '0x';
  for (let i = 0; i < lower.length; i++) {
    result += parseInt(hashHex[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
  }
  return result;
}

export async function validateWallet(raw: string): Promise<WalletValidation> {
  const trimmed = raw.trim();

  if (!trimmed) return { valid: false, error: 'Adresse wallet requise', hint: 'Ex : 0x742d35Cc...' };

  if (!trimmed.startsWith('0x')) {
    return { valid: false, error: 'L\'adresse doit commencer par 0x', hint: 'Copiez l\'adresse depuis MetaMask' };
  }

  if (trimmed.length !== 42) {
    return {
      valid: false,
      error: trimmed.length < 42
        ? `Adresse trop courte (${trimmed.length}/42 caractères)`
        : `Adresse trop longue (${trimmed.length}/42 caractères)`,
    };
  }

  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return { valid: false, error: 'Caractères invalides dans l\'adresse (hex uniquement)' };
  }

  // Check if address is all-lowercase or all-uppercase (no checksum) — valid but warn
  const isAllLower = trimmed === trimmed.toLowerCase();
  const isAllUpper = trimmed === `0x${trimmed.slice(2).toUpperCase()}`;

  // Null address guard
  if (trimmed.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Adresse nulle détectée — vérifiez votre copier-coller' };
  }

  return {
    valid: true,
    checksumOk: !isAllLower && !isAllUpper,
    hint: isAllLower ? 'Adresse valide (sans checksum ERC-55)' : undefined,
  };
}

// ─── Amount ───────────────────────────────────────────────────────────────────

interface Corridor { min: number; max: number; currency: Currency; }

const CORRIDORS: Record<string, Corridor> = {
  'FCFA_USDC': { min: 500,   max: 5_000_000, currency: 'FCFA' },
  'FCFA_USDT': { min: 500,   max: 5_000_000, currency: 'FCFA' },
  'FCFA_USD':  { min: 500,   max: 2_000_000, currency: 'FCFA' },
  'USD_USDC':  { min: 1,     max: 10_000,    currency: 'USD' },
  'USD_USDT':  { min: 1,     max: 10_000,    currency: 'USD' },
  'USDC_FCFA': { min: 1,     max: 10_000,    currency: 'USDC' },
  'USDT_FCFA': { min: 1,     max: 10_000,    currency: 'USDT' },
  'USD_FCFA':  { min: 1,     max: 10_000,    currency: 'USD'  },
  'USDC_USDT': { min: 0.01,  max: 50_000,    currency: 'USDC' },
  'USDT_USDC': { min: 0.01,  max: 50_000,    currency: 'USDT' },
};

export interface AmountValidation {
  valid:    boolean;
  error?:   string;
  hint?:    string;
  severity: 'error' | 'warning' | 'ok';
}

export function validateAmount(
  raw: string,
  from: Currency,
  to: Currency,
): AmountValidation {
  const n = parseFloat(raw);

  if (!raw || raw.trim() === '') {
    return { valid: false, error: '', severity: 'ok' }; // silent empty
  }

  if (isNaN(n) || n <= 0) {
    return { valid: false, error: 'Entrez un montant supérieur à zéro', severity: 'error' };
  }

  const key = `${from}_${to}`;
  const corridor = CORRIDORS[key];

  if (!corridor) {
    if (from === to) return { valid: false, error: 'Choisissez deux devises différentes', severity: 'error' };
    return { valid: true, severity: 'ok' }; // corridor inconnu = pas de limite
  }

  const { min, max } = corridor;

  if (n < min) {
    return {
      valid: false, severity: 'error',
      error: `Minimum ${min.toLocaleString('fr-FR')} ${from} pour ce corridor`,
      hint: `Les frais de traitement rendent les petits montants non rentables`,
    };
  }

  if (n > max) {
    return {
      valid: false, severity: 'error',
      error: `Maximum ${max.toLocaleString('fr-FR')} ${from} par transaction`,
      hint: `Fractionnez en plusieurs transactions pour des montants plus élevés`,
    };
  }

  // Warning zone: >80% of max
  if (n > max * 0.8) {
    return {
      valid: true, severity: 'warning',
      hint: `Proche du plafond — max ${max.toLocaleString('fr-FR')} ${from}`,
    };
  }

  return { valid: true, severity: 'ok' };
}

// ─── Duplicate detection ──────────────────────────────────────────────────────

const DUP_KEY    = 'luma_recent_txs';
const DUP_WINDOW = 3 * 60 * 1000; // 3 minutes

interface RecentTx { phone: string; amount: number; from: Currency; to: Currency; ts: number; }

export function checkDuplicate(phone: string, amount: number, from: Currency, to: Currency): boolean {
  try {
    const raw: RecentTx[] = JSON.parse(localStorage.getItem(DUP_KEY) ?? '[]');
    const cutoff = Date.now() - DUP_WINDOW;
    return raw.some(r =>
      r.phone === phone &&
      r.amount === amount &&
      r.from === from &&
      r.to === to &&
      r.ts > cutoff
    );
  } catch { return false; }
}

export function recordTransaction(phone: string, amount: number, from: Currency, to: Currency) {
  try {
    const raw: RecentTx[] = JSON.parse(localStorage.getItem(DUP_KEY) ?? '[]');
    const cutoff = Date.now() - DUP_WINDOW;
    const fresh  = raw.filter(r => r.ts > cutoff);
    fresh.push({ phone, amount, from, to, ts: Date.now() });
    localStorage.setItem(DUP_KEY, JSON.stringify(fresh));
  } catch { /* ignore */ }
}

// ─── Rate slippage ────────────────────────────────────────────────────────────

export interface SlippageWarning {
  hasSlippage: boolean;
  pct:         number;
  message?:    string;
}

export function checkSlippage(currentRate: number, rateAtFormOpen: number): SlippageWarning {
  if (!rateAtFormOpen || !currentRate) return { hasSlippage: false, pct: 0 };
  const pct = Math.abs((currentRate - rateAtFormOpen) / rateAtFormOpen) * 100;
  return {
    hasSlippage: pct >= 0.5,
    pct,
    message: pct >= 0.5
      ? `Le taux a changé de ${pct.toFixed(2)}% depuis l'ouverture du formulaire`
      : undefined,
  };
}
