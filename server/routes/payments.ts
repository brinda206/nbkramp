/**
 * server/routes/payments.ts
 *
 * Dans le flux NBK Finance v3, le on-ramp est entièrement géré
 * par Harbor via server/routes/customers.ts.
 *
 * Ce fichier est conservé pour :
 *   - Le webhook Campay/IperCash (futur — paiement FCFA automatique)
 *   - Compatibilité avec server/index.ts qui l'importe
 *
 * Routes actives :
 *   POST /api/payments/webhook  — reçoit les notifications de paiement FCFA
 */
import { Router, type Request, type Response } from 'express';
import { supabase } from '../lib/supabase.js';
import type { Server as SocketServer } from 'socket.io';

export function createPaymentRouter(io: SocketServer) {
  const router = Router();

  // ─── POST /api/payments/webhook ─────────────────────────────────────────────
  // Reçoit les notifications de statut depuis Campay / IperCash.
  // Sera activé quand l'API de paiement FCFA sera intégrée.
  router.post('/webhook', async (req: Request, res: Response) => {
    const { reference, status, transaction_id } = req.body;
    const payRef = transaction_id ?? reference;

    console.log(`[payments/webhook] ref=${payRef} status=${status}`);

    if (!payRef || !status) {
      return res.status(400).json({ error: 'reference et status requis' });
    }

    // Mapping statuts → statuts internes NBK
    const STATUS_MAP: Record<string, string> = {
      'SUCCESSFUL': 'completed',
      'successful': 'completed',
      'success':    'completed',
      'FAILED':     'failed',
      'failed':     'failed',
      'PENDING':    'processing',
      'pending':    'processing',
    };
    const finalStatus = STATUS_MAP[status] ?? 'processing';

    // Chercher la transaction par campay_reference ou owlpay_reference
    const { data: tx } = await (supabase as any)
      .from('transactions')
      .select('reference, status')
      .or(`campay_reference.eq.${payRef},owlpay_reference.eq.${payRef}`)
      .single();

    if (!tx) {
      console.warn(`[payments/webhook] Transaction non trouvée pour ref=${payRef}`);
      return res.status(200).json({ received: true, found: false });
    }

    // Ne pas rejouer si déjà terminal
    if (['completed', 'failed', 'expired'].includes(tx.status)) {
      return res.status(200).json({ received: true, already_terminal: true });
    }

    await (supabase as any)
      .from('transactions')
      .update({ status: finalStatus, updated_at: new Date().toISOString() })
      .eq('reference', tx.reference);

    // Notifier le frontend en temps réel
    io.to(`tx:${tx.reference}`).emit('tx_update', { reference: tx.reference, status: finalStatus });
    io.emit('tx_update', { reference: tx.reference, status: finalStatus });

    console.log(`[payments/webhook] TX ${tx.reference} → ${finalStatus}`);
    res.status(200).json({ received: true, reference: tx.reference, status: finalStatus });
  });

  // ─── GET /api/payments/health ────────────────────────────────────────────────
  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      ok:     true,
      note:   'Paiement FCFA automatique — IperCash à intégrer',
      harbor: 'On-ramp Harbor géré via /api/customers',
    });
  });

  return router;
}