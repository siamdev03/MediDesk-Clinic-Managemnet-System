// Business rules for every module: validation hooks and one-click workflow actions.
// Hooks receive (data, ctx) before a write; actions receive (doc, input, ctx).
import bcrypt from 'bcryptjs';
import { text, area, num, money, date, dtime, time, sel, ref, password } from './fields.js';
import {
  HttpError, todayDate, todayStr, addDays, ymd, round2, DAY_NAMES, hhmmToMin, randomToken,
} from '../utils/helpers.js';

const PAY = ['Cash', 'Card', 'Mobile Banking', 'Bank Transfer', 'Insurance', 'Cheque'];
const BILLERS = ['admin', 'accountant', 'receptionist'];
const same = (a, b) => String(a) === String(b);
const sid = (v) => String(v && v._id ? v._id : v);
const plainItems = (arr = []) => arr.map((i) => (i.toObject ? i.toObject() : { ...i }));

// ───────────── shared helpers ─────────────
async function moveStock(ctx, medId, delta, type, reference, note) {
  const filter = { _id: medId, deleted: { $ne: true } };
  if (delta < 0) filter.stock = { $gte: -delta };
  const med = await ctx.M('medicines').findOneAndUpdate(filter, { $inc: { stock: delta } }, { new: true });
  if (!med) throw new HttpError(400, 'Insufficient stock (or medicine not found)');
  await ctx.M('stockMovements').create({
    medicine: med._id, type, quantity: delta, balanceAfter: med.stock, reference, note, by: ctx.user?._id,
  });
  return med;
}

async function createInvoiceFor(ctx, patient, lines, link = {}) {
  return ctx.engine.createRecord(
    'invoices',
    { patient: sid(patient), invoiceDate: todayStr(), items: lines },
    ctx.user,
    { internal: true, raw: link, req: ctx.req },
  );
}

const invoiceStatus = (total, paid) => {
  if (total <= 0) return 'Paid';
  if (paid >= total - 0.005) return 'Paid';
  return paid > 0 ? 'Partial' : 'Unpaid';
};

function calcInvoice(rows, discount, taxRate) {
  rows.forEach((r) => { r.amount = round2((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)); });
  const subtotal = round2(rows.reduce((s, r) => s + r.amount, 0));
  const disc = Math.min(Number(discount) || 0, subtotal);
  const tax = round2(((subtotal - disc) * (Number(taxRate) || 0)) / 100);
  return { subtotal, discount: disc, tax, total: round2(subtotal - disc + tax) };
}

async function recalcInvoice(ctx, invoiceId) {
  const inv = await ctx.M('invoices').findById(invoiceId);
  if (!inv || inv.status === 'Cancelled') return;
  const pays = await ctx.M('payments').find({ invoice: invoiceId, deleted: { $ne: true }, status: 'Received' }).lean();
  inv.paid = round2(pays.reduce((s, p) => s + p.amount, 0));
  inv.balance = round2(inv.total - inv.paid);
  inv.status = invoiceStatus(inv.total, inv.paid);
  await inv.save();
}

const bmi = (w, h) => (w > 0 && h > 0 ? Math.round((w / (h / 100) ** 2) * 10) / 10 : undefined);

function autoFlag(result, range) {
  const r = parseFloat(result);
  const m = String(range || '').match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
  if (Number.isNaN(r) || !m) return undefined;
  if (r < +m[1]) return 'Low';
  if (r > +m[2]) return 'High';
  return 'Normal';
}

function overlaps(aStart, aMin, bStart, bMin) {
  const a1 = new Date(aStart).getTime();
  const a2 = a1 + aMin * 60000;
  const b1 = new Date(bStart).getTime();
  const b2 = b1 + bMin * 60000;
  return a1 < b2 && b1 < a2;
}

// ───────────── appointments helpers ─────────────
async function apptConflict(ctx, { doctor, date: d, time, excludeId }) {
  const q = { doctor, date: d, time, status: { $nin: ['Cancelled', 'No-show'] }, deleted: { $ne: true } };
  if (excludeId) q._id = { $ne: excludeId };
  if (await ctx.M('appointments').exists(q)) throw new HttpError(409, 'This doctor already has an appointment at that time');
}
function checkDoctorSchedule(doc, d, time) {
  if (doc.status && doc.status !== 'Active') throw new HttpError(400, `Dr. ${doc.name} is currently "${doc.status}"`);
  const day = DAY_NAMES[new Date(d).getUTCDay()];
  if (doc.workDays?.length && !doc.workDays.includes(day)) throw new HttpError(400, `Dr. ${doc.name} does not work on ${day}`);
  if (doc.startTime && doc.endTime && time) {
    const m = hhmmToMin(time);
    if (m < hhmmToMin(doc.startTime) || m >= hhmmToMin(doc.endTime)) {
      throw new HttpError(400, `Dr. ${doc.name} is available ${doc.startTime} – ${doc.endTime}`);
    }
  }
}

// ───────────── OT helper ─────────────
async function otCheck(ctx, vals, excludeId) {
  const start = new Date(vals.scheduledAt);
  const q = {
    deleted: { $ne: true },
    status: { $nin: ['Cancelled'] },
    scheduledAt: { $gte: addDays(start, -1), $lte: addDays(start, 1) },
    $or: [{ otRoom: vals.otRoom }, { surgeon: vals.surgeon }],
  };
  if (excludeId) q._id = { $ne: excludeId };
  const others = await ctx.M('surgeries').find(q).lean();
  for (const o of others) {
    if (overlaps(start, vals.durationMinutes || 60, o.scheduledAt, o.durationMinutes || 60)) {
      if (o.otRoom === vals.otRoom) throw new HttpError(409, `${vals.otRoom} is already booked at that time (${o.code})`);
      throw new HttpError(409, `The surgeon already has a surgery at that time (${o.code})`);
    }
  }
}

const SHELF_LIFE = { 'Whole Blood': 35, RBC: 42, Platelets: 5, Plasma: 365 };

export const logic = {
  // ═══════════ FRONT DESK ═══════════
  appointments: {
    hooks: {
      async beforeCreate(data, ctx) {
        const doctor = await ctx.M('doctors').findOne({ _id: data.doctor, deleted: { $ne: true } }).lean();
        if (!doctor) throw new HttpError(400, 'Doctor not found');
        const patient = await ctx.M('patients').findOne({ _id: data.patient, deleted: { $ne: true } }).select('status name').lean();
        if (!patient) throw new HttpError(400, 'Patient not found');
        if (patient.status === 'Deceased') throw new HttpError(400, 'Cannot book an appointment for a deceased patient');
        if (data.type !== 'Emergency') checkDoctorSchedule(doctor, data.date, data.time);
        if (['Scheduled', 'Confirmed'].includes(data.status) && new Date(data.date) < todayDate()) {
          throw new HttpError(400, 'Cannot schedule an appointment in the past');
        }
        await apptConflict(ctx, { doctor: data.doctor, date: data.date, time: data.time });
        if (data.fee == null || data.fee === '') data.fee = doctor.fee || 0;
        data.token = (await ctx.M('appointments').countDocuments({ doctor: data.doctor, date: data.date, deleted: { $ne: true } })) + 1;
      },
      async beforeUpdate(data, doc, ctx) {
        if (['doctor', 'date', 'time'].some((k) => k in data)) {
          const merged = {
            doctor: data.doctor || doc.doctor, date: data.date || doc.date, time: data.time || doc.time,
          };
          if (!['Cancelled', 'No-show', 'Completed'].includes(doc.status)) {
            await apptConflict(ctx, { ...merged, excludeId: doc._id });
          }
        }
      },
    },
    actions: [
      { key: 'confirm', label: 'Confirm', when: { field: 'status', in: ['Scheduled'] }, run: (d) => { d.status = 'Confirmed'; } },
      { key: 'checkin', label: 'Check-in', when: { field: 'status', in: ['Scheduled', 'Confirmed'] }, run: (d) => { d.status = 'Checked-in'; } },
      { key: 'start', label: 'Start consultation', when: { field: 'status', in: ['Checked-in'] }, run: (d) => { d.status = 'In-progress'; } },
      {
        key: 'complete', label: 'Mark completed', when: { field: 'status', in: ['Scheduled', 'Confirmed', 'Checked-in', 'In-progress'] },
        run: (d) => { d.status = 'Completed'; },
      },
      {
        key: 'cancel', label: 'Cancel', danger: true, confirm: 'Cancel this appointment?', fields: [text('reason', 'Cancellation reason')],
        when: { field: 'status', in: ['Scheduled', 'Confirmed', 'Checked-in'] },
        run: (d, input) => { d.status = 'Cancelled'; if (input.reason) d.notes = `${d.notes ? `${d.notes}\n` : ''}Cancelled: ${input.reason}`; },
      },
      { key: 'noshow', label: 'No-show', danger: true, when: { field: 'status', in: ['Scheduled', 'Confirmed'] }, run: (d) => { d.status = 'No-show'; } },
      {
        key: 'reschedule', label: 'Reschedule', fields: [date('date', 'New date', { required: true }), time('time', 'New time', { required: true })],
        when: { field: 'status', in: ['Scheduled', 'Confirmed'] },
        async run(d, input, ctx) {
          const doctor = await ctx.M('doctors').findById(d.doctor).lean();
          if (d.type !== 'Emergency') checkDoctorSchedule(doctor, input.date, input.time);
          if (new Date(input.date) < todayDate()) throw new HttpError(400, 'Cannot reschedule to a past date');
          await apptConflict(ctx, { doctor: d.doctor, date: input.date, time: input.time, excludeId: d._id });
          d.date = input.date; d.time = input.time; d.status = 'Scheduled';
        },
      },
      {
        key: 'bill', label: 'Create invoice', roles: BILLERS.concat('doctor'),
        when: { field: 'status', in: ['Scheduled', 'Confirmed', 'Checked-in', 'In-progress', 'Completed'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists for this appointment');
          if (!d.fee || d.fee <= 0) throw new HttpError(400, 'Appointment fee is zero – set a fee first');
          const doctor = await ctx.M('doctors').findById(d.doctor).lean();
          const inv = await createInvoiceFor(ctx, d.patient, [{ description: `Consultation – Dr. ${doctor?.name || ''}`, quantity: 1, unitPrice: d.fee }], { appointment: d._id });
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created` };
        },
      },
    ],
  },

  queue: {
    hooks: {
      async beforeCreate(data, ctx) {
        if (!data.patient && !data.walkInName) throw new HttpError(400, 'Select a patient or enter a walk-in name');
        data.token = (await ctx.M('queue').countDocuments({ doctor: data.doctor, date: data.date, deleted: { $ne: true } })) + 1;
      },
    },
    actions: [
      { key: 'call', label: 'Call patient', when: { field: 'status', in: ['Waiting'] }, run: (d) => { d.status = 'Called'; } },
      { key: 'start', label: 'Start consultation', when: { field: 'status', in: ['Waiting', 'Called'] }, run: (d) => { d.status = 'In-consultation'; } },
      { key: 'done', label: 'Done', when: { field: 'status', in: ['Waiting', 'Called', 'In-consultation'] }, run: (d) => { d.status = 'Done'; } },
      { key: 'skip', label: 'Skip', danger: true, when: { field: 'status', in: ['Waiting', 'Called'] }, run: (d) => { d.status = 'Skipped'; } },
    ],
  },

  teleconsults: {
    hooks: {
      beforeCreate(data) {
        data.status = 'Scheduled';
        if (!data.meetingLink) data.meetingLink = `https://meet.jit.si/MediDesk-${randomToken(6)}`;
      },
    },
    actions: [
      { key: 'start', label: 'Start call', when: { field: 'status', in: ['Scheduled'] }, run: (d) => { d.status = 'Live'; } },
      { key: 'complete', label: 'Complete', when: { field: 'status', in: ['Scheduled', 'Live'] }, run: (d) => { d.status = 'Completed'; } },
      { key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Scheduled'] }, run: (d) => { d.status = 'Cancelled'; } },
    ],
  },

  visitors: {
    actions: [
      { key: 'checkout', label: 'Check-out', when: { field: 'checkOut', empty: true }, run: (d) => { d.checkOut = new Date(); } },
    ],
  },

  // ═══════════ CLINICAL ═══════════
  patients: {
    hooks: {
      async beforeCreate(data, ctx) {
        if (data.phone && data.name) {
          const dup = await ctx.M('patients').findOne({
            deleted: { $ne: true }, phone: data.phone, name: new RegExp(`^${data.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          }).select('code').lean();
          if (dup) throw new HttpError(409, `This patient is already registered (${dup.code})`);
        }
      },
      async beforeDelete(doc, ctx) {
        if (await ctx.M('admissions').exists({ patient: doc._id, status: 'Admitted', deleted: { $ne: true } })) {
          throw new HttpError(409, 'Patient is currently admitted – discharge first');
        }
      },
    },
  },

  consultations: {
    hooks: {
      async afterCreate(doc, ctx) {
        if (doc.appointment) {
          await ctx.M('appointments').updateOne(
            { _id: doc.appointment, status: { $in: ['Scheduled', 'Confirmed', 'Checked-in', 'In-progress'] } },
            { status: 'Completed' },
          );
        }
      },
    },
  },

  vitals: {
    hooks: {
      beforeCreate(data) { data.bmi = bmi(data.weight, data.height); },
      beforeUpdate(data, doc) {
        const w = 'weight' in data ? data.weight : doc.weight;
        const h = 'height' in data ? data.height : doc.height;
        data.bmi = bmi(w, h);
      },
    },
  },

  prescriptions: {
    hooks: { beforeCreate(data) { data.status = 'Active'; } },
    actions: [
      {
        key: 'dispense', label: 'Dispense (pharmacy sale)', roles: ['admin', 'pharmacist', 'doctor'], when: { field: 'status', in: ['Active'] },
        fields: [sel('paymentMethod', 'Payment method', PAY, { default: 'Cash' })],
        async run(d, input, ctx) {
          const lines = d.items.filter((i) => i.medicine && i.quantity > 0).map((i) => ({ medicine: sid(i.medicine), quantity: i.quantity }));
          if (!lines.length) throw new HttpError(400, 'No stock-linked medicines in this prescription');
          const sale = await ctx.engine.createRecord(
            'pharmacySales',
            { patient: sid(d.patient), items: lines, paymentMethod: input.paymentMethod || 'Cash' },
            ctx.user,
            { internal: true, raw: { prescription: d._id }, req: ctx.req },
          );
          d.status = 'Dispensed';
          return { message: `Dispensed – sale ${sale.code} created` };
        },
      },
      { key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Active'] }, run: (d) => { d.status = 'Cancelled'; } },
    ],
  },

  // ═══════════ DIAGNOSTICS ═══════════
  labOrders: {
    hooks: {
      async beforeCreate(data, ctx) {
        await fillLab(ctx, data.items);
        data.total = round2(data.items.reduce((s, i) => s + (Number(i.price) || 0), 0));
        data.status = 'Ordered';
      },
      async beforeUpdate(data, doc, ctx) {
        if (doc.status === 'Cancelled') throw new HttpError(400, 'Cancelled orders cannot be edited');
        if (data.items) {
          await fillLab(ctx, data.items);
          data.total = round2(data.items.reduce((s, i) => s + (Number(i.price) || 0), 0));
        }
      },
    },
    actions: [
      { key: 'collect', label: 'Sample collected', when: { field: 'status', in: ['Ordered'] }, run: (d) => { d.status = 'Sample Collected'; d.sampleCollectedAt = new Date(); } },
      { key: 'process', label: 'Start processing', when: { field: 'status', in: ['Ordered', 'Sample Collected'] }, run: (d) => { d.status = 'In Progress'; } },
      {
        key: 'complete', label: 'Complete & release report', roles: ['admin', 'labtech', 'doctor'], when: { field: 'status', in: ['Ordered', 'Sample Collected', 'In Progress'] },
        async run(d, input, ctx) {
          const missing = d.items.filter((i) => !i.result);
          if (missing.length) {
            const tests = await ctx.M('labTests').find({ _id: { $in: missing.map((m) => m.test) } }).select('name').lean();
            throw new HttpError(400, `Enter results first for: ${tests.map((t) => t.name).join(', ') || `${missing.length} test(s)`}`);
          }
          d.status = 'Completed'; d.completedAt = new Date();
        },
      },
      { key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Ordered', 'Sample Collected', 'In Progress'] }, run: (d) => { d.status = 'Cancelled'; } },
      {
        key: 'bill', label: 'Create invoice', roles: BILLERS.concat('labtech'), when: { field: 'status', in: ['Ordered', 'Sample Collected', 'In Progress', 'Completed'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists for this order');
          const tests = await ctx.M('labTests').find({ _id: { $in: d.items.map((i) => i.test) } }).select('name').lean();
          const name = (id) => tests.find((t) => same(t._id, id))?.name || 'Lab test';
          const lines = d.items.map((i) => ({ description: `Lab: ${name(i.test)}`, quantity: 1, unitPrice: i.price || 0 }));
          const inv = await createInvoiceFor(ctx, d.patient, lines, {});
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created` };
        },
      },
    ],
  },

  radiology: {
    actions: [
      {
        key: 'bill', label: 'Create invoice', roles: BILLERS.concat('labtech'), when: { field: 'status', in: ['Ordered', 'Scheduled', 'Done', 'Reported'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists');
          if (!d.price) throw new HttpError(400, 'Set a price first');
          const inv = await createInvoiceFor(ctx, d.patient, [{ description: `${d.modality}${d.bodyPart ? ` – ${d.bodyPart}` : ''}`, quantity: 1, unitPrice: d.price }]);
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created` };
        },
      },
    ],
  },

  // ═══════════ PHARMACY ═══════════
  medicines: {
    hooks: {
      async afterCreate(doc, ctx) {
        if (doc.stock > 0) {
          await ctx.M('stockMovements').create({ medicine: doc._id, type: 'Opening', quantity: doc.stock, balanceAfter: doc.stock, reference: doc.code, by: ctx.user?._id });
        }
      },
      beforeUpdate(data, doc, ctx) { ctx.prevStock = doc.stock; },
      async afterUpdate(doc, ctx) {
        if (ctx.prevStock !== undefined && ctx.prevStock !== doc.stock) {
          await ctx.M('stockMovements').create({
            medicine: doc._id, type: 'Adjustment', quantity: doc.stock - ctx.prevStock, balanceAfter: doc.stock, reference: doc.code, note: 'Edited manually', by: ctx.user?._id,
          });
        }
      },
    },
    actions: [
      {
        key: 'adjust', label: 'Adjust stock', roles: ['admin', 'pharmacist'],
        fields: [num('change', 'Change (+ add / − remove)', { required: true }), text('reason', 'Reason')],
        async run(d, input, ctx) {
          if (!input.change) throw new HttpError(400, 'Change cannot be 0');
          const m = await moveStock(ctx, d._id, input.change, 'Adjustment', d.code, input.reason);
          return { message: `Stock is now ${m.stock}` };
        },
      },
      {
        key: 'writeoff', label: 'Write off (expired)', danger: true, confirm: 'Remove all remaining stock as expired?', roles: ['admin', 'pharmacist'],
        async run(d, input, ctx) {
          if (!d.stock) throw new HttpError(400, 'No stock to write off');
          await moveStock(ctx, d._id, -d.stock, 'Expired', d.code, 'Written off');
          return { message: 'Stock written off' };
        },
      },
    ],
  },

  pharmacySales: {
    hooks: {
      async beforeCreate(data, ctx) {
        const s = await ctx.getSettings();
        const need = new Map();
        for (const it of data.items) {
          const med = await ctx.M('medicines').findOne({ _id: it.medicine, deleted: { $ne: true } }).lean();
          if (!med) throw new HttpError(400, 'Medicine not found');
          if (med.active === false) throw new HttpError(400, `${med.name} is inactive`);
          if (med.expiryDate && new Date(med.expiryDate) < todayDate()) throw new HttpError(400, `${med.name} is expired and cannot be sold`);
          it.quantity = Number(it.quantity) || 0;
          if (it.quantity <= 0) throw new HttpError(400, 'Quantity must be greater than zero');
          const total = (need.get(sid(med._id)) || 0) + it.quantity;
          need.set(sid(med._id), total);
          if (med.stock < total) throw new HttpError(400, `Not enough stock for ${med.name} (available: ${med.stock})`);
          it.medicineName = it.medicineName || med.name;
          if (it.unitPrice == null) it.unitPrice = med.price;
        }
        const t = calcInvoice(data.items, data.discount, s.pharmacyTaxRate);
        Object.assign(data, t);
        const paid = data.amountPaid == null || data.amountPaid === '' ? t.total : Number(data.amountPaid);
        data.amountPaid = Math.min(paid, t.total);
        data.status = data.amountPaid >= t.total - 0.005 ? 'Paid' : 'Due';
        data.soldBy = ctx.user?._id;
      },
      async afterCreate(doc, ctx) {
        const done = [];
        try {
          for (const it of doc.items) {
            await moveStock(ctx, it.medicine, -it.quantity, 'Sale', doc.code);
            done.push(it);
          }
        } catch (e) {
          for (const it of done) await moveStock(ctx, it.medicine, it.quantity, 'Return', doc.code, 'Rolled back');
          await doc.deleteOne();
          throw e;
        }
      },
    },
    actions: [
      {
        key: 'refund', label: 'Refund / return all', danger: true, confirm: 'Refund this sale and return the items to stock?', when: { field: 'status', in: ['Paid', 'Due'] },
        roles: ['admin', 'pharmacist'],
        async run(d, input, ctx) {
          for (const it of d.items) await moveStock(ctx, it.medicine, it.quantity, 'Return', d.code, 'Refund');
          d.status = 'Refunded';
        },
      },
      {
        key: 'payDue', label: 'Collect due', when: { field: 'status', in: ['Due'] }, roles: ['admin', 'pharmacist', 'accountant'],
        fields: [money('amount', 'Amount received', { required: true })],
        run(d, input) {
          d.amountPaid = round2(Math.min(d.total, (d.amountPaid || 0) + input.amount));
          if (d.amountPaid >= d.total - 0.005) d.status = 'Paid';
        },
      },
    ],
  },

  purchaseOrders: {
    hooks: {
      beforeCreate(data) {
        const t = calcInvoice(data.items, 0, 0);
        data.subtotal = t.subtotal;
        data.total = round2(t.subtotal + (Number(data.tax) || 0));
        data.status = 'Draft';
        data.paymentStatus = 'Unpaid';
      },
      beforeUpdate(data, doc) {
        if (!['Draft', 'Ordered'].includes(doc.status)) throw new HttpError(400, `A ${doc.status.toLowerCase()} order cannot be edited`);
        if (data.items || 'tax' in data) {
          const rows = data.items || plainItems(doc.items);
          const t = calcInvoice(rows, 0, 0);
          data.subtotal = t.subtotal;
          data.total = round2(t.subtotal + (Number('tax' in data ? data.tax : doc.tax) || 0));
        }
      },
    },
    actions: [
      { key: 'order', label: 'Mark as ordered', when: { field: 'status', in: ['Draft'] }, run: (d) => { d.status = 'Ordered'; } },
      {
        key: 'receive', label: 'Receive stock', when: { field: 'status', in: ['Draft', 'Ordered'] }, confirm: 'Receive all items into pharmacy stock?',
        async run(d, input, ctx) {
          for (const it of d.items) {
            await moveStock(ctx, it.medicine, it.quantity, 'Purchase', d.code);
            const upd = {};
            if (it.unitPrice) upd.purchasePrice = it.unitPrice;
            if (it.batchNo) upd.batchNo = it.batchNo;
            if (it.expiryDate) upd.expiryDate = it.expiryDate;
            if (Object.keys(upd).length) await ctx.M('medicines').updateOne({ _id: it.medicine }, upd);
          }
          d.status = 'Received'; d.receivedAt = new Date();
        },
      },
      { key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Draft', 'Ordered'] }, run: (d) => { d.status = 'Cancelled'; } },
      {
        key: 'pay', label: 'Record payment (expense)', roles: ['admin', 'accountant'], when: { field: 'status', in: ['Received'] },
        fields: [sel('method', 'Payment method', PAY, { default: 'Bank Transfer' })],
        async run(d, input, ctx) {
          if (d.paymentStatus === 'Paid') throw new HttpError(400, 'Already paid');
          const sup = await ctx.M('suppliers').findById(d.supplier).select('name').lean();
          await ctx.engine.createRecord('expenses', {
            title: `Purchase order ${d.code}`, category: 'Medicine Purchase', amount: d.total, date: todayStr(), paymentMethod: input.method, paidTo: sup?.name || '',
          }, ctx.user, { internal: true, req: ctx.req });
          d.paymentStatus = 'Paid';
        },
      },
    ],
  },

  // ═══════════ INPATIENT ═══════════
  beds: {
    hooks: {
      async beforeCreate(data, ctx) {
        if (data.dailyCharge == null) {
          const w = await ctx.M('wards').findById(data.ward).lean();
          data.dailyCharge = w?.chargePerDay || 0;
        }
        if (data.status === 'Occupied') data.status = 'Available';
      },
      beforeUpdate(data, doc) {
        if (doc.status === 'Occupied' && data.status && data.status !== 'Occupied') {
          throw new HttpError(400, 'This bed is occupied – discharge or transfer the patient first');
        }
        if (doc.status !== 'Occupied' && data.status === 'Occupied') {
          throw new HttpError(400, 'A bed becomes occupied only through an admission');
        }
      },
      beforeDelete(doc) {
        if (doc.status === 'Occupied') throw new HttpError(409, 'Bed is occupied');
      },
    },
    actions: [
      { key: 'available', label: 'Mark available', when: { field: 'status', in: ['Cleaning', 'Maintenance', 'Reserved'] }, run: (d) => { d.status = 'Available'; } },
      { key: 'maintenance', label: 'Send to maintenance', when: { field: 'status', in: ['Available', 'Cleaning'] }, run: (d) => { d.status = 'Maintenance'; } },
    ],
  },

  admissions: {
    hooks: {
      async beforeCreate(data, ctx) {
        const bed = await ctx.M('beds').findOne({ _id: data.bed, deleted: { $ne: true } });
        if (!bed) throw new HttpError(400, 'Bed not found');
        if (bed.status !== 'Available') throw new HttpError(409, `Bed is ${bed.status.toLowerCase()}, choose an available bed`);
        const p = await ctx.M('patients').findById(data.patient).select('status').lean();
        if (p?.status === 'Deceased') throw new HttpError(400, 'Patient is deceased');
        if (await ctx.M('admissions').exists({ patient: data.patient, status: 'Admitted', deleted: { $ne: true } })) {
          throw new HttpError(409, 'This patient is already admitted');
        }
        data.status = 'Admitted';
      },
      async afterCreate(doc, ctx) {
        await ctx.M('beds').updateOne({ _id: doc.bed }, { status: 'Occupied', currentAdmission: doc._id });
      },
      beforeUpdate(data, doc) {
        if (data.bed && !same(data.bed, doc.bed)) throw new HttpError(400, 'Use the "Transfer bed" action to change the bed');
      },
      async beforeDelete(doc, ctx) {
        if (doc.status === 'Admitted') await ctx.M('beds').updateOne({ _id: doc.bed }, { status: 'Available', $unset: { currentAdmission: 1 } });
      },
    },
    actions: [
      {
        key: 'discharge', label: 'Discharge', when: { field: 'status', in: ['Admitted'] }, confirm: null,
        fields: [area('dischargeSummary', 'Discharge summary', { required: true }), dtime('dischargeDate', 'Discharge date & time', { default: 'now' })],
        async run(d, input, ctx) {
          d.status = 'Discharged';
          d.dischargeDate = input.dischargeDate || new Date();
          d.dischargeSummary = input.dischargeSummary;
          await ctx.M('beds').updateOne({ _id: d.bed }, { status: 'Cleaning', $unset: { currentAdmission: 1 } });
        },
      },
      {
        key: 'transfer', label: 'Transfer bed', when: { field: 'status', in: ['Admitted'] },
        fields: [ref('bed', 'New bed', 'beds', { required: true, refFilter: { status: 'Available' } }), text('reason', 'Reason')],
        async run(d, input, ctx) {
          const nb = await ctx.M('beds').findOne({ _id: input.bed, deleted: { $ne: true } });
          if (!nb || nb.status !== 'Available') throw new HttpError(409, 'Selected bed is not available');
          const ob = await ctx.M('beds').findById(d.bed);
          await ctx.M('beds').updateOne({ _id: ob._id }, { status: 'Cleaning', $unset: { currentAdmission: 1 } });
          await ctx.M('beds').updateOne({ _id: nb._id }, { status: 'Occupied', currentAdmission: d._id });
          d.transferLog = `${d.transferLog ? `${d.transferLog}\n` : ''}${todayStr()}: ${ob.bedNumber} → ${nb.bedNumber}${input.reason ? ` (${input.reason})` : ''}`;
          d.bed = nb._id;
        },
      },
      {
        key: 'bill', label: 'Create bed-charge invoice', roles: BILLERS, when: { field: 'status', in: ['Admitted', 'Discharged'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists for this admission');
          const bed = await ctx.M('beds').findById(d.bed).lean();
          const end = d.dischargeDate || new Date();
          const days = Math.max(1, Math.ceil((new Date(end) - new Date(d.admitDate)) / 86400000));
          if (!bed?.dailyCharge) throw new HttpError(400, 'Bed has no daily charge set');
          const inv = await createInvoiceFor(ctx, d.patient, [{ description: `Bed charges – ${bed.bedNumber} (${days} day${days > 1 ? 's' : ''})`, quantity: days, unitPrice: bed.dailyCharge }], { admission: d._id });
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created for ${days} day(s)` };
        },
      },
    ],
  },

  surgeries: {
    hooks: {
      async beforeCreate(data, ctx) {
        await otCheck(ctx, data);
        data.status = 'Scheduled';
      },
      async beforeUpdate(data, doc, ctx) {
        if (['Completed', 'Cancelled'].includes(doc.status)) throw new HttpError(400, `A ${doc.status.toLowerCase()} surgery cannot be edited`);
        if (['otRoom', 'scheduledAt', 'durationMinutes', 'surgeon'].some((k) => k in data)) {
          await otCheck(ctx, {
            otRoom: data.otRoom || doc.otRoom, scheduledAt: data.scheduledAt || doc.scheduledAt,
            durationMinutes: data.durationMinutes || doc.durationMinutes, surgeon: data.surgeon || doc.surgeon,
          }, doc._id);
        }
      },
    },
    actions: [
      {
        key: 'start', label: 'Start', when: { field: 'status', in: ['Scheduled'] },
        run(d) {
          if (!d.consentSigned) throw new HttpError(400, 'Patient consent must be signed before surgery');
          d.status = 'In-progress';
        },
      },
      {
        key: 'complete', label: 'Complete', when: { field: 'status', in: ['In-progress', 'Scheduled'] }, fields: [area('postOpNotes', 'Post-op notes')],
        run(d, input) { d.status = 'Completed'; if (input.postOpNotes) d.postOpNotes = input.postOpNotes; },
      },
      {
        key: 'reschedule', label: 'Reschedule', when: { field: 'status', in: ['Scheduled'] }, fields: [dtime('scheduledAt', 'New date & time', { required: true })],
        async run(d, input, ctx) {
          await otCheck(ctx, { otRoom: d.otRoom, scheduledAt: input.scheduledAt, durationMinutes: d.durationMinutes, surgeon: d.surgeon }, d._id);
          d.scheduledAt = input.scheduledAt;
        },
      },
      { key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Scheduled', 'Postponed'] }, run: (d) => { d.status = 'Cancelled'; } },
      {
        key: 'bill', label: 'Create invoice', roles: BILLERS, when: { field: 'status', in: ['Scheduled', 'In-progress', 'Completed'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists');
          if (!d.cost) throw new HttpError(400, 'Set the surgery charge first');
          const inv = await createInvoiceFor(ctx, d.patient, [{ description: `Surgery: ${d.procedureName}`, quantity: 1, unitPrice: d.cost }]);
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created` };
        },
      },
    ],
  },

  ambulanceTrips: {
    hooks: { beforeCreate(data) { data.status = 'Requested'; } },
    actions: [
      {
        key: 'dispatch', label: 'Dispatch', when: { field: 'status', in: ['Requested'] },
        async run(d, input, ctx) {
          const r = await ctx.M('ambulances').updateOne({ _id: d.ambulance, status: 'Available' }, { status: 'On trip' });
          if (!r.modifiedCount) throw new HttpError(409, 'Ambulance is not available');
          d.status = 'Dispatched';
        },
      },
      {
        key: 'complete', label: 'Complete trip', when: { field: 'status', in: ['Dispatched'] },
        fields: [num('distanceKm', 'Distance (km)'), money('charge', 'Charge', { defaultFrom: 'charge' })],
        async run(d, input, ctx) {
          if (input.distanceKm != null) d.distanceKm = input.distanceKm;
          if (input.charge != null) d.charge = input.charge;
          d.status = 'Completed';
          await ctx.M('ambulances').updateOne({ _id: d.ambulance }, { status: 'Available' });
        },
      },
      {
        key: 'cancel', label: 'Cancel', danger: true, when: { field: 'status', in: ['Requested', 'Dispatched'] },
        async run(d, input, ctx) {
          if (d.status === 'Dispatched') await ctx.M('ambulances').updateOne({ _id: d.ambulance }, { status: 'Available' });
          d.status = 'Cancelled';
        },
      },
      {
        key: 'bill', label: 'Create invoice', roles: BILLERS, when: { field: 'status', in: ['Completed'] },
        async run(d, input, ctx) {
          if (d.invoice) throw new HttpError(400, 'An invoice already exists');
          if (!d.patient) throw new HttpError(400, 'Link a registered patient to bill the trip');
          if (!d.charge) throw new HttpError(400, 'Trip charge is zero');
          const inv = await createInvoiceFor(ctx, d.patient, [{ description: `Ambulance: ${d.pickup} → ${d.destination}`, quantity: 1, unitPrice: d.charge }]);
          d.invoice = inv._id;
          return { message: `Invoice ${inv.code} created` };
        },
      },
    ],
  },

  bloodBank: {
    hooks: {
      beforeCreate(data) {
        if (new Date(data.expiryDate) <= new Date(data.collectedDate)) throw new HttpError(400, 'Expiry must be after the collection date');
        data.status = 'Available';
      },
    },
    actions: [
      {
        key: 'reserve', label: 'Reserve', when: { field: 'status', in: ['Available'] }, fields: [ref('patient', 'For patient', 'patients', { required: true })],
        run(d, input) { d.status = 'Reserved'; d.issuedTo = input.patient; },
      },
      {
        key: 'issue', label: 'Issue to patient', when: { field: 'status', in: ['Available', 'Reserved'] },
        fields: [ref('patient', 'Patient', 'patients', { required: true }), date('issuedDate', 'Issue date', { default: 'today' })],
        run(d, input) {
          if (new Date(d.expiryDate) < todayDate()) throw new HttpError(400, 'This unit has expired');
          d.status = 'Issued'; d.issuedTo = input.patient; d.issuedDate = input.issuedDate || todayDate();
        },
      },
      { key: 'release', label: 'Release reservation', when: { field: 'status', in: ['Reserved'] }, run: (d) => { d.status = 'Available'; d.issuedTo = undefined; } },
      {
        key: 'discard', label: 'Discard', danger: true, when: { field: 'status', in: ['Available', 'Reserved'] }, fields: [text('reason', 'Reason')],
        run(d, input) { d.status = 'Discarded'; if (input.reason) d.notes = `${d.notes ? `${d.notes}\n` : ''}Discarded: ${input.reason}`; },
      },
    ],
    tools: [
      {
        key: 'expireCheck', label: 'Mark expired units', roles: ['admin', 'labtech', 'nurse'],
        async run(input, ctx) {
          const r = await ctx.M('bloodBank').updateMany({ status: { $in: ['Available', 'Reserved'] }, expiryDate: { $lt: todayDate() }, deleted: { $ne: true } }, { status: 'Expired' });
          return { message: `${r.modifiedCount} unit(s) marked as expired` };
        },
      },
    ],
  },

  bloodDonors: {
    actions: [
      {
        key: 'donate', label: 'Record donation', roles: ['admin', 'labtech', 'nurse'], when: { field: 'status', in: ['Active'] },
        fields: [sel('component', 'Component', Object.keys(SHELF_LIFE), { default: 'Whole Blood' }), num('volumeMl', 'Volume (ml)', { default: 450 })],
        async run(d, input, ctx) {
          const comp = input.component || 'Whole Blood';
          if (d.lastDonation && comp === 'Whole Blood' && (todayDate() - new Date(d.lastDonation)) / 86400000 < 90) {
            throw new HttpError(400, `Donor is not yet eligible (next eligible ${ymd(addDays(d.lastDonation, 90))})`);
          }
          const bag = await ctx.engine.createRecord('bloodBank', {
            bloodGroup: d.bloodGroup, component: comp, volumeMl: input.volumeMl || 450, donor: sid(d._id),
            collectedDate: todayStr(), expiryDate: ymd(addDays(todayDate(), SHELF_LIFE[comp])),
          }, ctx.user, { internal: true, req: ctx.req });
          d.lastDonation = todayDate();
          d.donationCount = (d.donationCount || 0) + 1;
          return { message: `Blood unit ${bag.code} added to the blood bank` };
        },
      },
    ],
  },

  deathRecords: {
    hooks: {
      async afterCreate(doc, ctx) {
        await ctx.M('patients').updateOne({ _id: doc.patient }, { status: 'Deceased' });
        await ctx.M('appointments').updateMany({ patient: doc.patient, status: { $in: ['Scheduled', 'Confirmed'] } }, { status: 'Cancelled' });
      },
    },
  },

  // ═══════════ BILLING ═══════════
  invoices: {
    hooks: {
      async beforeCreate(data, ctx) {
        const s = await ctx.getSettings();
        if (data.taxRate == null) data.taxRate = s.taxRate;
        if (!data.dueDate) data.dueDate = addDays(data.invoiceDate, s.dueDays);
        const t = calcInvoice(data.items, data.discount, data.taxRate);
        Object.assign(data, t, { paid: 0, balance: t.total, status: invoiceStatus(t.total, 0) });
      },
      beforeUpdate(data, doc) {
        if (doc.status === 'Cancelled') throw new HttpError(400, 'Cancelled invoices cannot be edited');
        const rows = data.items || plainItems(doc.items);
        const t = calcInvoice(rows, 'discount' in data ? data.discount : doc.discount, 'taxRate' in data ? data.taxRate : doc.taxRate);
        if (t.total < doc.paid - 0.005) throw new HttpError(400, `Total cannot be lower than the amount already paid (${doc.paid})`);
        Object.assign(data, t, { balance: round2(t.total - doc.paid), status: invoiceStatus(t.total, doc.paid) });
      },
    },
    actions: [
      {
        key: 'addPayment', label: 'Add payment', roles: BILLERS, when: { field: 'status', in: ['Unpaid', 'Partial'] },
        fields: [
          money('amount', 'Amount', { required: true, defaultFrom: 'balance' }), sel('method', 'Method', PAY, { default: 'Cash' }),
          text('reference', 'Reference / txn id'), date('date', 'Date', { default: 'today' }),
        ],
        async run(d, input, ctx) {
          const p = await ctx.engine.createRecord('payments', { invoice: sid(d._id), ...input }, ctx.user, { internal: true, req: ctx.req });
          return { message: `Payment ${p.code} recorded` };
        },
      },
      {
        key: 'cancel', label: 'Cancel invoice', danger: true, confirm: 'Cancel this invoice?', roles: ['admin', 'accountant'], when: { field: 'status', in: ['Unpaid', 'Partial'] },
        run(d) {
          if (d.paid > 0) throw new HttpError(400, 'Refund the received payments first');
          d.status = 'Cancelled'; d.balance = 0;
        },
      },
    ],
  },

  payments: {
    hooks: {
      async beforeCreate(data, ctx) {
        const inv = await ctx.M('invoices').findOne({ _id: data.invoice, deleted: { $ne: true } }).lean();
        if (!inv) throw new HttpError(400, 'Invoice not found');
        if (inv.status === 'Cancelled') throw new HttpError(400, 'Invoice is cancelled');
        if (!(data.amount > 0)) throw new HttpError(400, 'Amount must be greater than zero');
        if (data.amount > inv.balance + 0.005) throw new HttpError(400, `Amount exceeds the balance due (${inv.balance})`);
        data.status = 'Received';
        data.receivedBy = ctx.user?._id;
      },
      async afterCreate(doc, ctx) { await recalcInvoice(ctx, doc.invoice); },
    },
    actions: [
      {
        key: 'refund', label: 'Refund', danger: true, confirm: 'Mark this payment as refunded?', roles: ['admin', 'accountant'], when: { field: 'status', in: ['Received'] },
        async run(d, input, ctx) {
          d.status = 'Refunded';
          await d.save();
          await recalcInvoice(ctx, d.invoice);
        },
      },
    ],
  },

  claims: {
    hooks: {
      async beforeCreate(data, ctx) {
        const inv = await ctx.M('invoices').findById(data.invoice).lean();
        if (!inv) throw new HttpError(400, 'Invoice not found');
        if (data.claimAmount > inv.total + 0.005) throw new HttpError(400, 'Claim amount exceeds the invoice total');
        data.status = 'Submitted';
      },
    },
    actions: [
      {
        key: 'approve', label: 'Approve', when: { field: 'status', in: ['Submitted'] },
        fields: [money('approvedAmount', 'Approved amount', { required: true, defaultFrom: 'claimAmount' })],
        run(d, input) { d.status = 'Approved'; d.approvedAmount = input.approvedAmount; },
      },
      {
        key: 'reject', label: 'Reject', danger: true, when: { field: 'status', in: ['Submitted'] }, fields: [text('notes', 'Reason')],
        run(d, input) { d.status = 'Rejected'; if (input.notes) d.notes = input.notes; },
      },
      {
        key: 'settle', label: 'Mark paid by insurer', when: { field: 'status', in: ['Approved'] }, fields: [text('reference', 'Reference')],
        async run(d, input, ctx) {
          const inv = await ctx.M('invoices').findById(d.invoice).lean();
          const amount = Math.min(d.approvedAmount || 0, inv?.balance || 0);
          if (amount > 0) {
            await ctx.engine.createRecord('payments', { invoice: sid(d.invoice), amount, method: 'Insurance', reference: input.reference || d.code }, ctx.user, { internal: true, req: ctx.req });
          }
          d.status = 'Paid'; d.settledDate = todayDate();
        },
      },
    ],
  },

  // ═══════════ PEOPLE / HR ═══════════
  doctors: {
    hooks: {
      async beforeDelete(doc, ctx) {
        if (await ctx.M('appointments').exists({ doctor: doc._id, date: { $gte: todayDate() }, status: { $in: ['Scheduled', 'Confirmed'] }, deleted: { $ne: true } })) {
          throw new HttpError(409, 'This doctor still has upcoming appointments');
        }
      },
    },
  },

  attendance: {
    tools: [
      {
        key: 'markAll', label: 'Mark everyone present', roles: ['admin'],
        fields: [date('date', 'Date', { required: true, default: 'today' }), sel('status', 'Status', ['Present', 'Absent', 'Late', 'Leave'], { default: 'Present' })],
        async run(input, ctx) {
          const staff = await ctx.M('staff').find({ status: 'Active', deleted: { $ne: true } }).select('_id').lean();
          let n = 0;
          for (const s of staff) {
            if (await ctx.M('attendance').exists({ staff: s._id, date: input.date, deleted: { $ne: true } })) continue;
            await ctx.engine.createRecord('attendance', { staff: sid(s._id), date: ymd(input.date), status: input.status || 'Present' }, ctx.user, { internal: true, req: ctx.req });
            n += 1;
          }
          return { message: `${n} attendance record(s) created` };
        },
      },
    ],
  },

  leaves: {
    hooks: {
      beforeCreate(data) {
        if (new Date(data.to) < new Date(data.from)) throw new HttpError(400, '"To" date cannot be before "From" date');
        data.days = Math.round((new Date(data.to) - new Date(data.from)) / 86400000) + 1;
        data.status = 'Pending';
      },
      beforeUpdate(data, doc) {
        if (doc.status !== 'Pending') throw new HttpError(400, `A ${doc.status.toLowerCase()} request cannot be edited`);
        const from = data.from || doc.from; const to = data.to || doc.to;
        if (new Date(to) < new Date(from)) throw new HttpError(400, '"To" date cannot be before "From" date');
        data.days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
      },
    },
    actions: [
      { key: 'approve', label: 'Approve', roles: ['admin'], when: { field: 'status', in: ['Pending'] }, run: (d, i, ctx) => { d.status = 'Approved'; d.decidedBy = ctx.user._id; } },
      { key: 'reject', label: 'Reject', danger: true, roles: ['admin'], when: { field: 'status', in: ['Pending'] }, run: (d, i, ctx) => { d.status = 'Rejected'; d.decidedBy = ctx.user._id; } },
    ],
  },

  payroll: {
    hooks: {
      beforeCreate(data) {
        data.net = round2((data.basic || 0) + (data.allowances || 0) + (data.bonus || 0) + (data.overtime || 0) - (data.deductions || 0));
        data.status = 'Pending';
      },
      beforeUpdate(data, doc) {
        if (doc.status === 'Paid') throw new HttpError(400, 'Paid payroll cannot be edited');
        const v = (k) => (k in data ? data[k] : doc[k]) || 0;
        data.net = round2(v('basic') + v('allowances') + v('bonus') + v('overtime') - v('deductions'));
      },
    },
    actions: [
      {
        key: 'markPaid', label: 'Mark paid', roles: ['admin', 'accountant'], when: { field: 'status', in: ['Pending'] },
        fields: [sel('method', 'Payment method', PAY, { default: 'Bank Transfer' })],
        async run(d, input, ctx) {
          const st = await ctx.M('staff').findById(d.staff).select('name').lean();
          await ctx.engine.createRecord('expenses', {
            title: `Salary ${d.month} – ${st?.name || ''}`, category: 'Salary', amount: d.net, date: todayStr(), paymentMethod: input.method, paidTo: st?.name || '', reference: d.code,
          }, ctx.user, { internal: true, req: ctx.req });
          d.status = 'Paid'; d.paidDate = todayDate();
        },
      },
    ],
    tools: [
      {
        key: 'generate', label: 'Generate monthly payroll', roles: ['admin', 'accountant'],
        fields: [text('month', 'Month (YYYY-MM)', { required: true, default: 'month' })],
        async run(input, ctx) {
          if (!/^\d{4}-\d{2}$/.test(input.month)) throw new HttpError(400, 'Month must look like 2026-11');
          const staff = await ctx.M('staff').find({ status: 'Active', salary: { $gt: 0 }, deleted: { $ne: true } }).lean();
          let n = 0;
          for (const s of staff) {
            if (await ctx.M('payroll').exists({ staff: s._id, month: input.month, deleted: { $ne: true } })) continue;
            await ctx.engine.createRecord('payroll', { staff: sid(s._id), month: input.month, basic: s.salary }, ctx.user, { internal: true, req: ctx.req });
            n += 1;
          }
          return { message: `Payroll generated for ${n} staff member(s)` };
        },
      },
    ],
  },

  // ═══════════ FACILITY ═══════════
  inventory: {
    actions: [
      {
        key: 'adjust', label: 'Adjust quantity', fields: [num('change', 'Change (+ / −)', { required: true })],
        run(d, input) {
          const q = (d.quantity || 0) + input.change;
          if (q < 0) throw new HttpError(400, 'Quantity cannot go below zero');
          d.quantity = q;
          if (input.change > 0) d.lastRestocked = todayDate();
        },
      },
    ],
  },
  equipment: {
    actions: [
      {
        key: 'serviced', label: 'Log maintenance', fields: [date('date', 'Serviced on', { default: 'today' }), date('nextMaintenance', 'Next maintenance due')],
        run(d, input) { d.lastMaintenance = input.date || todayDate(); if (input.nextMaintenance) d.nextMaintenance = input.nextMaintenance; d.status = 'Working'; },
      },
    ],
  },

  // ═══════════ COMMUNICATION ═══════════
  feedback: {
    actions: [
      { key: 'review', label: 'Mark reviewed', roles: ['admin', 'receptionist'], when: { field: 'status', in: ['New'] }, run: (d) => { d.status = 'Reviewed'; } },
      {
        key: 'resolve', label: 'Resolve', roles: ['admin', 'receptionist'], when: { field: 'status', in: ['New', 'Reviewed'] }, fields: [area('response', 'Response / action taken')],
        run: (d, input) => { d.status = 'Resolved'; if (input.response) d.response = input.response; },
      },
    ],
  },
  tasks: {
    actions: [
      { key: 'start', label: 'Start', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'labtech', 'accountant'], when: { field: 'status', in: ['Todo'] }, run: (d) => { d.status = 'In progress'; } },
      { key: 'done', label: 'Mark done', roles: ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'labtech', 'accountant'], when: { field: 'status', in: ['Todo', 'In progress'] }, run: (d) => { d.status = 'Done'; } },
    ],
  },

  // ═══════════ ADMIN ═══════════
  users: {
    hooks: {
      async beforeCreate(data) {
        data.email = String(data.email).toLowerCase();
        if (!data.password || data.password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
        data.password = await bcrypt.hash(data.password, 10);
      },
      async beforeUpdate(data, doc, ctx) {
        if (data.email) data.email = String(data.email).toLowerCase();
        if (data.password) {
          if (data.password.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
          data.password = await bcrypt.hash(data.password, 10);
        } else delete data.password;
        if (same(doc._id, ctx.user._id)) {
          if (data.active === false) throw new HttpError(400, 'You cannot deactivate your own account');
          if (data.role && data.role !== 'admin') throw new HttpError(400, 'You cannot remove your own admin role');
        }
      },
      async beforeDelete(doc, ctx) {
        if (same(doc._id, ctx.user._id)) throw new HttpError(400, 'You cannot delete your own account');
      },
    },
    actions: [
      {
        key: 'resetPassword', label: 'Reset password', roles: ['admin'], fields: [password('newPassword', 'New password', { required: true })],
        async run(d, input) {
          if (input.newPassword.length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
          d.password = await bcrypt.hash(input.newPassword, 10);
          d.loginAttempts = 0; d.lockUntil = undefined;
        },
      },
      { key: 'unlock', label: 'Unlock account', roles: ['admin'], run: (d) => { d.loginAttempts = 0; d.lockUntil = undefined; } },
    ],
  },
};

async function fillLab(ctx, items) {
  for (const it of items) {
    if (it.test) {
      const t = await ctx.M('labTests').findById(it.test).lean();
      if (t) {
        if (it.price == null) it.price = t.price;
        if (!it.unit) it.unit = t.unit;
        if (!it.normalRange) it.normalRange = t.normalRange;
      }
    }
    if (it.result && it.flag !== 'Critical') {
      const f = autoFlag(it.result, it.normalRange);
      if (f) it.flag = f;
    }
  }
}
