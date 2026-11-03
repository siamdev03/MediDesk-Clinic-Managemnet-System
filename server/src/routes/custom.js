import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import mongoose from 'mongoose';
import { M, models, getModule, moduleList } from '../config/registry.js';
import { getSettings, saveSettings } from '../config/settings.js';
import { can, labelOf } from '../config/engine.js';
import { requireRole } from '../middleware/auth.js';
import {
  asyncH, HttpError, todayStr, todayDate, toDateOnly, addDays, ymd, TZ, DAY_NAMES, hhmmToMin, minToHhmm, nowTime, escapeRegex, round2,
} from '../utils/helpers.js';
import { buildReport, REPORT_LIST } from './reports.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const nd = { deleted: { $ne: true } };
const FIN_ROLES = ['admin', 'accountant'];

// ───────────── settings ─────────────
router.get('/settings', asyncH(async (req, res) => res.json(await getSettings())));
router.put('/settings', requireRole('admin'), asyncH(async (req, res) => res.json(await saveSettings(req.body || {}))));

// ───────────── file upload ─────────────
const ALLOWED = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'];
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => (ALLOWED.includes(path.extname(file.originalname).toLowerCase())
    ? cb(null, true) : cb(new HttpError(400, 'Unsupported file type'))),
});
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size });
});

// ───────────── dashboard ─────────────
router.get('/dashboard', asyncH(async (req, res) => {
  const role = req.user.role;
  const finance = FIN_ROLES.includes(role);
  const today = todayDate();
  const tomorrow = addDays(today, 1);
  const monthStart = toDateOnly(`${todayStr().slice(0, 7)}-01`);
  const days14 = addDays(today, -13);
  const sixMonthsAgo = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1));
  const s = await getSettings();
  const alertDate = addDays(today, s.expiryAlertDays || 60);
  const tz = TZ();

  const count = (key, filter = {}) => M(key).countDocuments({ ...nd, ...filter });
  const [
    patients, newPatients, doctors, apptToday, apptPending, admitted, bedsTotal, bedsOccupied, labPending, lowStock, expiringSoon, expired,
    unpaidInvoices, bloodUnits, ambulancesFree, surgeriesToday, queueWaiting, tasksOpen,
  ] = await Promise.all([
    count('patients'), count('patients', { createdAt: { $gte: monthStart } }), count('doctors', { status: 'Active' }),
    count('appointments', { date: today, status: { $nin: ['Cancelled', 'No-show'] } }),
    count('appointments', { date: today, status: { $in: ['Scheduled', 'Confirmed', 'Checked-in'] } }),
    count('admissions', { status: 'Admitted' }), count('beds'), count('beds', { status: 'Occupied' }),
    count('labOrders', { status: { $in: ['Ordered', 'Sample Collected', 'In Progress'] } }),
    count('medicines', { active: { $ne: false }, $expr: { $lte: ['$stock', '$reorderLevel'] } }),
    count('medicines', { stock: { $gt: 0 }, expiryDate: { $gte: today, $lte: alertDate } }),
    count('medicines', { stock: { $gt: 0 }, expiryDate: { $lt: today } }),
    count('invoices', { status: { $in: ['Unpaid', 'Partial'] } }),
    count('bloodBank', { status: 'Available' }), count('ambulances', { status: 'Available' }),
    count('surgeries', { scheduledAt: { $gte: today, $lt: tomorrow }, status: { $in: ['Scheduled', 'In-progress'] } }),
    count('queue', { date: today, status: { $in: ['Waiting', 'Called'] } }),
    count('tasks', { status: { $ne: 'Done' }, assignedTo: req.user._id }),
  ]);

  const out = {
    stats: {
      patients, newPatients, doctors, apptToday, apptPending, admitted, bedsTotal, bedsOccupied, bedsAvailable: bedsTotal - bedsOccupied,
      labPending, lowStock, expiringSoon, expired, unpaidInvoices, bloodUnits, ambulancesFree, surgeriesToday, queueWaiting, tasksOpen,
    },
    charts: {},
  };

  // Appointments by status (this month)
  out.charts.apptStatus = (await M('appointments').aggregate([
    { $match: { ...nd, date: { $gte: monthStart } } }, { $group: { _id: '$status', value: { $sum: 1 } } },
  ])).map((x) => ({ label: x._id, value: x.value }));

  // New patients per month
  const pm = await M('patients').aggregate([
    { $match: { ...nd, createdAt: { $gte: sixMonthsAgo } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: tz } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]);
  out.charts.patientsMonthly = pm.map((x) => ({ label: x._id, value: x.value }));

  // Appointments next/previous 14 days
  const ap = await M('appointments').aggregate([
    { $match: { ...nd, date: { $gte: days14, $lte: today }, status: { $nin: ['Cancelled'] } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]);
  const apMap = Object.fromEntries(ap.map((x) => [x._id, x.value]));
  out.charts.apptDaily = Array.from({ length: 14 }, (_, i) => { const d = ymd(addDays(days14, i)); return { label: d.slice(5), value: apMap[d] || 0 }; });

  // Top doctors this month
  const td = await M('appointments').aggregate([
    { $match: { ...nd, date: { $gte: monthStart }, status: { $nin: ['Cancelled', 'No-show'] } } },
    { $group: { _id: '$doctor', value: { $sum: 1 } } }, { $sort: { value: -1 } }, { $limit: 5 },
  ]);
  const docs = await M('doctors').find({ _id: { $in: td.map((x) => x._id) } }).select('name').lean();
  out.charts.topDoctors = td.map((x) => ({ label: docs.find((d) => String(d._id) === String(x._id))?.name || '—', value: x.value }));

  if (finance) {
    const monthStr = `${todayStr().slice(0, 7)}-01`;
    const salesSince = (fromStr) => M('pharmacySales').aggregate([
      { $match: { ...nd, status: { $ne: 'Refunded' }, createdAt: { $gte: addDays(today, -40) } } },
      { $addFields: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } } } },
      { $match: { d: { $gte: fromStr } } },
      { $group: { _id: null, v: { $sum: '$amountPaid' } } },
    ]);
    const [payToday, payMonth, salesToday, salesMonth, expMonth, dues] = await Promise.all([
      M('payments').aggregate([{ $match: { ...nd, status: 'Received', date: today } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
      M('payments').aggregate([{ $match: { ...nd, status: 'Received', date: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
      salesSince(todayStr()),
      salesSince(monthStr),
      M('expenses').aggregate([{ $match: { ...nd, date: { $gte: monthStart } } }, { $group: { _id: null, v: { $sum: '$amount' } } }]),
      M('invoices').aggregate([{ $match: { ...nd, status: { $in: ['Unpaid', 'Partial'] } } }, { $group: { _id: null, v: { $sum: '$balance' } } }]),
    ]);
    const v = (a) => round2(a[0]?.v || 0);
    out.finance = {
      revenueToday: v(payToday) + v(salesToday), revenueMonth: v(payMonth) + v(salesMonth), expensesMonth: v(expMonth), dues: v(dues),
    };
    const rv = await M('payments').aggregate([
      { $match: { ...nd, status: 'Received', date: { $gte: days14, $lte: today } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, value: { $sum: '$amount' } } },
    ]);
    const rvMap = Object.fromEntries(rv.map((x) => [x._id, x.value]));
    out.charts.revenueDaily = Array.from({ length: 14 }, (_, i) => { const d = ymd(addDays(days14, i)); return { label: d.slice(5), value: round2(rvMap[d] || 0) }; });
  }

  out.upcoming = (await M('appointments').find({ ...nd, date: today, status: { $in: ['Scheduled', 'Confirmed', 'Checked-in', 'In-progress'] } })
    .sort({ time: 1 }).limit(8).populate('patient', 'code name').populate('doctor', 'name').lean())
    .map((a) => ({ _id: a._id, code: a.code, time: a.time, status: a.status, patient: a.patient?.name, doctor: a.doctor?.name }));
  out.announcements = await M('announcements').find({ ...nd, active: true, $or: [{ expiryDate: { $exists: false } }, { expiryDate: null }, { expiryDate: { $gte: today } }] })
    .sort({ publishDate: -1 }).limit(4).select('title body priority publishDate').lean();
  out.recentPatients = await M('patients').find(nd).sort({ createdAt: -1 }).limit(6).select('code name gender phone createdAt').lean();
  res.json(out);
}));

// ───────────── doctor slots ─────────────
router.get('/slots', asyncH(async (req, res) => {
  const { doctor, date: d } = req.query;
  if (!doctor || !/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw new HttpError(400, 'doctor and date (YYYY-MM-DD) are required');
  const doc = await M('doctors').findOne({ _id: doctor, ...nd }).lean();
  if (!doc) throw new HttpError(404, 'Doctor not found');
  const day = DAY_NAMES[toDateOnly(d).getUTCDay()];
  const info = { doctor: doc.name, day, fee: doc.fee, room: doc.room };
  if (doc.status !== 'Active') return res.json({ ...info, slots: [], message: `Doctor is ${doc.status}` });
  if (doc.workDays?.length && !doc.workDays.includes(day)) return res.json({ ...info, slots: [], message: `Dr. ${doc.name} does not work on ${day}` });
  const step = doc.slotMinutes || 15;
  const start = hhmmToMin(doc.startTime || '09:00');
  const end = hhmmToMin(doc.endTime || '17:00');
  const booked = await M('appointments').find({ doctor, date: toDateOnly(d), status: { $nin: ['Cancelled', 'No-show'] }, ...nd }).select('time patient status').populate('patient', 'name').lean();
  const bookedMap = Object.fromEntries(booked.map((b) => [b.time, b.patient?.name || 'Booked']));
  const isToday = d === todayStr();
  const nowMin = hhmmToMin(nowTime());
  const slots = [];
  for (let m = start; m + step <= end; m += step) {
    const time = minToHhmm(m);
    const past = d < todayStr() || (isToday && m <= nowMin);
    slots.push({ time, available: !bookedMap[time] && !past, bookedBy: bookedMap[time], past });
  }
  res.json({ ...info, slots });
}));

// ───────────── patient 360 ─────────────
router.get('/patient/:id/summary', asyncH(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
  const id = req.params.id;
  const patient = await M('patients').findOne({ _id: id, ...nd }).populate('insuranceProvider', 'name').lean();
  if (!patient) throw new HttpError(404, 'Patient not found');
  const role = req.user.role;
  const clinical = ['admin', 'doctor', 'nurse'].includes(role);
  const money = ['admin', 'accountant', 'receptionist'].includes(role);
  const q = { patient: id, ...nd };
  const lim = (m, sort, n = 15, pop = []) => {
    let c = M(m).find(q).sort(sort).limit(n);
    for (const p of pop) c = c.populate(p[0], p[1]);
    return c.lean();
  };
  const [appointments, consultations, prescriptions, labOrders, vitals, admissions, immunizations, documents, invoices, radiology] = await Promise.all([
    can(req.user, getModule('appointments').roles.read) ? lim('appointments', { date: -1 }, 15, [['doctor', 'name specialization']]) : [],
    clinical ? lim('consultations', { date: -1 }, 15, [['doctor', 'name']]) : [],
    can(req.user, getModule('prescriptions').roles.read) ? lim('prescriptions', { date: -1 }, 15, [['doctor', 'name']]) : [],
    can(req.user, getModule('labOrders').roles.read) ? lim('labOrders', { createdAt: -1 }, 15) : [],
    clinical ? lim('vitals', { recordedAt: -1 }, 20) : [],
    can(req.user, getModule('admissions').roles.read) ? lim('admissions', { admitDate: -1 }, 10, [['doctor', 'name'], ['bed', 'bedNumber ward']]) : [],
    clinical ? lim('immunizations', { date: -1 }, 20) : [],
    can(req.user, getModule('documents').roles.read) ? lim('documents', { date: -1 }, 20) : [],
    money ? lim('invoices', { createdAt: -1 }, 15) : [],
    can(req.user, getModule('radiology').roles.read) ? lim('radiology', { createdAt: -1 }, 10) : [],
  ]);
  const dues = invoices.filter((i) => ['Unpaid', 'Partial'].includes(i.status)).reduce((s, i) => s + (i.balance || 0), 0);
  res.json({
    patient, appointments, consultations, prescriptions, labOrders, vitals, admissions, immunizations, documents, invoices, radiology, dues: round2(dues),
  });
}));

// ───────────── global search ─────────────
router.get('/search', asyncH(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const rx = new RegExp(escapeRegex(term), 'i');
  const keys = ['patients', 'doctors', 'appointments', 'invoices', 'labOrders', 'medicines', 'prescriptions', 'admissions', 'staff', 'suppliers'];
  const groups = await Promise.all(keys.map(async (key) => {
    const cfg = getModule(key);
    if (!cfg || !can(req.user, cfg.roles.read)) return null;
    const ors = (cfg.search || []).map((s) => ({ [s]: rx }));
    const docs = await M(key).find({ ...nd, $or: ors }).sort(cfg.sort || { createdAt: -1 }).limit(6).lean();
    if (!docs.length) return null;
    return {
      key, label: cfg.label, icon: cfg.icon,
      results: docs.map((d) => ({ _id: d._id, title: d.name || d.itemName || d.code || labelOf(cfg, d), sub: [d.code, d.phone, d.specialization, d.genericName].filter(Boolean).join(' · ') })),
    };
  }));
  res.json(groups.filter(Boolean));
}));

// ───────────── notifications / alerts ─────────────
router.get('/notifications', asyncH(async (req, res) => {
  const s = await getSettings();
  const today = todayDate();
  const alertDate = addDays(today, s.expiryAlertDays || 60);
  const out = [];
  const allow = (key) => can(req.user, getModule(key).roles.read);
  const push = (type, severity, title, link) => out.push({ type, severity, title, link });

  if (allow('medicines')) {
    const low = await M('medicines').countDocuments({ ...nd, active: { $ne: false }, $expr: { $lte: ['$stock', '$reorderLevel'] } });
    if (low) push('stock', 'warning', `${low} medicine(s) at or below reorder level`, '/m/medicines?lowStock=1');
    const exp = await M('medicines').countDocuments({ ...nd, stock: { $gt: 0 }, expiryDate: { $gte: today, $lte: alertDate } });
    if (exp) push('expiry', 'warning', `${exp} medicine(s) expiring within ${s.expiryAlertDays} days`, '/m/medicines?expiring=1');
    const expd = await M('medicines').countDocuments({ ...nd, stock: { $gt: 0 }, expiryDate: { $lt: today } });
    if (expd) push('expired', 'danger', `${expd} expired medicine(s) still in stock`, '/m/medicines?expired=1');
  }
  if (allow('appointments')) {
    const n = await M('appointments').countDocuments({ ...nd, date: today, status: { $in: ['Scheduled', 'Confirmed', 'Checked-in'] } });
    if (n) push('appointments', 'info', `${n} appointment(s) pending today`, `/m/appointments?from=${ymd(today)}&to=${ymd(today)}`);
  }
  if (allow('labOrders')) {
    const n = await M('labOrders').countDocuments({ ...nd, status: { $in: ['Ordered', 'Sample Collected', 'In Progress'] } });
    if (n) push('lab', 'info', `${n} lab order(s) awaiting results`, '/m/labOrders');
  }
  if (allow('invoices') && can(req.user, FIN_ROLES.concat('receptionist'))) {
    const n = await M('invoices').countDocuments({ ...nd, status: { $in: ['Unpaid', 'Partial'] }, dueDate: { $lt: today } });
    if (n) push('invoices', 'danger', `${n} overdue invoice(s)`, '/m/invoices');
  }
  if (allow('equipment')) {
    const n = await M('equipment').countDocuments({ ...nd, status: { $ne: 'Retired' }, nextMaintenance: { $lte: addDays(today, 7) } });
    if (n) push('equipment', 'warning', `${n} equipment item(s) due for maintenance`, '/m/equipment');
  }
  if (allow('bloodBank')) {
    const n = await M('bloodBank').countDocuments({ ...nd, status: 'Available', expiryDate: { $lte: addDays(today, 3) } });
    if (n) push('blood', 'warning', `${n} blood unit(s) expire within 3 days`, '/m/bloodBank');
  }
  if (allow('inventory')) {
    const n = await M('inventory').countDocuments({ ...nd, $expr: { $lte: ['$quantity', '$minQuantity'] } });
    if (n) push('inventory', 'warning', `${n} inventory item(s) running low`, '/m/inventory');
  }
  if (allow('tasks')) {
    const n = await M('tasks').countDocuments({ ...nd, assignedTo: req.user._id, status: { $ne: 'Done' }, dueDate: { $lte: today } });
    if (n) push('tasks', 'info', `${n} task(s) assigned to you are due`, '/m/tasks');
  }
  res.json(out);
}));

// ───────────── reports ─────────────
router.get('/reports', (req, res) => res.json(REPORT_LIST.filter((r) => can(req.user, r.roles))));
router.get('/reports/:name', asyncH(async (req, res) => {
  const def = REPORT_LIST.find((r) => r.key === req.params.name);
  if (!def) throw new HttpError(404, 'Unknown report');
  if (!can(req.user, def.roles)) throw new HttpError(403, 'You do not have access to this report');
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : todayStr();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : `${todayStr().slice(0, 7)}-01`;
  res.json({ ...(await buildReport(def.key, from, to)), from, to });
}));

// ───────────── backup (admin) ─────────────
router.get('/backup', requireRole('admin'), asyncH(async (req, res) => {
  const dump = { exportedAt: new Date().toISOString(), collections: {} };
  for (const m of moduleList) {
    if (m.key === 'users') {
      dump.collections.users = await models.users.find({}).select('-lockUntil -loginAttempts').lean();
    } else dump.collections[m.key] = await models[m.key].find({}).lean();
  }
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="medidesk-backup-${todayStr()}.json"`);
  res.send(JSON.stringify(dump));
}));

export default router;
