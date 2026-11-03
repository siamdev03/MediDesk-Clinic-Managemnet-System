import crypto from 'crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const TZ = () => process.env.TIMEZONE || 'Asia/Dhaka';

// "YYYY-MM-DD" for today in the clinic timezone
export function todayStr(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
// "HH:MM" now in the clinic timezone
export function nowTime(d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
// date-only fields are stored as UTC midnight
export const toDateOnly = (s) => new Date(`${s}T00:00:00.000Z`);
export const todayDate = () => toDateOnly(todayStr());
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * 86400000);
export const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const randomToken = (n = 5) => crypto.randomBytes(n).toString('hex');
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const hhmmToMin = (t) => {
  const [h, m] = String(t || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const minToHhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
