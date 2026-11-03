import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncH, HttpError } from '../utils/helpers.js';
import { logError } from '../utils/errorLogger.js';

const router = Router();
const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many error reports' } });

// Browser (React) errors reported by the web app
router.post('/client', limiter, asyncH(async (req, res) => {
  const b = req.body || {};
  if (!b.message) throw new HttpError(400, 'message is required');
  await logError({
    source: 'client', level: b.level === 'warning' ? 'warning' : 'error', message: String(b.message).slice(0, 500), stack: String(b.stack || '').slice(0, 4000),
    method: 'UI', path: String(b.path || '').slice(0, 300), user: req.user, ip: req.ip, userAgent: req.headers['user-agent'],
  });
  res.json({ ok: true });
}));

export default router;