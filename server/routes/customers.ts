/**
 * server/routes/customers.ts
 *
 * Gestion des customers Harbor + transactions multi-devises.
 *
 * ROUTES :
 *   POST /api/customers            — créer un nouveau customer (KYC Harbor)
 *   POST /api/customers/lookup     — retrouver un customer existant par email
 *   GET  /api/customers/:uuid      — statut KYC
 *   POST /api/customers/:uuid/transfers  — initier un transfer Harbor
 *   GET  /api/customers/wallet/balance   — solde USDC platform
 *   POST /api/customers/harbor-webhook  — événements Harbor
 *   POST /api/customers/simulate-paid/:id      — sandbox
 *   POST /api/customers/simulate-completed/:id — sandbox
 */
import { Router, type Request, type Response } from 'express';
import { supabase }              from '../lib/supabase.js';
import {
  createCustomer, getCustomer,
  createOnRampTransfer,
  simulatePaid, simulateCompleted, simulateTransferStatus,
  verifyHarborWebhook, getWalletBalance,
  HARBOR_ACTIVE_CUSTOMER_STATUSES,
  HARBOR_TERMINAL_TX_STATUSES,
  AUTO_NETWORK,
} from '../lib/harbor.js';
import { getRatesFromDb, toUSD, toFCFA, SUPPORTED_FIATS, type FiatCurrency } from '../lib/rates.js';
import type { Server as SocketServer } from 'socket.io';
import crypto from 'crypto';

export function createCustomerRouter(io: SocketServer) {
  const router = Router();

  // ─── POST /api/customers ────────────────────────────────────────────────────
  router.post('/', async (req: Request, res: Response) => {
    const {
      first_name, last_name, email,
      phone_country_code, phone_number,
      birth_date, description,
    } = req.body;

    if (!first_name || !last_name || !email || !phone_country_code || !phone_number || !birth_date) {
      return res.status(400).json({
        error: 'first_name, last_name, email, phone_country_code, phone_number, birth_date requis',
      });
    }

    try {
      const harborCustomer = await createCustomer({
        type: 'individual',
        first_name, last_name, email,
        phone_country_code, phone_number,
        birth_date, description,
      });

      const emailHash = crypto
        .createHash('sha256')
        .update(email.trim().toLowerCase())
        .digest('hex');

      await (supabase as any)
        .from('customers')
        .upsert({
          harbor_uuid:       harborCustomer.uuid,
          email_hash:        emailHash,
          first_name, last_name,
          kyc_status:        harborCustomer.status,
          agreement_link:    harborCustomer.agreement_link,
          verification_link: harborCustomer.kyc_link,
          updated_at:        new Date().toISOString(),
        }, { onConflict: 'harbor_uuid' });

      res.status(201).json({
        harbor_uuid:    harborCustomer.uuid,
        kyc_status:     harborCustomer.status,
        agreement_link: harborCustomer.agreement_link,
        kyc_link:       harborCustomer.kyc_link,
        instructions: [
          '1. Signez l\'accord via agreement_link',
          '2. Complétez le KYC via kyc_link',
          `3. Vérifiez le statut : GET /api/customers/${harborCustomer.uuid}`,
        ],
      });
    } catch (err: any) {
      console.error('[POST /customers]', err.message);
      res.status(502).json({ error: err.message });
    }
  });


  // ─── GET /api/customers/lookup?email=... ─────────────────────────────────────
  // Client connu qui revient : retrouver son profil par email.
  // Retourne harbor_uuid + statut KYC pour sauter le formulaire d'inscription.
  router.get('/lookup', async (req: Request, res: Response) => {
    const { email } = req.query as { email?: string };
    if (!email) return res.status(400).json({ error: 'email requis' });

    const emailHash = crypto
      .createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');

    const { data: customer, error } = await (supabase as any)
      .from('customers')
      .select('harbor_uuid, first_name, last_name, kyc_status, verification_link')
      .eq('email_hash', emailHash)
      .single();

    if (error || !customer) {
      return res.status(404).json({ found: false });
    }

    // Rafraîchir le statut KYC depuis Harbor (au cas où il aurait changé)
    let kycStatus  = customer.kyc_status;
    let kycLink    = customer.verification_link ?? null;
    let agreeLink  = null;

    try {
      const harborCustomer = await getCustomer(customer.harbor_uuid);
      kycStatus = harborCustomer.status;
      kycLink   = harborCustomer.kyc_link;
      agreeLink = harborCustomer.agreement_link;

      await (supabase as any)
        .from('customers')
        .update({ kyc_status: harborCustomer.status, updated_at: new Date().toISOString() })
        .eq('harbor_uuid', customer.harbor_uuid);
    } catch {
      // Harbor indisponible — on utilise le statut en DB
    }

    res.json({
      found:          true,
      harbor_uuid:    customer.harbor_uuid,
      first_name:     customer.first_name,
      last_name:      customer.last_name,
      kyc_status:     kycStatus,
      kyc_link:       kycLink,
      agreement_link: agreeLink,
    });
  });

  // ─── GET /api/customers/wallet/balance ────────────────────────────────────
  router.get('/wallet/balance', async (_req: Request, res: Response) => {
    try {
      const balances = await getWalletBalance();
      res.json({ balances, network: AUTO_NETWORK });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // ─── GET /api/customers/:uuid ───────────────────────────────────────────────
  router.get('/:uuid', async (req: Request, res: Response) => {
    try {
      const customer = await getCustomer(req.params.uuid);
      await (supabase as any)
        .from('customers')
        .update({ kyc_status: customer.status, updated_at: new Date().toISOString() })
        .eq('harbor_uuid', req.params.uuid);

      res.json({
        uuid:           customer.uuid,
        harbor_uuid:    customer.uuid,   // alias explicite pour le frontend
        kyc_status:     customer.status,
        status:         customer.status, // alias pour compatibilité
        can_transfer:   HARBOR_ACTIVE_CUSTOMER_STATUSES.includes(customer.status),
        kyc_link:       customer.kyc_link,
        agreement_link: customer.agreement_link,
      });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // ─── POST /api/customers/:uuid/transfers ───────────────────────────────────
  router.post('/:uuid/transfers', async (req: Request, res: Response) => {
    const {
      amount,
      currency = 'USD',
      reference,
      beneficiary_phone,
      payment_method = 'wire', // 'wire' | 'debit_card'
    } = req.body;

    // Validation devise
    if (!SUPPORTED_FIATS.includes(currency as FiatCurrency)) {
      return res.status(400).json({
        error: `Devise non supportée: ${currency}. Supportées: ${SUPPORTED_FIATS.join(', ')}`,
      });
    }

    if (!amount || !reference || !beneficiary_phone) {
      return res.status(400).json({
        error: 'amount, currency, reference, beneficiary_phone requis',
      });
    }

    // Vérifier KYC Harbor
    let harborCustomer;
    try {
      harborCustomer = await getCustomer(req.params.uuid);
    } catch {
      return res.status(404).json({ error: 'Customer Harbor introuvable' });
    }

    if (!HARBOR_ACTIVE_CUSTOMER_STATUSES.includes(harborCustomer.status)) {
      return res.status(409).json({
        error:    `KYC non finalisé. Statut: ${harborCustomer.status} — attendu: verified`,
        kyc_link: harborCustomer.kyc_link,
      });
    }

    const PLATFORM_WALLET = process.env.PLATFORM_WALLET ?? '';
    if (!PLATFORM_WALLET || PLATFORM_WALLET === '0xYourNBKWalletAddress') {
      return res.status(500).json({ error: 'PLATFORM_WALLET non configuré dans .env' });
    }

    try {
      const rates = await getRatesFromDb();

      // ── Conversion vers USD (Harbor n'accepte que USD) ──────────────────────
      const originalAmount   = Number(amount);
      const originalCurrency = currency as FiatCurrency;
      const amountUSD        = toUSD(originalAmount, originalCurrency, rates);
      const fcfaEstimate     = toFCFA(originalAmount, originalCurrency, rates);

      console.log(
        `[transfer] ${originalAmount} ${originalCurrency}` +
        ` → ${amountUSD} USD → USDC sur ${AUTO_NETWORK}`
      );

      // ── Créer le transfer Harbor ────────────────────────────────────────────
      const transfer = await createOnRampTransfer({
        customer_uuid:             req.params.uuid,
        application_transfer_uuid: reference,
        original_amount:           String(originalAmount),
        original_currency:         originalCurrency,
        amount_usd:                amountUSD.toFixed(2),
        destination_address:       PLATFORM_WALLET,
        transfer_purpose:          'family_support',
        payment_method:            payment_method as 'wire' | 'debit_card',
      });

      // ── Mettre à jour la transaction en base ────────────────────────────────
      await (supabase as any)
        .from('transactions')
        .update({
          harbor_transfer_uuid: transfer.uuid,
          harbor_status:        transfer.status,
          harbor_customer_uuid: req.params.uuid,
          status:               'processing',
          // Stocker la conversion pour traçabilité
          metadata: {
            beneficiary_phone,
            original_amount:   originalAmount,
            original_currency: originalCurrency,
            amount_usd:        amountUSD,
            expected_fcfa:     fcfaEstimate,
            destination_chain: AUTO_NETWORK,
            transfer_instructions: transfer.transfer_instructions,
          },
        })
        .eq('reference', reference.toUpperCase());

      // Pour le paiement carte, Harbor retourne card_payment_url au lieu de transfer_instructions
      const isCard = payment_method === 'debit_card';
      const harborTransfer = transfer as any;

      res.json({
        transfer_uuid:    transfer.uuid,
        status:           transfer.status,
        payment_method,
        // Wire : instructions bancaires
        transfer_instructions: harborTransfer.transfer_instructions,
        // Carte : URL de paiement Visa Direct
        card_payment_url: harborTransfer.card_payment_url ?? null,
        // Montants pour l'affichage
        original_amount:   originalAmount,
        original_currency: originalCurrency,
        amount_usd:        amountUSD,
        expected_usdc:     transfer.destination.amount,
        expected_fcfa:     fcfaEstimate,
        // Réseau — en arrière-plan, non affiché à l'utilisateur
        network:           AUTO_NETWORK,
        next_steps: [
          `sandbox : POST /api/customers/simulate-paid/${transfer.uuid}`,
          `sandbox : POST /api/customers/simulate-completed/${transfer.uuid}`,
        ],
      });
    } catch (err: any) {
      console.error('[POST /customers/:uuid/transfers]', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  // ─── Simulation sandbox ───────────────────────────────────────────────────
  router.post('/simulate-paid/:transferUuid', async (req: Request, res: Response) => {
    if (process.env.HARBOR_ENV !== 'sandbox') return res.status(403).json({ error: 'sandbox uniquement' });
    try {
      await simulatePaid(req.params.transferUuid);
      res.json({ simulated: true, status: 'pending_harbor',
        next_step: `POST /api/customers/simulate-completed/${req.params.transferUuid}` });
    } catch (err: any) { res.status(502).json({ error: err.message }); }
  });

  router.post('/simulate-completed/:transferUuid', async (req: Request, res: Response) => {
    if (process.env.HARBOR_ENV !== 'sandbox') return res.status(403).json({ error: 'sandbox uniquement' });
    try {
      await simulateCompleted(req.params.transferUuid);
      res.json({ simulated: true, status: 'completed',
        note: 'Harbor envoie le webhook transfer.status.completed' });
    } catch (err: any) { res.status(502).json({ error: err.message }); }
  });

  // ─── POST /api/customers/harbor-webhook ───────────────────────────────────
  router.post('/harbor-webhook', async (req: Request, res: Response) => {
    const rawSig  = req.headers['harbor-signature'] as string | undefined;
    const rawBody = (req as any).rawBody as string | undefined;

    if (rawSig && rawBody) {
      const parts = Object.fromEntries(
        rawSig.split(',').map(p => p.trim().split('=') as [string, string])
      );
      const timestamp = parts['t'];
      const v1        = parts['v1'];
      if (timestamp && v1) {
        if (!verifyHarborWebhook(`${timestamp}.${rawBody}`, v1)) {
          console.warn('[harbor-webhook] Signature invalide');
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const { event, data } = req.body;
    console.log(`[harbor-webhook] event=${event} uuid=${data?.uuid}`);

    // ── KYC events ────────────────────────────────────────────────────────────
    if (event?.startsWith('customer.')) {
      await (supabase as any)
        .from('customers')
        .update({ kyc_status: data?.status, updated_at: new Date().toISOString() })
        .eq('harbor_uuid', data?.uuid);
      return res.status(200).json({ received: true, event });
    }

    // ── Transfer events ───────────────────────────────────────────────────────
    if (event?.startsWith('transfer.')) {
      const harborStatus = data?.status;

      const { data: tx, error } = await (supabase as any)
        .from('transactions')
        .select('reference, status, metadata, type')
        .eq('harbor_transfer_uuid', data?.uuid)
        .single();

      if (error || !tx) {
        console.error('[harbor-webhook] TX non trouvée:', data?.uuid);
        return res.status(200).json({ received: true, found: false });
      }

      if (HARBOR_TERMINAL_TX_STATUSES.includes(tx.status)) {
        return res.status(200).json({ received: true, already_terminal: true });
      }

      let finalStatus = harborStatus;

      if (harborStatus === 'completed' && tx.type === 'on-ramp') {
        try {
          const rates   = await getRatesFromDb();
          const usdcAmt = Number(data?.receipt?.final_amount ?? 0);
          const fcfaAmt = Math.round(usdcAmt * rates.USDC_FCFA);
          const phone   = tx.metadata?.beneficiary_phone;

          await (supabase as any)
            .from('transactions')
            .update({ to_amount: fcfaAmt })
            .eq('reference', tx.reference);

          finalStatus = 'completed';

          // Log pour l'opérateur NBK
          console.log('═══════════════════════════════════════════');
          console.log(`[harbor-webhook] ✅ USDC reçus sur wallet NBK`);
          console.log(`  Référence      : ${tx.reference}`);
          console.log(`  USDC reçus     : ${usdcAmt} USDC sur ${AUTO_NETWORK}`);
          console.log(`  FCFA à envoyer : ${fcfaAmt} XAF`);
          console.log(`  Bénéficiaire   : ${phone}`);
          console.log(`  Devise origine : ${tx.metadata?.original_currency} ${tx.metadata?.original_amount}`);
          console.log('═══════════════════════════════════════════');

        } catch (err: any) {
          console.warn('[harbor-webhook] Calcul FCFA échoué (non bloquant):', err.message);
          finalStatus = 'completed';
        }
      }

      if (['reject', 'cancelled', 'error'].includes(harborStatus)) finalStatus = 'failed';
      if (harborStatus === 'expired') finalStatus = 'expired';

      await (supabase as any)
        .from('transactions')
        .update({
          harbor_status: harborStatus,
          status:        finalStatus,
          updated_at:    new Date().toISOString(),
        })
        .eq('harbor_transfer_uuid', data?.uuid);

      io.to(`tx:${tx.reference}`).emit('tx_update', { reference: tx.reference, status: finalStatus });
      io.emit('tx_update', { reference: tx.reference, status: finalStatus });

      console.log(`[harbor-webhook] TX ${tx.reference} → ${finalStatus}`);
      return res.status(200).json({ received: true, reference: tx.reference, status: finalStatus });
    }

    res.status(200).json({ received: true, event, handled: false });
  });

  return router;
}