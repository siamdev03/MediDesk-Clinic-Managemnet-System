// Feature 2: public online appointment booking (no login). Mounted at /api/public.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { M } from '../config/registry.js';
import { engine } from '../config/engine.js';
import { getSettings } from '../config/settings.js';
import { slotsFor } from '../services/slots.js';
import { als } from '../utils/context.js';
import { asyncH, HttpError, toDateOnly, todayStr, ymd } from '../utils/helpers.js';

const router = Router();
const nd = { deleted: { $ne: true } };
const SYSTEM_USER = { name: 'Online booking', role: 'admin' };
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests, please try later' } });
const bookLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 12, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many bookings from this device, please call the clinic' } });
router.use(limiter);

export const digits = (p) => String(p || '').replace(/\D/g, '');
export const last10 = (p) => digits(p).slice(-10);

router.get('/clinic', asyncH(async (req, res) => {
  const s = await getSettings();
  res.json({ clinicName: s.clinicName, tagline: s.tagline, address: s.address, phone: s.phone, email: s.email, currency: s.currency, openTime: s.openTime, closeTime: s.closeTime });
}));

router.get('/doctors', asyncH(async (req, res) => {
  const docs = await M('doctors').find({ status: 'Active', ...nd }).sort({ name: 1 }).select('name specialization qualification fee workDays startTime endTime room photo bio experienceYears').lean();
  res.json(docs);
}));

router.get('/slots', asyncH(async (req, res) => res.json(await slotsFor(req.query.doctor, req.query.date))));

// Finds the patient by phone + name (family members share phones) or registers a new one.
export async function findOrCreatePatient({ name, phone, gender, age, email }) {
  const cleanName = String(name || '').trim();
  const l10 = last10(phone);
  if (cleanName.length < 2) throw new HttpError(400, 'Please enter the patient name');
  if (l10.length < 10) throw new HttpError(400, 'Please enter a valid mobile number');
  const sameNumber = await M('patients').find({ phone: { $regex: l10.slice(-4) }, ...nd }).lean();
  const hit = sameNumber.find((p) => last10(p.phone) === l10 && p.name.trim().toLowerCase() === cleanName.toLowerCase());
  if (hit) return hit;
  return engine.createRecord('patients', {
    name: cleanName, phone: String(phone).trim(), gender: ['Male', 'Female', 'Other'].includes(gender) ? gender : 'Other', age: age ? Number(age) : undefined, email: email || undefined,
  }, SYSTEM_USER, { internal: true });
}

export async function bookAppointment({ patient, doctorId, date, time, reason, source }) {
  const doc = await M('doctors').findOne({ _id: doctorId, status: 'Active', ...nd }).lean();
  if (!doc) throw new HttpError(404, 'Doctor not available');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date < todayStr()) throw new HttpError(400, 'Choose a valid future date');
  const free = (await slotsFor(doctorId, date)).slots.find((s) => s.time === time);
  if (!free?.available) throw new HttpError(409, 'That time was just taken – please pick another slot');
  return als.run({ branch: doc.branch ? String(doc.branch) : null }, async () => {
    const p = patient._id ? patient : await patient();
    const a = await engine.createRecord('appointments', {
      patient: String(p._id), doctor: String(doc._id), date, time, type: 'Consultation', status: 'Scheduled', fee: doc.fee, reason: String(reason || '').slice(0, 300),
    }, SYSTEM_USER, { internal: true, raw: { source } });
    return { code: a.code, id: a._id, date: ymd(a.date), time: a.time, doctor: doc.name, room: doc.room, fee: doc.fee, patientCode: p.code };
  });
}

router.post('/book', bookLimiter, asyncH(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true, code: 'APT-000000' }); // honeypot field filled by bots
  const result = await bookAppointment({
    patient: () => findOrCreatePatient(b), doctorId: b.doctor, date: b.date, time: b.time, reason: b.reason, source: 'Online',
  });
  res.json({ ok: true, ...result });
}));

export default router;