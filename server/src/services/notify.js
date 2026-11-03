// Features 1 & 4: SMS / WhatsApp / Email sending with pluggable providers.
// Default provider is "mock": nothing leaves your machine, the message is only written to Communication ▸ Message Log.
//   SMS_PROVIDER=mock|twilio|bulksmsbd      WHATSAPP_PROVIDER=mock|twilio      email: set SMTP_HOST (else mock)
import { M } from '../config/registry.js';
import { getSettings } from '../config/settings.js';

const env = (k, d = '') => process.env[k] || d;

export function normalizePhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('01') && d.length === 11) d = `88${d}`;
  return d; // 8801XXXXXXXXX
}

async function log(entry) {
  try { await M('messageLogs').create(entry); } catch (e) { console.error('message log failed:', e.message); }
}

async function smsTwilio(to, body, whatsapp) {
  const sid = env('TWILIO_SID'); const token = env('TWILIO_TOKEN');
  const from = whatsapp ? `whatsapp:${env('TWILIO_WHATSAPP_FROM')}` : env('TWILIO_FROM');
  const dest = `${whatsapp ? 'whatsapp:' : ''}+${normalizePhone(to)}`;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: dest, From: from, Body: body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.message || `Twilio error ${res.status}`);
  return j.sid;
}

async function smsBulkSmsBd(to, body) {
  const url = `http://bulksmsbd.net/api/smsapi?${new URLSearchParams({ api_key: env('BULKSMS_API_KEY'), type: 'text', number: normalizePhone(to), senderid: env('BULKSMS_SENDER'), message: body })}`;
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j.response_code && Number(j.response_code) !== 202)) throw new Error(j.error_message || j.response_code || `BulkSMSBD error ${res.status}`);
  return String(j.response_code || 'ok');
}

async function transport() {
  if (!env('SMTP_HOST')) return null;
  const nodemailer = (await import('nodemailer')).default;
  return nodemailer.createTransport({
    host: env('SMTP_HOST'), port: Number(env('SMTP_PORT', '587')), secure: env('SMTP_SECURE') === 'true',
    auth: env('SMTP_USER') ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') } : undefined,
  });
}

// channel: 'SMS' | 'WhatsApp' | 'Email'. Never throws: returns { ok, status }.
export async function sendMessage({ channel = 'SMS', to, subject, body, html, attachments, relatedModule, relatedId }) {
  const entry = { channel, to: String(to || ''), subject, body: String(body || '').slice(0, 1000), relatedModule, relatedId: relatedId ? String(relatedId) : undefined };
  if (!to) { await log({ ...entry, status: 'Failed', error: 'No recipient' }); return { ok: false, status: 'Failed' }; }
  try {
    let provider = 'mock';
    if (channel === 'Email') {
      const t = await transport();
      if (t) {
        provider = 'smtp';
        const s = await getSettings();
        await t.sendMail({ from: env('MAIL_FROM', `"${s.clinicName}" <${env('SMTP_USER', 'no-reply@medidesk.local')}>`), to, subject, text: body, html, attachments });
      }
    } else if (channel === 'WhatsApp') {
      if (env('WHATSAPP_PROVIDER') === 'twilio') { provider = 'twilio'; await smsTwilio(to, body, true); }
    } else if (env('SMS_PROVIDER') === 'twilio') { provider = 'twilio'; await smsTwilio(to, body, false); }
    else if (env('SMS_PROVIDER') === 'bulksmsbd') { provider = 'bulksmsbd'; await smsBulkSmsBd(to, body); }
    if (provider === 'mock') console.log(`[mock ${channel}] to ${to}: ${subject ? `${subject} – ` : ''}${body}`);
    await log({ ...entry, provider, status: provider === 'mock' ? 'Mock' : 'Sent' });
    return { ok: true, status: provider === 'mock' ? 'Mock' : 'Sent' };
  } catch (e) {
    await log({ ...entry, status: 'Failed', error: String(e.message).slice(0, 300) });
    return { ok: false, status: 'Failed', error: e.message };
  }
}

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// Appointment confirmation / reminder through every channel listed in REMINDER_CHANNELS (default "sms")
export async function notifyAppointment(apptId, kind = 'reminder') {
  const a = await M('appointments').findById(apptId).populate('patient', 'name phone email').populate('doctor', 'name').lean();
  if (!a || !a.patient) return;
  const s = await getSettings();
  const verb = kind === 'confirm' ? 'is booked' : 'is coming up';
  const text = `Dear ${a.patient.name}, your appointment with Dr. ${a.doctor?.name || ''} ${verb}: ${fmtDate(a.date)} at ${a.time}. Ref ${a.code}. – ${s.clinicName}`;
  const channels = env('REMINDER_CHANNELS', 'sms').toLowerCase().split(',').map((x) => x.trim());
  const ctx = { relatedModule: 'appointments', relatedId: a._id };
  if (channels.includes('sms') && a.patient.phone) await sendMessage({ channel: 'SMS', to: a.patient.phone, body: text, ...ctx });
  if (channels.includes('whatsapp') && a.patient.phone) await sendMessage({ channel: 'WhatsApp', to: a.patient.phone, body: text, ...ctx });
  if (channels.includes('email') && a.patient.email) await sendMessage({ channel: 'Email', to: a.patient.email, subject: `Appointment ${a.code}`, body: text, ...ctx });
}