/**
 * server/routes/transactions.ts
 *
 * CRUD transactions :
 *   GET  /api/transactions          — par phone ou wallet
 *   GET  /api/transactions/:ref     — par référence
 *   POST /api/transactions          — créer une transaction pending
 *   PATCH /api/transactions/:ref/tx-hash — soumettre le hash on-chain
 */
import { Router, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase';
import { getRatesFromDb } from '../lib/rates';
import crypto from 'crypto';

export const txRouter = Router();

// Référence courte lisible : LR-XXXXXX
function generateReference(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let ref = 'LR-';
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)];
  return ref;
}

// Hash SHA-256 du numéro de téléphone (jamais stocké en clair)
function hashPhone(phone: string): string {
  return crypto.createHash('sha256').update(phone.trim().toLowerCase()).digest('hex');
}

// ─── GET /api/transactions ────────────────────────────────────────────────────
txRouter.get('/', async (req: Request, res: Response) => {
  const { phone, wallet } = req.query as Record<string, string>;

  if (!phone && !wallet) {
    return res.status(400).json({ error: 'Fournissez phone ou wallet en query parameter' });
  }

  let query = supabase
    .from('transactions')
    .select('id, reference, type, from_currency, to_currency, from_amount, to_amount, rate, status, network, tx_hash, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (phone)  query = query.eq('phone_hash', hashPhone(phone));
  if (wallet) query = query.eq('wallet_address', wallet.toLowerCase());

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json(data ?? []);
});

// ─── GET /api/transactions/:reference ────────────────────────────────────────
txRouter.get('/:reference', async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference', req.params.reference.toUpperCase())
    .single();

  if (error || !data) return res.status(404).json({ error: 'Transaction introuvable' });
  res.json(data);
});

// ─── POST /api/transactions ───────────────────────────────────────────────────
txRouter.post('/', async (req: Request, res: Response) => {
  const {
    type,
    from_currency,
    to_currency,
    from_amount,
    phone,
    wallet_address,
    network,
  } = req.body;

  // ── Validation de base ──────────────────────────────────────
  if (!type || !from_currency || !to_currency || !from_amount) {
    return res.status(400).json({ error: 'type, from_currency, to_currency, from_amount requis' });
  }
  if (Number(from_amount) <= 0) {
    return res.status(400).json({ error: 'from_amount doit être > 0' });
  }

  // Devises fiat supportées (toutes converties en USD avant Harbor)
  const SUPPORTED_FIATS = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'FCFA'];
  const isFiat   = (c: string) => SUPPORTED_FIATS.includes(c);
  const isCrypto = (c: string) => c === 'USDC' || c === 'USDT';

  // Opérations supportées :
  // - On-ramp  : USD/EUR/GBP/CAD/CHF/FCFA → USDC/USDT
  // - Off-ramp : USDC/USDT → FCFA
  const expectedType =
    isFiat(from_currency)   && isCrypto(to_currency)  ? 'on-ramp'  :
    isCrypto(from_currency) && to_currency === 'FCFA' ? 'off-ramp' :
    null;

  if (!expectedType) {
    return res.status(400).json({
      error: `Paire ${from_currency}→${to_currency} non supportée. ` +
             `On-ramp : USD/EUR/GBP/CAD/CHF/FCFA→USDC/USDT. Off-ramp : USDC/USDT→FCFA.`,
    });
  }

  if (!phone)          return res.status(400).json({ error: 'phone requis' });
  if (!wallet_address) return res.status(400).json({ error: 'wallet_address requis' });
  if (!network)        return res.status(400).json({ error: 'network requis' });

  // Valider le réseau — amoy remplace mumbai
  const VALID_NETWORKS = ['polygon', 'ethereum', 'amoy'];
  if (!VALID_NETWORKS.includes(network)) {
    return res.status(400).json({
      error: `Réseau invalide : ${network}. Réseaux autorisés : ${VALID_NETWORKS.join(', ')}`,
    });
  }

  // ── Calcul du to_amount depuis les taux réels ───────────────
  let to_amount: number;
  let rate: number;
  try {
    const rates = await getRatesFromDb();
    // Pour les devises non-USD, on passe par USD comme pivot
    // EUR→USDC = EUR→USD * USD→USDC
    let rateKey = `${from_currency}_${to_currency}`;
    rate = (rates as unknown as Record<string, number>)[rateKey];

    if (!rate && from_currency !== 'USD' && from_currency !== 'FCFA') {
      // Conversion pivot : FIAT→USD→USDC
      const toUsdRate   = (rates as unknown as Record<string, number>)[`${from_currency}_USD`];
      const usdToCrypto = (rates as unknown as Record<string, number>)[`USD_${to_currency}`];
      if (toUsdRate && usdToCrypto) {
        rate = toUsdRate * usdToCrypto;
      }
    }

    if (!rate) throw new Error(`Pas de taux pour ${from_currency}→${to_currency}`);
    to_amount = Number(from_amount) * rate;
  } catch (err: any) {
    return res.status(503).json({ error: `Taux indisponible : ${err.message}` });
  }

  // ── Génération d'une référence unique ────────────────────────
  let reference = generateReference();
  for (let i = 0; i < 5; i++) {
    const { data: existing } = await (supabase as any)
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .single();
    if (!existing) break;
    reference = generateReference();
  }

  // ── Insert en base ───────────────────────────────────────────
  const { data, error } = await (supabase as any)
    .from('transactions')
    .insert({
      reference,
      phone_hash:     phone ? hashPhone(phone) : null,
      wallet_address: wallet_address ? wallet_address.toLowerCase() : null,
      type:           expectedType,
      from_currency,
      to_currency,
      from_amount:    Number(from_amount),
      to_amount,
      rate,
      status:         'pending',
      network,
      metadata: {
        phone_prefix: phone ? phone.slice(0, 6) : null,
      },
    })
    .select()
    .single();

  if (error) {
    console.error('[POST /transactions]', error.message);
    return res.status(500).json({ error: error.message });
  }

  res.status(201).json(data);
});

// ─── PATCH /api/transactions/:reference/tx-hash ───────────────────────────────
// Appelé par le frontend après soumission on-chain (off-ramp)
txRouter.patch('/:reference/tx-hash', async (req: Request, res: Response) => {
  const { tx_hash, network } = req.body;

  if (!tx_hash) return res.status(400).json({ error: 'tx_hash requis' });
  if (!/^0x[a-fA-F0-9]{64}$/.test(tx_hash)) {
    return res.status(400).json({ error: 'tx_hash invalide — doit être un hash EVM de 32 bytes' });
  }

  const { data, error } = await (supabase as any)
    .from('transactions')
    .update({ tx_hash, network, status: 'processing', updated_at: new Date().toISOString() })
    .eq('reference', req.params.reference.toUpperCase())
    .select()
    .single();

  if (error || !data) return res.status(404).json({ error: 'Transaction introuvable' });
  res.json(data);
});