// Feature 12: lab analyser integration. Mounted at /api/lab-instrument. Protected by a shared key:
//   set LAB_API_KEY in server/.env, then send header  x-api-key: <key>
//   GET  /worklist                          → open orders and their tests (for the instrument/LIS bridge)
//   POST /results  { orderCode, results:[{ testCode|testName, value, unit?, flag?, remarks? }], autoRelease? }
import crypto from 'crypto';
import { Router } from 'express';
import { M } from '../config/registry.js';
import { runAction, audit } from '../config/engine.js';
import { asyncH, HttpError } from '../utils/helpers.js';

const router = Router();
const SYSTEM_USER = { name: 'Lab instrument', role: 'admin' };
const nd = { deleted: { $ne: true } };

router.use((req, res, next) => {
  const key = process.env.LAB_API_KEY;
  if (!key) return next(new HttpError(503, 'Lab instrument API is off. Set LAB_API_KEY in server/.env'));
  const got = Buffer.from(String(req.headers['x-api-key'] || ''));
  const want = Buffer.from(key);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return next(new HttpError(401, 'Invalid API key'));
  return next();
});

router.get('/worklist', asyncH(async (req, res) => {
  const orders = await M('labOrders').find({ status: { $in: ['Ordered', 'Sample Collected', 'In Progress'] }, ...nd }).sort({ createdAt: 1 }).limit(200)
    .populate('patient', 'name code gender age').populate('items.test', 'name code').lean();
  res.json(orders.map((o) => ({
    orderCode: o.code, priority: o.priority, status: o.status,
    patient: { code: o.patient?.code, name: o.patient?.name, gender: o.patient?.gender, age: o.patient?.age },
    tests: o.items.map((i) => ({ testCode: i.test?.code, testName: i.test?.name, hasResult: !!i.result })),
  })));
}));

function flagFor(value, range) {
  const m = String(range || '').match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  const n = Number(value);
  if (!m || Number.isNaN(n)) return undefined;
  return n < Number(m[1]) ? 'Low' : n > Number(m[2]) ? 'High' : 'Normal';
}

router.post('/results', asyncH(async (req, res) => {
  const { orderCode, results, autoRelease } = req.body || {};
  if (!orderCode || !Array.isArray(results) || !results.length || results.length > 200) throw new HttpError(400, 'orderCode and a results array (1–200) are required');
  const order = await M('labOrders').findOne({ code: String(orderCode), ...nd }).populate('items.test', 'name code');
  if (!order) throw new HttpError(404, `Order ${orderCode} not found`);
  if (['Completed', 'Cancelled'].includes(order.status)) throw new HttpError(409, `Order is already ${order.status}`);
  const matched = []; const unmatched = [];
  for (const r of results) {
    const code = String(r.testCode || '').toLowerCase(); const name = String(r.testName || '').toLowerCase();
    const item = order.items.find((i) => (code && String(i.test?.code || '').toLowerCase() === code) || (name && String(i.test?.name || '').toLowerCase() === name));
    if (!item || r.value === undefined || r.value === null || r.value === '') { unmatched.push(r.testCode || r.testName || '?'); continue; }
    item.result = String(r.value).slice(0, 100);
    if (r.unit) item.unit = String(r.unit).slice(0, 30);
    if (r.remarks) item.remarks = String(r.remarks).slice(0, 200);
    item.flag = ['Normal', 'High', 'Low', 'Critical'].includes(r.flag) ? r.flag : flagFor(r.value, item.normalRange) || item.flag;
    matched.push(r.testCode || r.testName);
  }
  if (['Ordered', 'Sample Collected'].includes(order.status) && matched.length) order.status = 'In Progress';
  await order.save();
  await audit(SYSTEM_USER, 'labOrders', order._id, 'action', `Instrument results received (${matched.length} test(s))`, req);
  let released = false;
  if (autoRelease && order.items.every((i) => i.result)) { await runAction('labOrders', order._id, 'complete', {}, SYSTEM_USER, { req }); released = true; }
  res.json({ ok: true, order: order.code, matched, unmatched, released });
}));

export default router;