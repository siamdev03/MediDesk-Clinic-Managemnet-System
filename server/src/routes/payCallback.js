// Feature 6: gateway callbacks (public). Mounted at /api/pay. Every result is re-verified with the gateway
// in services/payments.js, so a forged callback cannot mark an invoice paid.
import { Router } from 'express';
import { M } from '../config/registry.js';
import { completePayment, clientBase, providers } from '../services/payments.js';
import { asyncH, HttpError } from '../utils/helpers.js';

const router = Router();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const back = (res, op, tran) => res.redirect(303, `${clientBase()}/pay-result?status=${encodeURIComponent(op?.status || 'Failed')}&tran=${encodeURIComponent(tran || '')}`);

// Fake gateway page for localhost testing (disabled in production unless ALLOW_MOCK_PAYMENTS=true)
router.get('/mock/:tranId', asyncH(async (req, res) => {
  if (!providers().includes('mock')) throw new HttpError(404, 'Not found');
  const op = await M('onlinePayments').findOne({ tranId: req.params.tranId, status: 'Initiated' }).populate('invoice', 'code').lean();
  if (!op) throw new HttpError(404, 'Payment not found or already processed');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test payment</title>
<body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 16px;text-align:center">
<h2>🧪 Mock payment gateway</h2><p>Invoice <b>${esc(op.invoice?.code || '')}</b><br>Amount <b style="font-size:1.6em">${esc(op.amount)}</b></p>
<p style="color:#666;font-size:.9em">Test page – no real money moves. Configure SSLCOMMERZ_* or BKASH_* in server/.env for a real gateway.</p>
<a href="/api/pay/callback/mock?tran=${esc(req.params.tranId)}&result=success" style="display:block;padding:12px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;margin:8px 0">✔ Pay now</a>
<a href="/api/pay/callback/mock?tran=${esc(req.params.tranId)}&result=fail" style="display:block;padding:12px;background:#b91c1c;color:#fff;border-radius:8px;text-decoration:none;margin:8px 0">✖ Fail</a>
<a href="/api/pay/callback/mock?tran=${esc(req.params.tranId)}&result=cancel" style="display:block;padding:12px;border:1px solid #999;border-radius:8px;text-decoration:none;color:#333;margin:8px 0">Cancel</a></body>`);
}));
router.get('/callback/mock', asyncH(async (req, res) => {
  if (!providers().includes('mock')) throw new HttpError(404, 'Not found');
  const op = await completePayment(String(req.query.tran), { result: String(req.query.result), cancelled: req.query.result === 'cancel' });
  back(res, op, req.query.tran);
}));

router.post('/callback/sslcommerz/:result', asyncH(async (req, res) => {
  const b = req.body || {};
  const op = await completePayment(String(b.tran_id), { ...b, result: req.params.result, cancelled: req.params.result === 'cancel' });
  back(res, op, b.tran_id);
}));

router.get('/callback/bkash', asyncH(async (req, res) => {
  const { tran, paymentID, status } = req.query;
  const op = await completePayment(String(tran), { paymentID, status, cancelled: status === 'cancel' });
  back(res, op, tran);
}));

export default router;