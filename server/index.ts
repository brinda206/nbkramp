/**
 * server/index.ts
 */
import 'dotenv/config';
import express           from 'express';
import { createServer }  from 'http';
import { Server }        from 'socket.io';
import { createServer as createViteServer } from 'vite';
import path              from 'path';
import { fileURLToPath } from 'url';

import { txRouter }              from './routes/transactions.js';
import { ratesRouter }           from './routes/rates.js';
import { createPaymentRouter }   from './routes/payments.js';
import { createCustomerRouter }  from './routes/customers.js';
import { refreshAndSaveRates }   from './lib/rates.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT      = Number(process.env.PORT) || 3000;

async function main() {
  const app        = express();
  const httpServer = createServer(app);
  const io         = new Server(httpServer, { cors: { origin: '*' } });

  // ─── Body parsing avec capture rawBody pour webhooks ───────────────────────
  app.use(express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  }));

  // ─── Routes API ────────────────────────────────────────────────────────────
  app.use('/api/transactions', txRouter);
  app.use('/api/rates',        ratesRouter);
  app.use('/api/payments',     createPaymentRouter(io));
  app.use('/api/customers',    createCustomerRouter(io));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok:          true,
      ts:          new Date().toISOString(),
      harbor_env:  process.env.HARBOR_ENV  ?? 'sandbox',
      campay_env:  process.env.CAMPAY_ENV  ?? 'demo',
    });
  });

  // ─── Vite dev / production static ─────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(__dirname, '../dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // ─── Socket.io ────────────────────────────────────────────────────────────
  io.on('connection', socket => {
    console.log('[ws] connected', socket.id);
    socket.on('subscribe', (reference: string) => socket.join(`tx:${reference}`));
    socket.on('disconnect', () => console.log('[ws] disconnected', socket.id));
  });

  // ─── Rate refresh loop ─────────────────────────────────────────────────────
  // Toutes les 10 min — plan gratuit ExchangeRate-API = 1500 req/mois
  // 6 req/h × 24h × 30j = 4320 req/mois (dans les limites)
  async function refreshRates() {
    try {
      const rates = await refreshAndSaveRates();
      io.emit('rates_update', rates);
      console.log(`[rates] 1 USDC = ${rates.USDC_FCFA.toFixed(1)} FCFA`);
    } catch (err: any) {
      console.error('[rates] refresh failed:', err.message);
    }
  }

  await refreshRates(); // immédiat au démarrage
  setInterval(refreshRates, 10 * 60 * 1000); // toutes les 10 min

  // ─── Start ────────────────────────────────────────────────────────────────
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🦉 NBK Finance / IPercash → http://localhost:${PORT}`);
    console.log(`   Harbor : ${process.env.HARBOR_ENV ?? 'sandbox'}`);
    console.log(`   Campay : ${process.env.CAMPAY_ENV ?? 'demo'}\n`);
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});