// Extra modules, extra fields on existing modules and extra business rules for the 25 add-on features.
// registry.js merges everything exported here with modules.js / logic.js.
import { text, area, num, money, date, dtime, sel, ref, items, bool, phone } from './fields.js';
import { HttpError, ymd } from '../utils/helpers.js';
import { dayTotals } from '../services/finance.js';
import { notifyAppointment, sendMessage } from '../services/notify.js';

const R = (read, write, del) => ({ read, write, delete: del || ['admin'] });
const ALL = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'labtech', 'accountant'];

export const featureModules = [
  {
    key: 'branches', label: 'Branches', group: 'Admin', icon: '🏢', prefix: 'BR',
    display: ['name'], search: ['name', 'code', 'address'], sort: { name: 1 },
    roles: R(ALL, ['admin']),
    fields: [
      text('name', 'Branch name', { required: true, list: true }),
      text('address', 'Address', { list: true }),
      phone('phone', 'Phone', { list: true }),
      bool('active', 'Active', { default: true, list: true }),
    ],
  },
  {
    key: 'messageLogs', label: 'Message Log', group: 'Communication', icon: '💬',
    display: ['channel', 'to'], search: ['to', 'subject', 'body'], dateField: 'createdAt', sort: { createdAt: -1 },
    roles: R(['admin', 'receptionist'], ['admin']), readOnly: true,
    fields: [
      sel('channel', 'Channel', ['SMS', 'WhatsApp', 'Email'], { list: true, filter: true }),
      text('to', 'To', { list: true }),
      text('subject', 'Subject'),
      area('body', 'Message', { list: true }),
      sel('status', 'Status', ['Sent', 'Mock', 'Failed'], { list: true, filter: true }),
      text('provider', 'Provider', { list: true }),
      text('error', 'Error'),
      text('relatedModule', 'Related module'),
      text('relatedId', 'Related record'),
    ],
  },
  {
    key: 'rxTemplates', label: 'Prescription Templates', group: 'Clinical', icon: '📋', prefix: 'RXT',
    display: ['name'], search: ['name', 'diagnosis'], sort: { name: 1 },
    roles: R(['admin', 'doctor', 'nurse'], ['admin', 'doctor']),
    fields: [
      text('name', 'Template name', { required: true, list: true }),
      text('diagnosis', 'Diagnosis', { list: true }),
      items('items', 'Medicines', [
        ref('medicine', 'Medicine', 'medicines', { fill: { medicineName: 'name' } }),
        text('medicineName', 'Name', { required: true }),
        text('dosage', 'Dosage'),
        sel('frequency', 'Frequency', ['1+0+1', '1+1+1', '1+0+0', '0+0+1', '0+1+0', 'Once daily', 'Twice daily', 'Thrice daily', 'SOS', 'Weekly']),
        text('duration', 'Duration'),
        num('quantity', 'Qty', { default: 1 }),
        sel('instructions', 'Instructions', ['Before meal', 'After meal', 'With meal', 'Empty stomach', 'At bedtime']),
      ], { required: true }),
      area('advice', 'Advice / instructions'),
    ],
  },
  {
    key: 'cashClosings', label: 'Daily Cash Closing', group: 'Billing', icon: '🧮', prefix: 'CC',
    display: ['code'], search: ['code', 'notes'], dateField: 'date', sort: { date: -1 }, noEdit: true,
    roles: R(['admin', 'accountant', 'receptionist'], ['admin', 'accountant', 'receptionist']),
    fields: [
      date('date', 'Business date', { required: true, list: true, default: 'today' }),
      money('openingCash', 'Opening cash in drawer'),
      money('countedCash', 'Counted cash now', { required: true, list: true }),
      money('billingCash', 'Billing – cash', { form: false }),
      money('billingCard', 'Billing – card', { form: false }),
      money('billingMobile', 'Billing – mobile banking', { form: false }),
      money('billingOther', 'Billing – other', { form: false }),
      money('pharmacyCash', 'Pharmacy – cash', { form: false }),
      money('pharmacyNonCash', 'Pharmacy – card/mobile/other', { form: false }),
      money('expensesCash', 'Cash expenses paid', { form: false }),
      money('expectedCash', 'Expected cash in drawer', { form: false, list: true }),
      money('difference', 'Difference (counted − expected)', { form: false, list: true }),
      money('totalCollected', 'Total collected (all methods)', { form: false }),
      ref('closedBy', 'Closed by', 'users', { form: false }),
      area('notes', 'Notes'),
    ],
  },
  {
    key: 'onlinePayments', label: 'Online Payments', group: 'Billing', icon: '📲', prefix: 'OP',
    display: ['code'], search: ['code', 'tranId', 'gatewayRef'], dateField: 'createdAt', sort: { createdAt: -1 },
    roles: R(['admin', 'accountant'], ['admin']), readOnly: true,
    fields: [
      ref('invoice', 'Invoice', 'invoices', { list: true }),
      ref('patient', 'Patient', 'patients', { list: true }),
      money('amount', 'Amount', { list: true }),
      text('provider', 'Provider', { list: true, filter: true }),
      sel('status', 'Status', ['Initiated', 'Processing', 'Success', 'Failed', 'Cancelled'], { list: true, filter: true }),
      text('tranId', 'Transaction id', { list: true }),
      text('gatewayRef', 'Gateway reference'),
      text('payerPhone', 'Payer phone'),
      text('note', 'Note'),
    ],
  },
];

// Adds fields to modules that already exist (called before models are built)
export function patchModules(mods) {
  const by = Object.fromEntries(mods.map((m) => [m.key, m]));
  by.doctors.fields.push(num('commissionPct', 'Commission % of consultation fee', { min: 0, max: 100, default: 0 }));
  by.users.fields.push(ref('branch', 'Home branch (blank = all)', 'branches'));
  by.users.extraSchema = { ...by.users.extraSchema, totpSecret: { type: String, select: false }, totpEnabled: { type: Boolean, default: false } };
  by.appointments.fields.push(sel('source', 'Booked via', ['Staff', 'Online', 'Portal'], { form: false, default: 'Staff' }));
  by.appointments.extraSchema = { ...by.appointments.extraSchema, reminderSent: { type: Boolean, default: false } };
  by.consultations.extraSchema = { ...by.consultations.extraSchema, followUpReminded: { type: Boolean, default: false } };
}

// Hooks / actions / tools merged into the existing logic by registry.js
export const featureLogic = {
  appointments: {
    hooks: {
      afterCreate(doc) { notifyAppointment(doc._id, 'confirm').catch((e) => console.error('confirmation SMS failed:', e.message)); },
    },
    actions: [
      {
        key: 'remind', label: 'Send reminder now', roles: ['admin', 'receptionist'], when: { field: 'status', in: ['Scheduled', 'Confirmed'] },
        async run(d) { await notifyAppointment(d._id, 'reminder'); return { message: 'Reminder sent (see Communication ▸ Message Log)' }; },
      },
    ],
  },
  users: {
    actions: [
      {
        key: 'reset2fa', label: 'Reset two-factor login', roles: ['admin'], confirm: 'Turn off two-factor login for this user?',
        run(d) { d.totpEnabled = false; d.totpSecret = undefined; return { message: 'Two-factor login reset' }; },
      },
    ],
  },
  messageLogs: {
    tools: [
      {
        key: 'test', label: 'Send a test message', roles: ['admin'],
        fields: [
          sel('channel', 'Channel', ['SMS', 'WhatsApp', 'Email'], { required: true, default: 'SMS' }),
          text('to', 'To (phone or e-mail)', { required: true }),
          text('body', 'Message', { required: true, default: 'Test message from MediDesk' }),
        ],
        async run(input) {
          const r = await sendMessage({ channel: input.channel, to: input.to, subject: 'MediDesk test', body: input.body });
          if (!r.ok) throw new HttpError(400, `Sending failed: ${r.error || 'see Message Log'}`);
          return { message: r.status === 'Mock' ? 'Mock mode: message only written to the log (configure a provider in .env to really send)' : 'Message sent' };
        },
      },
    ],
  },
  cashClosings: {
    hooks: {
      async beforeCreate(data, ctx) {
        if (await ctx.M('cashClosings').exists({ date: data.date, deleted: { $ne: true } })) throw new HttpError(400, `Cash for ${ymd(data.date)} is already closed`);
        const t = await dayTotals(ymd(data.date));
        const opening = Number(data.openingCash) || 0;
        const counted = Number(data.countedCash);
        if (Number.isNaN(counted)) throw new HttpError(400, 'Enter the counted cash');
        Object.assign(data, {
          openingCash: opening,
          billingCash: t.billing.cash, billingCard: t.billing.card, billingMobile: t.billing.mobile, billingOther: t.billing.other,
          pharmacyCash: t.pharmacy.cash, pharmacyNonCash: Math.round((t.pharmacy.card + t.pharmacy.mobile + t.pharmacy.other) * 100) / 100,
          expensesCash: t.expensesCash, totalCollected: t.totalCollected,
          expectedCash: Math.round((opening + t.expectedCash) * 100) / 100,
        });
        data.difference = Math.round((counted - data.expectedCash) * 100) / 100;
        data.closedBy = ctx.user?._id;
      },
    },
  },
};