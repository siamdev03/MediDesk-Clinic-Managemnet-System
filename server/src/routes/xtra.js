// Authenticated add-on endpoints under /api/x (mounted after routes/custom.js).
import { Router } from 'express';
import QRCode from 'qrcode';
import { M, getModule } from '../config/registry.js';
import { can, audit } from '../config/engine.js';
import { asyncH, HttpError, todayStr, toDateOnly, addDays, ymd } from '../utils/helpers.js';
import { PDF_BUILDERS } from '../services/pdf.js';
import { sendMessage } from '../services/notify.js';
import { checkPrescription } from '../services/interactions.js';
import { dayTotals, profitLoss, commissions } from '../services/finance.js';
import { workbookBuffer } from '../services/xlsx.js';
import { getPermissionMatrix, savePermissions } from '../services/permissions.js';
import { createBackup, listBackups, backupPath } from '../services/backup.js';
import { startPayment, providers } from '../services/payments.js';

const router = Router();
const nd = { deleted: { $ne: true } };
const need = (...roles) => (req, res, next) => (can(req.user, roles) ? next() : next(new HttpError(403, 'You do not have permission to do this')));
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── 18: branch list for the selector
router.get('/branches', asyncH(async (req, res) => {
  res.json(await M('branches').find({ active: { $ne: false }, ...nd }).sort({ name: 1 }).select('name code').lean());
}));

// ── 4: PDF download / e-mail
function pdfFor(req) {
  const build = PDF_BUILDERS[req.params.key];
  const cfg = getModule(req.params.key);
  if (!build || !cfg) throw new HttpError(404, 'No PDF for this module');
  if (!can(req.user, cfg.roles.read)) throw new HttpError(403, `You do not have access to ${cfg.label}`);
  return { build, cfg };
}
router.get('/pdf/:key/:id', asyncH(async (req, res) => {
  const { build, cfg } = pdfFor(req);
  const buf = await build(req.params.id);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${cfg.key}-${req.params.id}.pdf"` });
  res.send(buf);
}));
router.post('/pdf/:key/:id/email', asyncH(async (req, res) => {
  const { build, cfg } = pdfFor(req);
  const doc = await M(cfg.key).findOne({ _id: req.params.id, ...nd }).populate('patient', 'name email').lean();
  if (!doc) throw new HttpError(404, 'Record not found');
  const to = String(req.body?.to || doc.patient?.email || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(to)) throw new HttpError(400, 'Enter a valid e-mail address (the patient has none on file)');
  const buf = await build(req.params.id);
  const r = await sendMessage({
    channel: 'Email', to, subject: `${cfg.label.replace(/s$/, '')} ${doc.code || ''}`,
    body: `Dear ${doc.patient?.name || 'patient'},\n\nPlease find your ${cfg.label.toLowerCase().replace(/s$/, '')} ${doc.code || ''} attached.\n\nThank you.`,
    attachments: [{ filename: `${doc.code || cfg.key}.pdf`, content: buf }], relatedModule: cfg.key, relatedId: doc._id,
  });
  if (!r.ok) throw new HttpError(502, `E-mail failed: ${r.error || 'see Message Log'}`);
  await audit(req.user, cfg.key, doc._id, 'action', `PDF e-mailed to ${to}`, req);
  res.json({ message: r.status === 'Mock' ? `Mock mode: e-mail to ${to} only written to the Message Log (set SMTP_HOST to really send)` : `E-mailed to ${to}` });
}));

// ── 5: QR image + barcode / code lookup
router.get('/qr', asyncH(async (req, res) => {
  const data = String(req.query.data || '').slice(0, 500);
  if (!data) throw new HttpError(400, 'data is required');
  const buf = await QRCode.toBuffer(data, { width: Math.min(600, Number(req.query.size) || 240), margin: 1, errorCorrectionLevel: 'M' });
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' });
  res.send(buf);
}));
router.get('/lookup', asyncH(async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) throw new HttpError(400, 'code is required');
  const exact = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const tries = [['medicines', { barcode: exact }], ['medicines', { code: exact }], ['patients', { code: exact }], ['appointments', { code: exact }], ['invoices', { code: exact }], ['prescriptions', { code: exact }], ['labOrders', { code: exact }]];
  for (const [key, q] of tries) {
    const cfg = getModule(key);
    if (!can(req.user, cfg.roles.read)) continue;
    const r = await M(key).findOne({ ...q, ...nd }).lean();
    if (!r) continue;
    const link = key === 'patients' ? `/patient/${r._id}` : `/m/${key}?open=${r._id}`;
    return res.json({ module: key, id: r._id, label: r.name || r.code, record: key === 'medicines' ? { _id: r._id, name: r.name, price: r.price, stock: r.stock } : undefined, link });
  }
  throw new HttpError(404, `Nothing found for "${code}"`);
}));

// ── 10: prescription safety check
router.post('/rx-check', asyncH(async (req, res) => {
  res.json({ warnings: await checkPrescription({ patientId: req.body?.patientId, items: Array.isArray(req.body?.items) ? req.body.items.slice(0, 40) : [] }) });
}));

// ── 7, 8, 9: finance
const FIN = need('admin', 'accountant');
router.get('/finance/cash-preview', need('admin', 'accountant', 'receptionist'), asyncH(async (req, res) => {
  const d = req.query.date || todayStr();
  if (!isDate(d)) throw new HttpError(400, 'date must be YYYY-MM-DD');
  res.json({ date: d, ...(await dayTotals(d)) });
}));
function span(req) {
  const to = req.query.to || todayStr();
  const from = req.query.from || `${to.slice(0, 8)}01`;
  if (!isDate(from) || !isDate(to)) throw new HttpError(400, 'from/to must be YYYY-MM-DD');
  return { from, to };
}
router.get('/finance/pnl', FIN, asyncH(async (req, res) => {
  const { from, to } = span(req);
  const r = await profitLoss(from, to);
  if (req.query.format !== 'xlsx') return res.json(r);
  const rows = [['Item', 'Amount'], ['Billing income', r.income.billing], ['Pharmacy income', r.income.pharmacy], ['TOTAL INCOME', r.income.total],
    ...Object.entries(r.expenses.byCategory).map(([k, v]) => [`Expense – ${k}`, v]), ['TOTAL EXPENSES', r.expenses.total], ['NET PROFIT', r.netProfit], [],
    ['Tax on invoices', r.tax.invoiceTax], ['Tax on pharmacy sales', r.tax.pharmacyTax], ['TOTAL TAX COLLECTED', r.tax.total], ['Estimated pharmacy cost of goods', r.pharmacyCogsEstimate], ['Outstanding receivables', r.receivablesOutstanding]];
  res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="profit-loss-${from}-${to}.xlsx"` });
  return res.send(await workbookBuffer([{ name: 'Profit & Loss', rows }]));
}));
router.get('/finance/commissions', FIN, asyncH(async (req, res) => {
  const { from, to } = span(req);
  const r = await commissions(from, to, req.query.paidOnly === '1');
  if (req.query.format !== 'xlsx') return res.json(r);
  const rows = [['Doctor', 'Specialization', 'Visits', 'Fees', 'Commission %', 'Commission'], ...r.rows.map((x) => [x.doctor, x.specialization, x.visits, x.fees, x.pct, x.commission]), ['TOTAL', '', '', r.totalFees, '', r.totalCommission]];
  res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="commissions-${from}-${to}.xlsx"` });
  return res.send(await workbookBuffer([{ name: 'Commission', rows }]));
}));

// ── 13: doctor dashboard (a doctor sees their own; admin may pass ?doctor=ID)
async function doctorOf(req) {
  if (req.user.role === 'admin' && req.query.doctor) return M('doctors').findOne({ _id: req.query.doctor, ...nd }).lean();
  const email = new RegExp(`^${String(req.user.email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  return (await M('doctors').findOne({ email, ...nd }).lean()) || (await M('doctors').findOne({ name: req.user.name, ...nd }).lean());
}
router.get('/doctor/dashboard', need('doctor'), asyncH(async (req, res) => {
  const doc = await doctorOf(req);
  if (!doc) return res.json({ doctor: null, message: 'No doctor profile is linked to this login. Give the doctor record the same e-mail as the user.' });
  const today = todayStr();
  const t = toDateOnly(today);
  const [appts, queue, labs, follow, week] = await Promise.all([
    M('appointments').find({ doctor: doc._id, date: t, status: { $nin: ['Cancelled'] }, ...nd }).sort({ time: 1 }).populate('patient', 'name code phone age gender').lean(),
    M('queue').find({ doctor: doc._id, date: t, status: { $in: ['Waiting', 'Called', 'In-consultation'] }, ...nd }).sort({ token: 1 }).populate('patient', 'name code').lean(),
    M('labOrders').find({ doctor: doc._id, orderDate: { $gte: addDays(t, -7) }, status: { $in: ['Completed', 'In Progress', 'Sample Collected', 'Ordered'] }, ...nd }).sort({ createdAt: -1 }).limit(20).populate('patient', 'name code').lean(),
    M('consultations').find({ doctor: doc._id, followUpDate: { $gte: addDays(t, -3), $lte: addDays(t, 7) }, ...nd }).sort({ followUpDate: 1 }).limit(20).populate('patient', 'name code phone').lean(),
    M('appointments').find({ doctor: doc._id, date: { $gte: addDays(t, -6), $lte: t }, status: 'Completed', ...nd }).select('date fee').lean(),
  ]);
  const monthStart = toDateOnly(`${today.slice(0, 8)}01`);
  const monthDone = await M('appointments').find({ doctor: doc._id, date: { $gte: monthStart, $lte: t }, status: 'Completed', ...nd }).select('fee').lean();
  const fees = monthDone.reduce((s, a) => s + (a.fee || 0), 0);
  const perDay = {};
  week.forEach((a) => { perDay[ymd(a.date)] = (perDay[ymd(a.date)] || 0) + 1; });
  res.json({
    doctor: { _id: doc._id, name: doc.name, specialization: doc.specialization, room: doc.room, commissionPct: doc.commissionPct || 0 },
    today: { appointments: appts, waiting: queue, total: appts.length, completed: appts.filter((a) => a.status === 'Completed').length },
    labs: labs.map((l) => ({ _id: l._id, code: l.code, status: l.status, patient: l.patient, orderDate: l.orderDate })),
    followUps: follow.map((c) => ({ _id: c._id, patient: c.patient, date: c.followUpDate, diagnosis: c.diagnosis })),
    week: Array.from({ length: 7 }, (_, i) => { const d = ymd(addDays(t, i - 6)); return { date: d, visits: perDay[d] || 0 }; }),
    month: { visits: monthDone.length, fees, commission: Math.round(((fees * (doc.commissionPct || 0)) / 100) * 100) / 100 },
  });
}));

// ── 14: follow-up tracker
router.get('/followups', need('doctor', 'nurse', 'receptionist'), asyncH(async (req, res) => {
  const t = toDateOnly(todayStr());
  const q = { followUpDate: { $gte: addDays(t, -60), $lte: addDays(t, 45) }, ...nd };
  if (req.user.role === 'doctor') { const d = await doctorOf(req); if (d) q.doctor = d._id; }
  const cons = await M('consultations').find(q).sort({ followUpDate: 1 }).limit(300).populate('patient', 'name code phone').populate('doctor', 'name').lean();
  const pids = [...new Set(cons.map((c) => String(c.patient?._id)))];
  const later = await M('appointments').find({ patient: { $in: pids }, status: { $nin: ['Cancelled', 'No-show'] }, date: { $gte: addDays(t, -60) }, ...nd }).select('patient date').lean();
  const rows = cons.filter((c) => c.patient).map((c) => {
    const done = later.some((a) => String(a.patient) === String(c.patient._id) && a.date > c.date);
    const status = done ? 'Done' : c.followUpDate < t ? 'Overdue' : +c.followUpDate === +t ? 'Today' : 'Upcoming';
    return { _id: c._id, patient: c.patient, doctor: c.doctor, doctorId: c.doctor?._id, consultDate: c.date, followUpDate: c.followUpDate, diagnosis: c.diagnosis, status, reminded: !!c.followUpReminded };
  });
  const want = req.query.status;
  res.json({ rows: want ? rows.filter((r) => r.status === want) : rows, counts: rows.reduce((o, r) => ({ ...o, [r.status]: (o[r.status] || 0) + 1 }), {}) });
}));
router.post('/followups/:id/remind', need('doctor', 'nurse', 'receptionist'), asyncH(async (req, res) => {
  const c = await M('consultations').findOne({ _id: req.params.id, ...nd }).populate('patient', 'name phone').populate('doctor', 'name').lean();
  if (!c?.patient?.phone) throw new HttpError(400, 'This patient has no phone number');
  const r = await sendMessage({ channel: 'SMS', to: c.patient.phone, body: `Dear ${c.patient.name}, your follow-up visit with Dr. ${c.doctor?.name || ''} is due on ${ymd(c.followUpDate)}. Please book an appointment.`, relatedModule: 'consultations', relatedId: c._id });
  await M('consultations').updateOne({ _id: c._id }, { followUpReminded: true });
  res.json({ message: r.status === 'Mock' ? 'Reminder written to the Message Log (mock mode)' : 'Reminder sent' });
}));

// ── 16: permission editor
router.get('/permissions', need('admin'), asyncH(async (req, res) => res.json(await getPermissionMatrix())));
router.put('/permissions', need('admin'), asyncH(async (req, res) => {
  const out = await savePermissions(req.body?.permissions || {});
  await audit(req.user, 'users', '', 'action', 'Permissions changed', req);
  res.json(out);
}));

// ── 17: backups
router.get('/backups', need('admin'), asyncH(async (req, res) => res.json(listBackups())));
router.post('/backups', need('admin'), asyncH(async (req, res) => {
  const b = await createBackup('manual');
  await audit(req.user, 'users', '', 'action', `Backup created: ${b.name}`, req);
  res.json(b);
}));
router.get('/backups/:name', need('admin'), asyncH(async (req, res) => res.download(backupPath(req.params.name))));

// ── 20: open-error counter for the admin badge
router.get('/error-count', need('admin'), asyncH(async (req, res) => {
  res.json({ open: await M('errorLogs').countDocuments({ status: 'Open', ...nd }) });
}));

// ── 6: online payments (staff side)
router.get('/pay/providers', asyncH(async (req, res) => res.json(providers())));
router.post('/pay/init', need('admin', 'accountant', 'receptionist'), asyncH(async (req, res) => {
  const { invoiceId, amount, provider, phone } = req.body || {};
  res.json(await startPayment({ invoiceId, amount, provider, payerPhone: phone }));
}));

export default router;