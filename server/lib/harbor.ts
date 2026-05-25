/**
 * server/lib/harbor.ts — version multi-devises
 *
 * CHANGEMENTS :
 *   - createOnRampTransfer() accepte maintenant n'importe quelle devise source
 *   - Le réseau destination est choisi automatiquement selon HARBOR_ENV :
 *       sandbox/test → polygon (frais bas, idéal pour les tests)
 *       production   → ethereum (liquidité maximale)
 *   - CHF ajouté comme devise supportée
 */
import crypto from 'crypto';

const ENV    = process.env.HARBOR_ENV ?? 'sandbox';
const BASE   = ENV === 'production'
  ? 'https://harbor.owlpay.com/api/v1'
  : 'https://harbor-sandbox.owlpay.com/api/v1';

// Réseau automatique selon l'environnement — invisible pour l'utilisateur
export const AUTO_NETWORK = ENV === 'production' ? 'ethereum' : 'polygon';

const API_KEY        = process.env.HARBOR_API_KEY        ?? '';
const WEBHOOK_SECRET = process.env.HARBOR_WEBHOOK_SECRET ?? '';

if (!API_KEY)        console.warn('[harbor] HARBOR_API_KEY manquant');
if (!WEBHOOK_SECRET) console.warn('[harbor] HARBOR_WEBHOOK_SECRET manquant');

// ─── Devises source supportées par Harbor pour l'on-ramp ─────────────────────
// Harbor ne fait l'on-ramp qu'en USD nativement.
// EUR, GBP, CAD, CHF sont convertis en USD dans notre backend avant envoi.
export type HarborSourceCurrency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'CHF';

// ─── Statuts ──────────────────────────────────────────────────────────────────

export type HarborCustomerStatus =
  | 'deactivated' | 'unfinished' | 'finished' | 'verifying'
  | 'verified' | 'rejected' | 'declined' | 'request_for_information';

export type HarborTransferStatus =
  | 'pending_customer_transfer_start' | 'pending_harbor' | 'completed'
  | 'reject' | 'cancelled' | 'expired' | 'refunded' | 'error';

export const HARBOR_ACTIVE_CUSTOMER_STATUSES: HarborCustomerStatus[] = ['verified'];
export const HARBOR_TERMINAL_TX_STATUSES: HarborTransferStatus[]     = [
  'completed', 'reject', 'cancelled', 'expired', 'refunded', 'error',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarborCustomer {
  uuid:                 string;
  status:               HarborCustomerStatus;
  type:                 'individual' | 'business';
  first_name:           string;
  last_name:            string;
  email:                string;
  has_signed_agreement: boolean;
  agreement_link:       string;
  kyc_link:             string | null;
  created_at:           string;
  updated_at:           string;
}

export interface HarborTransfer {
  uuid:                      string;
  status:                    HarborTransferStatus;
  on_behalf_of:              string;
  source:                    { asset: string; amount: string };
  destination:               { asset: string; chain?: string; address?: string; amount: string };
  transfer_instructions:     Record<string, string>;
  application_transfer_uuid: string;
  receipt: {
    initial_asset:    string;
    initial_amount:   string;
    final_asset:      string;
    final_amount:     string;
    exchange_rate:    string;
    commission_fee:   string;
    harbor_fee:       string;
    transaction_hash: string | null;
  };
  created_at: string;
}

export interface CreateCustomerParams {
  type:               'individual' | 'business';
  first_name:         string;
  last_name:          string;
  email:              string;
  phone_country_code: string;
  phone_number:       string;
  birth_date:         string;
  description?:       string;
}

export interface CreateTransferParams {
  customer_uuid:             string;
  application_transfer_uuid: string;
  // Montant et devise originaux (EUR, GBP, etc.)
  original_amount:           string;
  original_currency:         HarborSourceCurrency;
  // Montant converti en USD (toujours envoyé à Harbor)
  amount_usd:                string;
  destination_address:       string;
  transfer_purpose:          string;
  commission_percentage?:    string;
  commission_amount?:        string;
}

// Pixel PNG minimal — document de support requis par Harbor
const MINIMAL_SUPPORTING_DOC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOaCLP8AAAAASUVORK5CYII=';

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function request<T>(
  method:          'GET' | 'POST',
  path:            string,
  body?:           unknown,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept':       'application/json',
    'X-API-KEY':    API_KEY,
  };
  if (method !== 'GET') {
    headers['Idempotency-Key'] = idempotencyKey ?? crypto.randomUUID();
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body:   body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Harbor ${method} ${path} → ${res.status}: ${text}`);
  }

  const json = await res.json() as { data: T } | T;
  return (json as { data: T }).data ?? (json as T);
}

// ─── Customers ────────────────────────────────────────────────────────────────

export async function createCustomer(params: CreateCustomerParams): Promise<HarborCustomer> {
  return request<HarborCustomer>('POST', '/customers', params, crypto.randomUUID());
}

export async function getCustomer(customerUuid: string): Promise<HarborCustomer> {
  return request<HarborCustomer>('GET', `/customers/${customerUuid}`);
}

// ─── Transfers ────────────────────────────────────────────────────────────────

/**
 * Crée un on-ramp Harbor.
 *
 * Harbor reçoit TOUJOURS du USD comme source.
 * Si l'utilisateur envoie EUR/GBP/CAD/CHF, la conversion USD est faite
 * en amont dans customers.ts via toUSD() avant d'appeler cette fonction.
 *
 * Le réseau de destination (polygon/ethereum) est choisi automatiquement :
 *   - sandbox → polygon  (frais bas, parfait pour les tests)
 *   - production → ethereum (liquidité maximale, standard institutionnel)
 */
export async function createOnRampTransfer(params: CreateTransferParams): Promise<HarborTransfer> {
  const body: Record<string, unknown> = {
    on_behalf_of:              params.customer_uuid,
    application_transfer_uuid: params.application_transfer_uuid,
    source: {
      // Harbor n'accepte que USD — la conversion a été faite en amont
      asset:  'USD',
      amount: params.amount_usd,
    },
    destination: {
      asset:              'USDC',
      chain:              AUTO_NETWORK,   // polygon (test) ou ethereum (prod) — automatique
      address:            params.destination_address,
      transfer_purpose:   params.transfer_purpose,
      is_self_transfer:   false,
      supporting_document: MINIMAL_SUPPORTING_DOC,
    },
  };

  if (params.commission_percentage || params.commission_amount) {
    body.commission = {
      percentage: params.commission_percentage ?? '0',
      amount:     params.commission_amount     ?? '0',
    };
  }

  console.log(
    `[harbor] Transfer ${params.application_transfer_uuid} — ` +
    `${params.original_amount} ${params.original_currency} → ` +
    `${params.amount_usd} USD → USDC sur ${AUTO_NETWORK}`
  );

  return request<HarborTransfer>(
    'POST', '/transfers', body, params.application_transfer_uuid,
  );
}

export async function getTransfer(transferUuid: string): Promise<HarborTransfer> {
  return request<HarborTransfer>('GET', `/transfers/${transferUuid}`);
}

// ─── Simulation sandbox ───────────────────────────────────────────────────────

export async function simulatePaid(transferUuid: string): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('sandbox uniquement');
  await request('POST', `/transfers/${transferUuid}/simulate-paid`, {}, crypto.randomUUID());
}

export async function simulateCompleted(transferUuid: string): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('sandbox uniquement');
  await request('POST', `/transfers/${transferUuid}/simulate-completed`, {}, crypto.randomUUID());
}

export async function simulateTransferStatus(
  transferUuid: string,
  status: 'completed' | 'rejected' | 'expired',
): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('sandbox uniquement');
  const endpoint = status === 'completed' ? 'simulate-completed' : `simulate-${status}`;
  await request('POST', `/transfers/${transferUuid}/${endpoint}`, {}, crypto.randomUUID());
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export function verifyHarborWebhook(signedPayload: string, receivedV1: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('[harbor] WEBHOOK_SECRET absent — non vérifié (dev)');
    return true;
  }
  try {
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(receivedV1));
  } catch { return false; }
}

// ─── Wallet balance ───────────────────────────────────────────────────────────

export async function getWalletBalance(): Promise<{ asset: string; balance: string }[]> {
  return request<{ asset: string; balance: string }[]>('GET', '/wallets');
}