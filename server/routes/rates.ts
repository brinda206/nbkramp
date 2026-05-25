/**
 * server/routes/rates.ts
 */
import { Router, type Request, type Response } from 'express';
import { getRatesFromDb } from '../lib/rates.js';

export const ratesRouter = Router();

ratesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rates = await getRatesFromDb();
    res.json(rates);
  } catch (err: any) {
    res.status(503).json({ error: 'Taux temporairement indisponibles', fallback: true });
  }
});