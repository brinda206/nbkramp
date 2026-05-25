import type { Transaction, Rates, Network, Currency, TxType } from '../types';

const BASE = import.meta.env.VITE_APP_URL ?? '';

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Rates ────────────────────────────────────────────────────────────────────
export const fetchRates = () => req<Rates>('GET', '/api/rates');

// ─── Transactions ─────────────────────────────────────────────────────────────
export const fetchTransactionsByPhone  = (phone: string)  => req<Transaction[]>('GET', `/api/transactions?phone=${encodeURIComponent(phone)}`);
export const fetchTransactionsByWallet = (wallet: string) => req<Transaction[]>('GET', `/api/transactions?wallet=${encodeURIComponent(wallet)}`);
export const fetchTransactionByRef     = (ref: string)    => req<Transaction>('GET', `/api/transactions/${ref}`);

export interface CreateTxPayload {
  type:          TxType;
  from_currency: Currency;
  to_currency:   Currency;
  from_amount:   number;
  phone?:        string;
  wallet_address?: string;
  network?:      Network;
}

export const createTransaction = (payload: CreateTxPayload) =>
  req<Transaction>('POST', '/api/transactions', payload);

export const submitTxHash = (reference: string, tx_hash: string, network: Network) =>
  req<Transaction>('PATCH', `/api/transactions/${reference}/tx-hash`, { tx_hash, network });

// ─── Payments ─────────────────────────────────────────────────────────────────
export const initiateCollect = (reference: string, phone: string, amount: number) =>
  req('POST', '/api/payments/collect', { reference, phone, amount });

export const initiateDisburse = (reference: string, phone: string) =>
  req('POST', '/api/payments/disburse', { reference, phone });
