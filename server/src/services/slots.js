import { M } from '../config/registry.js';
import { HttpError, DAY_NAMES, toDateOnly, todayStr, nowTime, hhmmToMin, minToHhmm } from '../utils/helpers.js';

// Free / booked slots of a doctor for one day (same rules as /api/x/slots, usable without login)
export async function slotsFor(doctorId, d) {
  if (!doctorId || !/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw new HttpError(400, 'doctor and date (YYYY-MM-DD) are required');
  const doc = await M('doctors').findOne({ _id: doctorId, deleted: { $ne: true } }).lean();
  if (!doc) throw new HttpError(404, 'Doctor not found');
  const day = DAY_NAMES[toDateOnly(d).getUTCDay()];
  const info = { doctor: doc.name, day, fee: doc.fee, room: doc.room };
  if (doc.status !== 'Active') return { ...info, slots: [], message: `Doctor is ${doc.status}` };
  if (doc.workDays?.length && !doc.workDays.includes(day)) return { ...info, slots: [], message: `Dr. ${doc.name} does not work on ${day}` };
  const step = doc.slotMinutes || 15;
  const start = hhmmToMin(doc.startTime || '09:00');
  const end = hhmmToMin(doc.endTime || '17:00');
  const booked = await M('appointments').find({ doctor: doctorId, date: toDateOnly(d), status: { $nin: ['Cancelled', 'No-show'] }, deleted: { $ne: true } }).select('time').lean();
  const taken = new Set(booked.map((b) => b.time));
  const nowMin = hhmmToMin(nowTime());
  const slots = [];
  for (let m = start; m + step <= end; m += step) {
    const time = minToHhmm(m);
    const past = d < todayStr() || (d === todayStr() && m <= nowMin);
    slots.push({ time, available: !taken.has(time) && !past });
  }
  return { ...info, slots };
}