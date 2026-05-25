/**
 * server/lib/rates.ts
 *
 * Taux de change multi-devises :
 *   - CoinGecko  : USDC/USDT prix en USD
 *   - ExchangeRate-API : USD → XAF, EUR, GBP, CAD, CHF
 *
 * Toutes les devises sont converties en USD en interne avant
 * d'être envoyées à Harbor (qui n'accepte que USD comme source).
 */
import { supabase } from './supabase.js';

// Devises fiat supportées côté utilisateur
export type FiatCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'CHF';
export const SUPPORTED_FIATS: FiatCurrency[] = ['USD', 'EUR', 'GBP', 'CAD', 'CHF'];

// Infos affichage par devise
export const FIAT_META: Record<FiatCurrency, { symbol: string; label: string; flag: string }> = {
  USD: { symbol: '$',  label: 'Dollar américain',  flag: '🇺🇸' },
  EUR: { symbol: '€',  label: 'Euro',               flag: '🇪🇺' },
  GBP: { symbol: '£',  label: 'Livre sterling',     flag: '🇬🇧' },
  CAD: { symbol: 'CA$', label: 'Dollar canadien',   flag: '🇨🇦' },
  CHF: { symbol: 'Fr', label: 'Franc suisse',       flag: '🇨🇭' },
};

export interface Rates {
  // USD → crypto
  USD_USDC: number;
  USD_USDT: number;
  // Crypto → USD
  USDC_USD: number;
  USDT_USD: number;
  // USD → FCFA
  USD_FCFA: number;
  FCFA_USD: number;
  // Crypto → FCFA
  USDC_FCFA: number;
  USDT_FCFA: number;
  FCFA_USDC: number;
  FCFA_USDT: number;
  // Autres devises → USD (pour conversion Harbor)
  EUR_USD: number;
  GBP_USD: number;
  CAD_USD: number;
  CHF_USD: number;
  // Autres devises → FCFA (pour affichage estimé)
  EUR_FCFA: number;
  GBP_FCFA: number;
  CAD_FCFA: number;
  CHF_FCFA: number;
  [key: string]: number;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchCryptoRates(): Promise<{ usdc_usd: number; usdt_usd: number }> {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=usd-coin,tether&vs_currencies=usd',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  return {
    usdc_usd: data['usd-coin']?.usd ?? 1,
    usdt_usd: data['tether']?.usd ?? 1,
  };
}

async function fetchFxRates(): Promise<Record<string, number>> {
  const key = process.env.EXCHANGERATE_API_KEY;
  if (!key) {
    console.warn('[rates] EXCHANGERATE_API_KEY absent — taux de fallback utilisés');
    // Taux de fallback approximatifs
    return { XAF: 606, EUR: 0.92, GBP: 0.79, CAD: 1.36, CHF: 0.90 };
  }
  // Récupérer tous les taux depuis USD en une seule requête
  const res = await fetch(
    `https://v6.exchangerate-api.com/v6/${key}/latest/USD`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`ExchangeRate-API ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success') throw new Error(`ExchangeRate-API: ${data['error-type']}`);
  return data.conversion_rates as Record<string, number>;
}

// ─── Build rates object ───────────────────────────────────────────────────────

export async function fetchRates(): Promise<Rates> {
  const [crypto, fx] = await Promise.all([fetchCryptoRates(), fetchFxRates()]);

  const usdToXaf = fx['XAF'] ?? 606;
  // Taux FIAT→USD (inverse du taux USD→FIAT)
  const eurToUsd = 1 / (fx['EUR'] ?? 0.92);
  const gbpToUsd = 1 / (fx['GBP'] ?? 0.79);
  const cadToUsd = 1 / (fx['CAD'] ?? 1.36);
  const chfToUsd = 1 / (fx['CHF'] ?? 0.90);

  const usdcFcfa = crypto.usdc_usd * usdToXaf;
  const usdtFcfa = crypto.usdt_usd * usdToXaf;

  return {
    // USD ↔ crypto
    USD_USDC:  1 / crypto.usdc_usd,
    USD_USDT:  1 / crypto.usdt_usd,
    USDC_USD:  crypto.usdc_usd,
    USDT_USD:  crypto.usdt_usd,
    // USD ↔ FCFA
    USD_FCFA:  usdToXaf,
    FCFA_USD:  1 / usdToXaf,
    // Crypto ↔ FCFA
    USDC_FCFA: usdcFcfa,
    USDT_FCFA: usdtFcfa,
    FCFA_USDC: 1 / usdcFcfa,
    FCFA_USDT: 1 / usdtFcfa,
    // Autres devises → USD
    EUR_USD: eurToUsd,
    GBP_USD: gbpToUsd,
    CAD_USD: cadToUsd,
    CHF_USD: chfToUsd,
    // Autres devises → FCFA (pour estimation affichage)
    EUR_FCFA: eurToUsd * usdToXaf,
    GBP_FCFA: gbpToUsd * usdToXaf,
    CAD_FCFA: cadToUsd * usdToXaf,
    CHF_FCFA: chfToUsd * usdToXaf,
  };
}

// ─── Persist to Supabase ──────────────────────────────────────────────────────

export async function refreshAndSaveRates(): Promise<Rates> {
  const rates = await fetchRates();

  const upserts = Object.entries(rates).map(([pair, value]) => ({
    pair,
    value,
    source: pair.includes('USDC') || pair.includes('USDT') ? 'coingecko+exchangerate-api' : 'exchangerate-api',
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await (supabase as any)
    .from('rates')
    .upsert(upserts, { onConflict: 'pair' });

  if (error) console.error('[rates] Supabase upsert error:', error.message);
  return rates;
}

// ─── Read from DB ─────────────────────────────────────────────────────────────

export async function getRatesFromDb(): Promise<Rates> {
  const { data, error } = await (supabase as any).from('rates').select('pair, value');
  if (error || !data?.length) {
    console.warn('[rates] DB vide — fetch direct');
    return fetchRates();
  }
  const map: Record<string, number> = {};
  for (const row of data) map[row.pair] = Number(row.value);
  return map as unknown as Rates;
}

// ─── Conversion helper ────────────────────────────────────────────────────────

/**
 * Convertit un montant en devise source vers USD.
 * Harbor n'acceptant que USD comme source, toutes les devises
 * passent par cette conversion avant d'être envoyées à Harbor.
 */
export function toUSD(amount: number, currency: FiatCurrency, rates: Rates): number {
  if (currency === 'USD') return amount;
  const key = `${currency}_USD` as keyof Rates;
  const rate = rates[key];
  if (!rate) throw new Error(`Taux ${currency}_USD introuvable`);
  return Math.round(amount * rate * 100) / 100; // arrondi à 2 décimales
}

/**
 * Estime le montant FCFA reçu par le bénéficiaire.
 */
export function toFCFA(amount: number, currency: FiatCurrency, rates: Rates): number {
  const key = `${currency}_FCFA` as keyof Rates;
  const rate = rates[key] ?? rates[`${currency}_USD`] * rates['USD_FCFA'];
  return Math.round(amount * rate);
}