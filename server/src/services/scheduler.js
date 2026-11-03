// Background jobs: appointment & follow-up reminders (1), daily backup (17), error e-mail alert (20).
import { M } from '../config/registry.js';
import { notifyAppointment, sendMessage } from './notify.js';
import { createBackup, listBackups } from './backup.js';
import { range } from './finance.js';
import { toDateOnly, todayStr, addDays, ymd, hhmmToMin } from '../utils/helpers.js';
import { getSettings } from '../config/settings.js';

const env = (k, d) => process.env[k] || d;
const safe = (name, fn) => async () => { try { await fn(); } catch (e) { console.error(`[scheduler] ${name} failed:`, e.message); } };

async function reminders() {
  const hours = Number(env('REMINDER_HOURS', '24'));
  const now = Date.now();
  const today = todayStr();
  const appts = await M('appointments').find({
    date: { $gte: toDateOnly(today), $lte: toDateOnly(ymd(addDays(new Date(), 3))) }, status: { $in: ['Scheduled', 'Confirmed'] }, reminderSent: { $ne: true }, deleted: { $ne: true },
  }).select('date time').lean();
  for (const a of appts) {
    const day = ymd(a.date);
    const at = range(day).start.getTime() + hhmmToMin(a.time) * 60000;
    if (at > now && at - now <= hours * 3600000) {
      await M('appointments').updateOne({ _id: a._id }, { reminderSent: true });
      await notifyAppointment(a._id, 'reminder');
    }
  }
  // follow-up reminders: the day before the follow-up date
  const tomorrow = toDateOnly(ymd(addDays(toDateOnly(today), 1)));
  const fus = await M('consultations').find({ followUpDate: tomorrow, followUpReminded: { $ne: true }, deleted: { $ne: true } }).populate('patient', 'name phone').populate('doctor', 'name').lean();
  const s = await getSettings();
  for (const c of fus) {
    await M('consultations').updateOne({ _id: c._id }, { followUpReminded: true });
    if (c.patient?.phone) await sendMessage({ channel: 'SMS', to: c.patient.phone, body: `Dear ${c.patient.name}, your follow-up visit with Dr. ${c.doctor?.name || ''} is due tomorrow (${ymd(c.followUpDate)}). Call ${s.phone} to book. – ${s.clinicName}`, relatedModule: 'consultations', relatedId: c._id });
  }
}

async function dailyBackup() {
  if (env('AUTO_BACKUP', 'true') === 'false') return;
  if (new Date().getHours() < Number(env('BACKUP_HOUR', '2'))) return;
  const last = listBackups()[0];
  if (last && last.createdAt.toDateString() === new Date().toDateString()) return;
  const b = await createBackup('auto');
  console.log('✔ Automatic backup written:', b.name);
}

let lastAlert = { at: 0, count: 0 };
async function errorAlert() {
  const to = env('ADMIN_ALERT_EMAIL', '');
  if (!to) return;
  const count = await M('errorLogs').countDocuments({ status: 'Open', deleted: { $ne: true } });
  if (count < Number(env('ERROR_ALERT_THRESHOLD', '1'))) { lastAlert = { at: lastAlert.at, count }; return; }
  const due = count > lastAlert.count || Date.now() - lastAlert.at > 6 * 3600000;
  if (!due) return;
  const top = await M('errorLogs').find({ status: 'Open', deleted: { $ne: true } }).sort({ lastSeenAt: -1 }).limit(5).select('message path occurrences').lean();
  const s = await getSettings();
  await sendMessage({ channel: 'Email', to, subject: `[${s.clinicName}] ${count} open error(s) in MediDesk`, body: `${count} open error(s):\n\n${top.map((e) => `• ${e.message} (${e.path || ''}) ×${e.occurrences}`).join('\n')}\n\nOpen Admin ▸ Error Log to review.` });
  lastAlert = { at: Date.now(), count };
}

export function startScheduler() {
  const every = (ms, name, fn, first = 20000) => {
    const run = safe(name, fn);
    setTimeout(run, first).unref();
    setInterval(run, ms).unref();
  };
  every(10 * 60 * 1000, 'reminders', reminders);
  every(60 * 60 * 1000, 'backup', dailyBackup, 60000);
  every(10 * 60 * 1000, 'error-alert', errorAlert, 90000);
  console.log('✔ Scheduler on (reminders, auto-backup, error alerts)');
}