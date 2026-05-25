// server/lib/database.types.ts
// Auto-généré depuis supabase/migrations/001_init.sql
// Re-générer avec : npx supabase gen types typescript --project-id <ref> > server/lib/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ─── Enum mirrors ──────────────────────────────────────────────
export type TxStatus  = 'pending' | 'processing' | 'completing' | 'completed' | 'failed' | 'expired';
export type TxType    = 'on-ramp' | 'off-ramp' | 'swap';
// ⚠ Amoy remplace Mumbai depuis mars 2024
export type TxNetwork = 'polygon' | 'ethereum' | 'amoy';

// ─── Row types ────────────────────────────────────────────────
export interface TransactionRow {
  id:                string;          // uuid
  reference:         string;          // LR-XXXXXX
  phone_hash:        string | null;   // SHA-256 hex
  wallet_address:    string | null;   // lowercase 0x…
  type:              TxType;
  from_currency:     string;          // 'FCFA' | 'USDC' | 'USDT' | 'USD'
  to_currency:       string;
  from_amount:       number;
  to_amount:         number;
  rate:              number;
  status:            TxStatus;
  error_message:     string | null;
  network:           TxNetwork | null;
  tx_hash:           string | null;
  owlpay_reference:  string | null;
  owlpay_status:     string | null;
  metadata:          Json;
  created_at:        string;          // ISO 8601
  updated_at:        string;
}

export interface TransactionInsert {
  reference:         string;
  phone_hash?:       string | null;
  wallet_address?:   string | null;
  type:              TxType;
  from_currency:     string;
  to_currency:       string;
  from_amount:       number;
  to_amount:         number;
  rate:              number;
  status?:           TxStatus;
  error_message?:    string | null;
  network?:          TxNetwork | null;
  tx_hash?:          string | null;
  owlpay_reference?: string | null;
  owlpay_status?:    string | null;
  metadata?:         Json;
}

export interface TransactionUpdate {
  status?:           TxStatus;
  error_message?:    string | null;
  network?:          TxNetwork | null;
  tx_hash?:          string | null;
  owlpay_reference?: string | null;
  owlpay_status?:    string | null;
  metadata?:         Json;
  updated_at?:       string;
}

export interface RateRow {
  pair:       string;   // e.g. 'USDC_FCFA'
  value:      number;
  source:     string;
  fetched_at: string;
}

// ─── Supabase Database type (used by createClient<Database>) ──
export type Database = {
  public: {
    Tables: {
      transactions: {
        Row:    TransactionRow;
        Insert: TransactionInsert;
        Update: TransactionUpdate;
      };
      rates: {
        Row:    RateRow;
        Insert: { pair: string; value: number; source: string; fetched_at?: string };
        Update: { value?: number; source?: string; fetched_at?: string };
      };
    };
    Views:     { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      tx_status:  TxStatus;
      tx_type:    TxType;
      tx_network: TxNetwork;
    };
    CompositeTypes: { [_ in never]: never };
  };
};
