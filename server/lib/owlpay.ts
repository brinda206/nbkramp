/**
 * OwlPay API Client
 *
 * Flexible adapter for both Mobile Money collection (on-ramp) and
 * disbursement (off-ramp). Adjust endpoint paths to match your dashboard.
 *
 * OwlPay docs: check https://docs.owlpay.io or your merchant dashboard.
 */
import crypto from 'crypto';

const BASE_URL  = process.env.OWLPAY_BASE_URL!;
const API_KEY   = process.env.OWLPAY_API_KEY!;
const SECRET    = process.env.OWLPAY_SECRET!;
const MERCHANT  = process.env.OWLPAY_MERCHANT_ID!;

if (!BASE_URL || !API_KEY || !SECRET || !MERCHANT) {
  console.warn('[OwlPay] Missing env vars — payment calls will fail');
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CollectRequest {
  reference:   string;  // your unique transaction reference
  amount:      number;  // in FCFA (integer)
  phone:       string;  // E.164 format: +2376XXXXXXXX
  currency:    'XAF';   // FCFA = XAF
  description: string;
  callback_url: string; // your webhook endpoint
}

export interface DisburseRequest {
  reference:    string;
  amount:       number;   // in FCFA
  phone:        string;
  currency:     'XAF';
  description:  string;
  callback_url: string;
}

export interface OwlPayResponse {
  success:    boolean;
  reference:  string;        // OwlPay's own reference
  status:     string;        // 'pending' | 'processing' | 'success' | 'failed'
  message?:   string;
  data?:      Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sign(payload: string): string {
  return crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex');
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<T> {
  const timestamp = Date.now().toString();
  const bodyStr   = body ? JSON.stringify(body) : '';
  const signature = sign(`${timestamp}${method}${path}${bodyStr}`);

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type':     'application/json',
      'X-Api-Key':        API_KEY,
      'X-Merchant-Id':    MERCHANT,
      'X-Timestamp':      timestamp,
      'X-Signature':      signature,
    },
    body: body ? bodyStr : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OwlPay ${method} ${path} → ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initiate a Mobile Money collection (FCFA → platform).
 * Customer will receive a payment prompt on their phone.
 */
export async function initiateCollection(req: CollectRequest): Promise<OwlPayResponse> {
  // TODO: verify endpoint path in your OwlPay dashboard
  return request<OwlPayResponse>('POST', '/collections', {
    merchant_id:  MERCHANT,
    reference:    req.reference,
    amount:       req.amount,
    phone:        req.phone,
    currency:     req.currency,
    description:  req.description,
    callback_url: req.callback_url,
  });
}

/**
 * Disburse FCFA via Mobile Money (platform → customer).
 * Used for off-ramp: after crypto is locked in escrow, send FCFA.
 */
export async function initiateDisbursement(req: DisburseRequest): Promise<OwlPayResponse> {
  // TODO: verify endpoint path in your OwlPay dashboard
  return request<OwlPayResponse>('POST', '/disbursements', {
    merchant_id:  MERCHANT,
    reference:    req.reference,
    amount:       req.amount,
    phone:        req.phone,
    currency:     req.currency,
    description:  req.description,
    callback_url: req.callback_url,
  });
}

/**
 * Check status of any OwlPay transaction by reference.
 */
export async function getStatus(owlpayReference: string): Promise<OwlPayResponse> {
  return request<OwlPayResponse>('GET', `/transactions/${owlpayReference}`);
}

/**
 * Verify that an incoming webhook actually came from OwlPay.
 */
export function verifyWebhookSignature(
  rawBody: string,
  receivedSignature: string
): boolean {
  const expected = sign(rawBody);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(receivedSignature)
  );
}
