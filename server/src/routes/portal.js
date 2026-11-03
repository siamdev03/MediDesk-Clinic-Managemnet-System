// Feature 3: patient portal. Patients sign in with their phone number + a one-time code sent by SMS.
// Mounted at /api/portal (no staff login). Tokens are marked {portal:true} and are useless on staff APIs.
import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { M } from '../config/registry.js';
import { runAction } from '../config/engine.js';
import { sendMessage } from '../services/notify.js';
import { PDF_BUILDERS } from '../services/pdf.js';
import { startPayment, providers } from '../services/payments.js';
import { findOrCreatePatient, bookAppointment, last10 } from './publicApi.js';
import { slotsFor } from '../services/slots.js';
import { asyncH, HttpError, todayStr, toDateOnly } from '../utils/helpers.js';
import { getSettings } from '../config/settings.js';

const router = Router();
const nd = { deleted: { $ne: true } };
const SYSTEM_USER = { name: 'Patient portal', role: 'admin' };
const secret = () => process.env.JWT_SECRET;

const Otp = mongoose.models.portalOtps || mongoose.model('portalOtps', new mongoose.Schema({
  phone: { type: String, index: true }, hash: String, attempts: { type: Number, default: 0 }, expiresAt: { type: Date, index: { expireAfterSeconds: 0 } },
}), 'portalOtps');
const hash = (phone, code) => crypto.createHash('sha256').update(`${phone}:${code}:${secret()}`).digest('hex');

const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 6, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many code requests – wait a few minutes' } });
const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts – wait a few minutes' } });

async function patientsOfPhone(l10) {
  const cands = await M('patients').find({ phone: { $regex: l10.slice(-4) }, ...nd }).select('name code gender age dob phone photo bloodGroup allergies').lean();
  return cands.filter((p) => last10(p.phone) === l10);
}

router.post('/otp', otpLimiter, asyncH(async (req, res) => {
  const l10 = last10(req.body?.phone);
  if (l10.length < 10) throw new HttpError(400, 'Enter the mobile number you gave the clinic');
  const found = await patientsOfPhone(l10);
  const mock = (process.env.SMS_PROVIDER || 'mock') === 'mock' && process.env.NODE_ENV !== 'production';
  let devOtp;
  if (found.length) {
    const code = String(crypto.randomInt(100000, 1000000));
    await Otp.deleteMany({ phone: l10 });
    await Otp.create({ phone: l10, hash: hash(l10, code), expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
    const s = await getSettings();
    await sendMessage({ channel: 'SMS', to: req.body.phone, body: `${code} is your ${s.clinicName} patient portal code. Valid for 5 minutes. Do not share it.` });
    if (mock) devOtp = code;
  }
  // same answer whether or not the number exists, so numbers cannot be probed
  res.json({ ok: true, message: 'If this number is registered, a 6-digit code has been sent.', ...(devOtp ? { devOtp } : {}) });
}));

router.post('/verify', verifyLimiter, asyncH(async (req, res) => {
  const l10 = last10(req.body?.phone);
  const row = await Otp.findOne({ phone: l10 });
  if (!row || row.expiresAt < new Date()) throw new HttpError(401, 'Code expired – request a new one');
  if (row.attempts >= 5) { await row.deleteOne(); throw new HttpError(401, 'Too many wrong codes – request a new one'); }
  if (row.hash !== hash(l10, String(req.body?.otp || '').trim())) {
    row.attempts += 1; await row.save();
    throw new HttpError(401, 'Wrong code');
  }
  await row.deleteOne();
  const token = jwt.sign({ portal: true, phone: l10 }, secret(), { expiresIn: '2h' });
  res.json({ token, patients: await patientsOfPhone(l10) });
}));

// everything below needs a portal token
router.use(asyncH(async (req, res, next) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  let p;
  try { p = jwt.verify(token, secret()); } catch { throw new HttpError(401, 'Please sign in again'); }
  if (!p.portal) throw new HttpError(401, 'Please sign in again');
  req.phone10 = p.phone;
  next();
}));

async function ownPatient(req) {
  const id = req.query.pid || req.body?.pid;
  const p = await M('patients').findOne({ _id: id, ...nd }).lean();
  if (!p || last10(p.phone) !== req.phone10) throw new HttpError(403, 'Not your record');
  return p;
}

router.get('/patients', asyncH(async (req, res) => res.json(await patientsOfPhone(req.phone10))));

router.get('/summary', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  const t = toDateOnly(todayStr());
  const [upcoming, past, prescriptions, labs, invoices] = await Promise.all([
    M('appointments').find({ patient: p._id, date: { $gte: t }, status: { $nin: ['Cancelled', 'No-show', 'Completed'] }, ...nd }).sort({ date: 1, time: 1 }).populate('doctor', 'name specialization room').lean(),
    M('appointments').find({ patient: p._id, date: { $lt: t }, ...nd }).sort({ date: -1 }).limit(10).populate('doctor', 'name').lean(),
    M('prescriptions').find({ patient: p._id, status: { $ne: 'Cancelled' }, ...nd }).sort({ date: -1 }).limit(20).populate('doctor', 'name').lean(),
    M('labOrders').find({ patient: p._id, status: 'Completed', ...nd }).sort({ completedAt: -1 }).limit(20).lean(),
    M('invoices').find({ patient: p._id, status: { $ne: 'Cancelled' }, ...nd }).sort({ invoiceDate: -1 }).limit(20).lean(),
  ]);
  res.json({
    patient: p, upcoming, past,
    prescriptions: prescriptions.map((r) => ({ _id: r._id, code: r.code, date: r.date, doctor: r.doctor?.name, diagnosis: r.diagnosis, items: (r.items || []).map((i) => i.medicineName) })),
    labs: labs.map((l) => ({ _id: l._id, code: l.code, date: l.orderDate, tests: l.items.length })),
    invoices: invoices.map((i) => ({ _id: i._id, code: i.code, date: i.invoiceDate, total: i.total, paid: i.paid, balance: i.balance, status: i.status })),
    payProviders: providers(),
  });
}));

router.get('/pdf/:key/:id', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  const build = PDF_BUILDERS[req.params.key];
  if (!build) throw new HttpError(404, 'Not available');
  const doc = await M(req.params.key).findOne({ _id: req.params.id, patient: p._id, ...nd }).select('status').lean();
  if (!doc) throw new HttpError(404, 'Not found');
  if (req.params.key === 'labOrders' && doc.status !== 'Completed') throw new HttpError(403, 'This report is not ready yet');
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${req.params.key}.pdf"` });
  res.send(await build(req.params.id));
}));

router.get('/qr', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  res.set('Content-Type', 'image/png');
  res.send(await QRCode.toBuffer(p.code, { width: 260, margin: 1 }));
}));

router.get('/doctors', asyncH(async (req, res) => {
  res.json(await M('doctors').find({ status: 'Active', ...nd }).sort({ name: 1 }).select('name specialization fee workDays').lean());
}));
router.get('/slots', asyncH(async (req, res) => res.json(await slotsFor(req.query.doctor, req.query.date))));

router.post('/book', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  const r = await bookAppointment({ patient: p, doctorId: req.body.doctor, date: req.body.date, time: req.body.time, reason: req.body.reason, source: 'Portal' });
  res.json({ ok: true, ...r });
}));

router.post('/cancel', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  const a = await M('appointments').findOne({ _id: req.body.id, patient: p._id, ...nd }).lean();
  if (!a) throw new HttpError(404, 'Appointment not found');
  if (!['Scheduled', 'Confirmed'].includes(a.status)) throw new HttpError(400, 'This appointment can no longer be cancelled online');
  await runAction('appointments', a._id, 'cancel', { reason: 'Cancelled by patient (portal)' }, SYSTEM_USER);
  res.json({ ok: true });
}));

router.post('/pay', asyncH(async (req, res) => {
  const p = await ownPatient(req);
  const inv = await M('invoices').findOne({ _id: req.body.invoiceId, patient: p._id, ...nd }).select('_id').lean();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  res.json(await startPayment({ invoiceId: inv._id, amount: req.body.amount, provider: req.body.provider, payerPhone: p.phone }));
}));

export { findOrCreatePatient };
export default router;