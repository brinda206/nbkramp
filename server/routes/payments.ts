/**
 * server/routes/payments.ts
 *
 * Routes OwlPay :
 *   POST /api/payments/collect   — On-ramp : déclenche collecte Mobile Money
 *   POST /api/payments/disburse  — Off-ramp : envoie FCFA après dépôt escrow
 *   POST /api/payments/webhook   — OwlPay nous notifie du statut de paiement
 */
import { Router, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase';
import {
  initiateCollection,
  initiateDisbursement,
  verifyWebhookSignature,
} from '../lib/owlpay';
import type { Server as SocketServer } from 'socket.io';
import { releaseOffRampTokens, refundOffRampTokens, type Network as EscrowNetwork } from '../lib/escrow';
import { deliverOnRampTokens, type Network as OnRampNetwork, type Stable } from '../lib/onramp';
import { getRatesFromDb } from '../lib/rates';

export function createPaymentRouter(io: SocketServer) {
  const router = Router();

  // ─── POST /api/payments/collect ─────────────────────────────────────────────
  router.post('/collect', async (req: Request, res: Response) => {
    const { reference, phone, amount } = req.body;

    if (!reference || !phone || !amount) {
      return res.status(400).json({ error: 'reference, phone, amount requis' });
    }

    const { data: tx, error: txErr } = await (supabase as any)
      .from('transactions')
      .select('id, status, from_currency, from_amount')
      .eq('reference', reference)
      .single();

    if (txErr || !tx) return res.status(404).json({ error: 'Transaction introuvable' });
    if (tx.status !== 'pending') return res.status(409).json({ error: `Statut invalide : ${tx.status}` });
    if (!['FCFA', 'USD'].includes(tx.from_currency)) {
      return res.status(400).json({ error: 'Pas une transaction fiat-source' });
    }

    try {
      const rates = await getRatesFromDb();
      const amountXaf = tx.from_currency === 'USD'
        ? Math.round(Number(amount) * rates.USD_FCFA)
        : Math.round(amount);

      const result = await initiateCollection({
        reference,
        amount:       amountXaf,
        phone,
        currency:     'XAF',
        description:  `NBK Ramp — Échange ${reference}`,
        callback_url: `${process.env.APP_URL}/api/payments/webhook`,
      });

      await (supabase as any)
        .from('transactions')
        .update({
          owlpay_reference: result.reference,
          owlpay_status:    result.status,
          status:           'processing',
        })
        .eq('reference', reference);

      res.json({ success: true, owlpay_reference: result.reference, status: result.status });
    } catch (err: any) {
      console.error('[collect]', err.message);
      await (supabase as any)
        .from('transactions')
        .update({ status: 'failed', error_message: err.message })
        .eq('reference', reference);
      res.status(502).json({ error: err.message });
    }
  });

  // ─── POST /api/payments/disburse ────────────────────────────────────────────
  router.post('/disburse', async (req: Request, res: Response) => {
    const { reference, phone } = req.body;

    if (!reference || !phone) {
      return res.status(400).json({ error: 'reference, phone requis' });
    }

    const { data: tx, error: txErr } = await (supabase as any)
      .from('transactions')
      .select('id, status, to_currency, to_amount, tx_hash')
      .eq('reference', reference)
      .single();

    if (txErr || !tx)              return res.status(404).json({ error: 'Transaction introuvable' });
    if (tx.to_currency !== 'FCFA') return res.status(400).json({ error: 'Pas une transaction à destination FCFA' });
    if (!tx.tx_hash)               return res.status(400).json({ error: 'Dépôt on-chain non encore confirmé' });
    if (tx.status !== 'processing') return res.status(409).json({ error: `Statut invalide : ${tx.status}` });

    try {
      const result = await initiateDisbursement({
        reference,
        amount:       Math.round(Number(tx.to_amount)),
        phone,
        currency:     'XAF',
        description:  `NBK Ramp — Paiement ${reference}`,
        callback_url: `${process.env.APP_URL}/api/payments/webhook`,
      });

      await (supabase as any)
        .from('transactions')
        .update({ owlpay_reference: result.reference, owlpay_status: result.status })
        .eq('reference', reference);

      res.json({ success: true, owlpay_reference: result.reference, status: result.status });
    } catch (err: any) {
      console.error('[disburse]', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // ─── POST /api/payments/webhook ─────────────────────────────────────────────
  // OwlPay nous notifie du changement de statut.
  // rawBody est capturé avant express.json() dans server/index.ts.
  router.post('/webhook', async (req: Request, res: Response) => {
    // Vérification signature (si fournie par OwlPay)
    const signature = req.headers['x-owlpay-signature'] as string | undefined;
    const rawBody   = (req as any).rawBody as string | undefined;

    if (signature && rawBody) {
      if (!verifyWebhookSignature(rawBody, signature)) {
        console.warn('[webhook] Signature OwlPay invalide — requête rejetée');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { reference, status, transaction_id } = req.body;
    console.log(`[webhook] OwlPay ref=${transaction_id ?? reference} status=${status}`);

    // Mapping des statuts OwlPay → nos statuts internes
    const STATUS_MAP: Record<string, string> = {
      'success':    'completed',
      'successful': 'completed',
      'completed':  'completed',
      'failed':     'failed',
      'cancelled':  'failed',
      'expired':    'expired',
      'processing': 'processing',
      'pending':    'processing',
    };

    const ourStatus = STATUS_MAP[status?.toLowerCase()] ?? 'processing';
    const owlpayRef = transaction_id ?? reference;

    // Récupérer la transaction
    const { data: tx, error } = await (supabase as any)
      .from('transactions')
      .select('reference, type, from_currency, to_currency, to_amount, wallet_address, network, status')
      .eq('owlpay_reference', owlpayRef)
      .single();

    if (error || !tx) {
      console.error('[webhook] Transaction non trouvée pour owlpay_reference:', owlpayRef);
      return res.status(200).json({ received: true, found: false });
    }

    // ── Guard anti-replay ────────────────────────────────────────────────────
    // 'completing' = action on-chain en cours, 'completed'/'failed'/'expired' = terminal
    const TERMINAL_STATUSES = ['completed', 'failed', 'expired', 'completing'];
    const isTerminal = TERMINAL_STATUSES.includes(tx.status);

    if (isTerminal) {
      console.log(`[webhook] ${tx.reference} déjà dans état terminal (${tx.status}) — ignoré`);
      return res.status(200).json({ received: true, reference: tx.reference, status: tx.status });
    }

    // ── Marquer 'completing' pour bloquer les replays concurrents ────────────
    if (ourStatus === 'completed') {
      await (supabase as any)
        .from('transactions')
        .update({ status: 'completing', updated_at: new Date().toISOString() })
        .eq('owlpay_reference', owlpayRef)
        .eq('status', tx.status); // optimistic lock
    }

    let finalStatus                  = ourStatus;
    let actionError: string | null   = null;
    let onRampTransferTxHash: string | undefined;

    try {
      const txNetwork = tx.network as EscrowNetwork | OnRampNetwork | null;
      if (!txNetwork) throw new Error('network requis pour la finalisation');

      if (tx.type === 'off-ramp') {
        if (finalStatus === 'completed') {
          await releaseOffRampTokens(tx.reference, txNetwork as EscrowNetwork);
        } else if (finalStatus === 'failed' || finalStatus === 'expired') {
          await refundOffRampTokens(tx.reference, txNetwork as EscrowNetwork);
        }
      }

      if (tx.type === 'on-ramp' && finalStatus === 'completed') {
        if (!tx.wallet_address) throw new Error('wallet_address requis pour l\'on-ramp');
        const stable: Stable = tx.to_currency === 'USDC' ? 'USDC' : 'USDT';
        onRampTransferTxHash = await deliverOnRampTokens({
          reference:   tx.reference,
          network:     txNetwork as OnRampNetwork,
          stable,
          amountHuman: Number(tx.to_amount),
          destination: tx.wallet_address,
        });
      }
    } catch (err: any) {
      finalStatus = 'failed';
      actionError = err?.message ?? 'Action de finalisation échouée';
      console.error(`[webhook] Action échouée pour ${tx.reference}:`, actionError);
    }

    // Mise à jour finale
    const updatePayload: any = {
      owlpay_status: status,
      status:        finalStatus,
      updated_at:    new Date().toISOString(),
    };
    if (actionError)          updatePayload.error_message = actionError;
    if (onRampTransferTxHash) updatePayload.tx_hash       = onRampTransferTxHash;

    const { error: updateError } = await (supabase as any)
      .from('transactions')
      .update(updatePayload)
      .eq('owlpay_reference', owlpayRef);

    if (updateError) {
      console.error('[webhook] Update error:', updateError.message);
    }

    // Notifier les clients connectés en temps réel
    io.to(`tx:${tx.reference}`).emit('tx_update', { reference: tx.reference, status: finalStatus });
    io.emit('tx_update', { reference: tx.reference, status: finalStatus });

    console.log(`[webhook] Transaction ${tx.reference} → ${finalStatus}`);
    res.status(200).json({ received: true, reference: tx.reference, status: finalStatus });
  });

  return router;
}
