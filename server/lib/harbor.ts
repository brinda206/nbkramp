/**
 * server/lib/harbor.ts
 *
 * Adapter OwlPay Harbor — On-ramp multi-devises → USDC
 * Docs : https://harbor-developers.owlpay.com/docs/getting-started-1
 *
 * ════════════════════════════════════════════════════════
 * FLUX
 * ════════════════════════════════════════════════════════
 *   1. createCustomer()          → KYC client (diaspora USA)
 *   2. createOnRampTransfer()    → initie Wire/ACH ou carte de débit
 *   3. webhook                   → Harbor confirme réception USD + envoi USDC
 *   4. verifyHarborWebhook()     → vérifie signature HMAC-SHA256
 *
 * ════════════════════════════════════════════════════════
 * DEVISES SOURCE SUPPORTÉES
 * ════════════════════════════════════════════════════════
 *   Harbor n'accepte que USD nativement.
 *   EUR / GBP / CAD / CHF sont convertis en USD dans customers.ts
 *   via toUSD() avant d'être envoyés ici.
 *
 * ════════════════════════════════════════════════════════
 * MÉTHODES DE PAIEMENT
 * ════════════════════════════════════════════════════════
 *   - 'wire'       : Virement bancaire Wire / ACH (défaut)
 *   - 'debit_card' : Carte de débit US via Visa Direct
 *                    (nécessite activation Harbor — avril 2026)
 *
 * ════════════════════════════════════════════════════════
 * RÉSEAU DESTINATION (automatique, invisible utilisateur)
 * ════════════════════════════════════════════════════════
 *   - sandbox    → polygon  (frais bas, testnets)
 *   - production → ethereum (liquidité maximale)
 *
 * ════════════════════════════════════════════════════════
 * VARIABLES .env REQUISES
 * ════════════════════════════════════════════════════════
 *   HARBOR_API_KEY=...
 *   HARBOR_WEBHOOK_SECRET=whs_...
 *   HARBOR_ENV=sandbox   # 'sandbox' ou 'production'
 *   PLATFORM_WALLET=0x...
 */
import crypto from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const ENV    = process.env.HARBOR_ENV ?? 'sandbox';
const BASE   = ENV === 'production'
  ? 'https://harbor.owlpay.com/api/v1'
  : 'https://harbor-sandbox.owlpay.com/api/v1';

/**
 * Réseau blockchain destination — choisi automatiquement selon l'environnement.
 * Invisible pour l'utilisateur final.
 *   sandbox    → polygon  (MATIC testnet Amoy, frais quasi nuls)
 *   production → ethereum (liquidité USDC maximale, standard institutionnel)
 */
export const AUTO_NETWORK = ENV === 'production' ? 'ethereum' : 'polygon';

const API_KEY        = process.env.HARBOR_API_KEY        ?? '';
const WEBHOOK_SECRET = process.env.HARBOR_WEBHOOK_SECRET ?? '';

if (!API_KEY)        console.warn('[harbor] HARBOR_API_KEY manquant dans .env');
if (!WEBHOOK_SECRET) console.warn('[harbor] HARBOR_WEBHOOK_SECRET manquant dans .env');

// ─── Statuts Customer Harbor ──────────────────────────────────────────────────

/**
 * Progression normale : deactivated → unfinished → finished → verifying → verified
 */
export type HarborCustomerStatus =
  | 'deactivated'              // compte créé, accord non signé
  | 'unfinished'               // accord signé, KYC non complété
  | 'finished'                 // KYC soumis, en attente vérification
  | 'verifying'                // vérification Harbor en cours (1-2 min sandbox)
  | 'verified'                 // ✅ actif — peut effectuer des transfers
  | 'rejected'                 // rejeté, peut resoumettre
  | 'declined'                 // refusé définitivement
  | 'request_for_information'; // Harbor demande des informations supplémentaires

/**
 * Progression Wire : pending_customer_transfer_start → pending_harbor → completed
 * Progression carte : pending_customer_transfer_start → completed (direct)
 */
export type HarborTransferStatus =
  | 'pending_customer_transfer_start' // attend le virement / paiement carte
  | 'pending_harbor'                  // Harbor traite le paiement Wire
  | 'completed'                       // ✅ USDC envoyés sur le wallet destination
  | 'reject'                          // rejeté par Harbor (AML, limite, etc.)
  | 'cancelled'                       // annulé
  | 'expired'                         // délai de paiement dépassé
  | 'refunded'                        // remboursé au client
  | 'error';                          // erreur technique Harbor

/** Méthodes de paiement supportées */
export type PaymentMethod = 'wire' | 'debit_card';

/** Statut customer autorisant les transfers */
export const HARBOR_ACTIVE_CUSTOMER_STATUSES: HarborCustomerStatus[] = ['verified'];

/** Statuts transfer terminaux — plus d'action possible */
export const HARBOR_TERMINAL_TX_STATUSES: HarborTransferStatus[] = [
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
  kyc_link:             string | null;  // lien vers le formulaire KYC Harbor
  created_at:           string;
  updated_at:           string;
}

export interface HarborTransfer {
  uuid:                      string;
  status:                    HarborTransferStatus;
  payment_method:            PaymentMethod;
  on_behalf_of:              string;
  source:                    { asset: string; amount: string; payment_method?: string };
  destination:               { asset: string; chain?: string; address?: string; amount: string };
  // Wire : coordonnées bancaires à afficher à l'utilisateur
  transfer_instructions?:    Record<string, string>;
  // Carte de débit : URL Harbor à ouvrir dans le navigateur
  card_payment_url?:         string | null;
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
  phone_country_code: string;  // ex: 'US'
  phone_number:       string;  // ex: '555-555-1234'
  birth_date:         string;  // format: 'YYYY-MM-DD' — requis par Harbor pour individual
  description?:       string;
}

export interface CreateTransferParams {
  customer_uuid:             string;
  application_transfer_uuid: string;   // référence NBK (LR-XXXXXX) — idempotency key
  // Devise et montant originaux (pour logs et traçabilité)
  original_amount:           string;   // ex: '50' (EUR)
  original_currency:         string;   // ex: 'EUR'
  // Montant USD envoyé à Harbor (conversion faite en amont dans customers.ts)
  amount_usd:                string;   // ex: '54.45'
  destination_address:       string;   // PLATFORM_WALLET qui reçoit les USDC
  transfer_purpose:          string;   // ex: 'family_support'
  payment_method?:           PaymentMethod;  // 'wire' (défaut) | 'debit_card'
  commission_percentage?:    string;   // ex: '0.01' = 1% de commission NBK
  commission_amount?:        string;   // ex: '1.00' USD fixe
}

// ─── Document de support minimal (requis par Harbor) ─────────────────────────
// Pixel PNG 1×1 en base64 — Harbor l'exige dans le body destination
// pour les transfers sans compte pré-enregistré.
const MINIMAL_SUPPORTING_DOC =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOaCLP8AAAAASUVORK5CYII=';

// ─── Données de test carte (sandbox uniquement) ───────────────────────────────
export const VISA_TEST_CARD = {
  number: '4111 1111 1111 1111',
  expiry: '12/30',
  cvv:    '123',
  zip:    '12345',
  note:   'Carte Visa de test — Harbor sandbox uniquement',
};

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

  // Idempotency-Key obligatoire pour tous les POST
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

  // Harbor enveloppe les réponses dans { data: ... }
  const json = await res.json() as { data: T } | T;
  return (json as { data: T }).data ?? (json as T);
}

// ─── Customers (KYC) ──────────────────────────────────────────────────────────

/**
 * Crée un customer Harbor (utilisateur diaspora USA).
 * Retourne uuid + agreement_link (à signer) + kyc_link (formulaire KYC).
 *
 * ⚠ birth_date obligatoire pour type 'individual' (Harbor validation 422 sinon).
 */
export async function createCustomer(params: CreateCustomerParams): Promise<HarborCustomer> {
  return request<HarborCustomer>('POST', '/customers', params, crypto.randomUUID());
}

/**
 * Récupère le statut KYC actuel d'un customer.
 * Appelé en polling toutes les 5s jusqu'à status === 'verified'.
 */
export async function getCustomer(customerUuid: string): Promise<HarborCustomer> {
  return request<HarborCustomer>('GET', `/customers/${customerUuid}`);
}

// ─── Transfers (On-ramp USD → USDC) ──────────────────────────────────────────

/**
 * Initie un on-ramp Harbor : USD → USDC.
 *
 * Harbor reçoit TOUJOURS 'USD' comme source.asset.
 * Les devises EUR/GBP/CAD/CHF sont converties en USD en amont
 * dans customers.ts via la fonction toUSD() de rates.ts.
 *
 * Méthodes de paiement :
 *   wire       → Harbor retourne transfer_instructions (coordonnées bancaires Wire/ACH)
 *   debit_card → Harbor retourne card_payment_url (lien Visa Direct)
 *                ⚠ Nécessite activation Harbor (Visa Direct, disponible depuis avril 2026)
 *
 * Réseau destination :
 *   sandbox    → polygon  (Amoy testnet)
 *   production → ethereum (mainnet)
 *   Choix automatique via AUTO_NETWORK, invisible pour l'utilisateur.
 */
export async function createOnRampTransfer(params: CreateTransferParams): Promise<HarborTransfer> {
  const paymentMethod = params.payment_method ?? 'wire';

  const body: Record<string, unknown> = {
    on_behalf_of:              params.customer_uuid,
    application_transfer_uuid: params.application_transfer_uuid,
    source: {
      asset:          'USD',
      amount:         params.amount_usd,
      // payment_method dans source — Harbor route vers Wire ou Visa Direct
      payment_method: paymentMethod,
    },
    destination: {
      asset:               'USDC',
      chain:               AUTO_NETWORK,
      address:             params.destination_address,
      transfer_purpose:    params.transfer_purpose,
      is_self_transfer:    false,
      supporting_document: MINIMAL_SUPPORTING_DOC,
    },
  };

  // Commission optionnelle NBK Finance
  if (params.commission_percentage || params.commission_amount) {
    body.commission = {
      percentage: params.commission_percentage ?? '0',
      amount:     params.commission_amount     ?? '0',
    };
  }

  console.log(
    `[harbor] Transfer ${params.application_transfer_uuid} — ` +
    `${params.original_amount} ${params.original_currency}` +
    ` → ${params.amount_usd} USD → USDC` +
    ` (${paymentMethod}) sur ${AUTO_NETWORK}`
  );

  // Idempotency key = référence NBK → double appel = même résultat, pas de doublon
  return request<HarborTransfer>(
    'POST', '/transfers', body, params.application_transfer_uuid,
  );
}

/**
 * Récupère le statut et les détails d'un transfer par son UUID Harbor.
 */
export async function getTransfer(transferUuid: string): Promise<HarborTransfer> {
  return request<HarborTransfer>('GET', `/transfers/${transferUuid}`);
}

// ─── Simulation sandbox ───────────────────────────────────────────────────────

/**
 * SANDBOX — Étape 1 Wire : simule que le client a fait son virement.
 * Transition : pending_customer_transfer_start → pending_harbor
 *
 * Non nécessaire pour debit_card (Harbor traite directement via Visa Direct).
 */
export async function simulatePaid(transferUuid: string): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('[harbor] simulatePaid : sandbox uniquement');
  await request('POST', `/transfers/${transferUuid}/simulate-paid`, {}, crypto.randomUUID());
  console.log(`[harbor] simulate-paid → ${transferUuid}`);
}

/**
 * SANDBOX — Étape 2 : simule que Harbor a envoyé les USDC.
 * Transition : pending_harbor → completed
 * → Déclenche l'envoi du webhook transfer.status.completed
 */
export async function simulateCompleted(transferUuid: string): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('[harbor] simulateCompleted : sandbox uniquement');
  await request('POST', `/transfers/${transferUuid}/simulate-completed`, {}, crypto.randomUUID());
  console.log(`[harbor] simulate-completed → ${transferUuid}`);
}

/**
 * SANDBOX — Simule un rejet ou une expiration.
 * Utile pour tester les cas d'erreur.
 */
export async function simulateTransferStatus(
  transferUuid: string,
  status: 'completed' | 'rejected' | 'expired',
): Promise<void> {
  if (ENV !== 'sandbox') throw new Error('[harbor] simulateTransferStatus : sandbox uniquement');
  const endpoint = status === 'completed'
    ? 'simulate-completed'
    : `simulate-${status}`;
  await request('POST', `/transfers/${transferUuid}/${endpoint}`, {}, crypto.randomUUID());
  console.log(`[harbor] simulate-${status} → ${transferUuid}`);
}

// ─── Vérification webhook ─────────────────────────────────────────────────────

/**
 * Vérifie la signature HMAC-SHA256 d'un webhook Harbor.
 *
 * Header Harbor : 'harbor-signature: t=TIMESTAMP,v1=HASH'
 * Payload signé = TIMESTAMP + "." + rawBody JSON
 *
 * Docs : https://harbor-developers.owlpay.com/docs/verifying-requests-from-harbor
 */
export function verifyHarborWebhook(signedPayload: string, receivedV1: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('[harbor] WEBHOOK_SECRET absent — signature non vérifiée (dev)');
    return true; // permissif en développement local
  }
  try {
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(signedPayload)
      .digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(receivedV1),
    );
  } catch {
    return false;
  }
}

// ─── Wallet balance (liquidité) ───────────────────────────────────────────────

/**
 * Récupère le solde du wallet Harbor de la plateforme NBK.
 * Affiché dans le dashboard admin pour le suivi de liquidité USDC.
 */
export async function getWalletBalance(): Promise<{ asset: string; balance: string }[]> {
  return request<{ asset: string; balance: string }[]>('GET', '/wallets');
}