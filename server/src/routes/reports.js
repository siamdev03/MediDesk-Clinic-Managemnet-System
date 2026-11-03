// Report builders. Every report returns { title, cards[], charts[], tables[] } so the UI can render them generically.
import { M } from '../config/registry.js';
import { toDateOnly, addDays, ymd, round2, TZ, todayDate } from '../utils/helpers.js';

const nd = { deleted: { $ne: true } };

export const REPORT_LIST = [
  { key: 'revenue', label: 'Revenue, expenses & profit', icon: '💰', roles: ['accountant'] },
  { key: 'appointments', label: 'Appointments', icon: '📅', roles: ['receptionist', 'doctor', 'accountant'] },
  { key: 'doctors', label: 'Doctor performance', icon: '👨‍⚕️', roles: ['accountant'] },
  { key: 'patients', label: 'Patients & demographics', icon: '🧑‍⚕️', roles: ['doctor', 'receptionist'] },
  { key: 'pharmacy', label: 'Pharmacy sales', icon: '💊', roles: ['pharmacist', 'accountant'] },
  { key: 'stock', label: 'Stock & expiry', icon: '📦', roles: ['pharmacist'] },
  { key: 'lab', label: 'Laboratory', icon: '🔬', roles: ['labtech', 'doctor'] },
  { key: 'dues', label: 'Outstanding dues (aging)', icon: '🧾', roles: ['accountant', 'receptionist'] },
  { key: 'inpatient', label: 'Inpatient & bed occupancy', icon: '🛏️', roles: ['nurse', 'doctor'] },
  { key: 'hr', label: 'Attendance & payroll', icon: '👥', roles: ['accountant'] },
];

const count = (arr, key) => arr.reduce((s, x) => s + (x[key] || 0), 0);
const toChart = (rows, type, title, label = '_id', value = 'value') => ({ type, title, data: rows.map((r) => ({ label: String(r[label] ?? '—'), value: round2(r[value]) })) });

export async function buildReport(key, from, to) {
  const f = toDateOnly(from);
  const t = addDays(toDateOnly(to), 1); // exclusive upper bound
  const tz = TZ();
  const day = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });

  switch (key) {
    // ───────────────────────── REVENUE ─────────────────────────
    case 'revenue': {
      const [byDay, byMethod, sales, exp] = await Promise.all([
        M('payments').aggregate([{ $match: { ...nd, status: 'Received', date: { $gte: f, $lt: t } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, value: { $sum: '$amount' } } }]),
        M('payments').aggregate([{ $match: { ...nd, status: 'Received', date: { $gte: f, $lt: t } } },
          { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
        M('pharmacySales').aggregate([{ $match: { ...nd, status: { $ne: 'Refunded' }, createdAt: { $gte: addDays(f, -1), $lt: addDays(t, 1) } } },
          { $addFields: { d: day('$createdAt') } }, { $match: { d: { $gte: from, $lte: to } } },
          { $group: { _id: '$d', value: { $sum: '$amountPaid' } } }]),
        M('expenses').aggregate([{ $match: { ...nd, date: { $gte: f, $lt: t } } },
          { $group: { _id: '$category', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
      ]);
      const map = {};
      byDay.forEach((x) => { map[x._id] = (map[x._id] || 0) + x.value; });
      sales.forEach((x) => { map[x._id] = (map[x._id] || 0) + x.value; });
      const series = Object.keys(map).sort().map((d) => ({ label: d.slice(5), value: round2(map[d]) }));
      const billing = round2(count(byMethod, 'amount'));
      const pharmacy = round2(count(sales, 'value'));
      const expenses = round2(count(exp, 'amount'));
      return {
        title: 'Revenue, expenses & profit',
        cards: [
          { label: 'Billing collections', value: billing, type: 'money' }, { label: 'Pharmacy sales', value: pharmacy, type: 'money' },
          { label: 'Total revenue', value: round2(billing + pharmacy), type: 'money' }, { label: 'Expenses', value: expenses, type: 'money' },
          { label: 'Net profit', value: round2(billing + pharmacy - expenses), type: 'money', tone: billing + pharmacy - expenses >= 0 ? 'good' : 'bad' },
        ],
        charts: [{ type: 'line', title: 'Daily revenue', data: series }, toChart(exp, 'donut', 'Expenses by category', '_id', 'amount')],
        tables: [
          { title: 'Collections by payment method', columns: [{ key: 'method', label: 'Method' }, { key: 'count', label: 'Payments', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
            rows: byMethod.map((x) => ({ method: x._id, count: x.count, amount: x.amount })) },
          { title: 'Expenses by category', columns: [{ key: 'category', label: 'Category' }, { key: 'count', label: 'Entries', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
            rows: exp.map((x) => ({ category: x._id, count: x.count, amount: x.amount })) },
        ],
      };
    }

    // ───────────────────────── APPOINTMENTS ─────────────────────────
    case 'appointments': {
      const match = { ...nd, date: { $gte: f, $lt: t } };
      const [byStatus, byType, perDay, byDoc] = await Promise.all([
        M('appointments').aggregate([{ $match: match }, { $group: { _id: '$status', value: { $sum: 1 } } }]),
        M('appointments').aggregate([{ $match: match }, { $group: { _id: '$type', value: { $sum: 1 } } }]),
        M('appointments').aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, value: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
        M('appointments').aggregate([{ $match: match }, { $group: { _id: { d: '$doctor', s: '$status' }, n: { $sum: 1 } } }]),
      ]);
      const docs = await M('doctors').find({ _id: { $in: [...new Set(byDoc.map((x) => String(x._id.d)))] } }).select('name specialization').lean();
      const rows = {};
      byDoc.forEach((x) => {
        const k = String(x._id.d);
        rows[k] = rows[k] || { doctor: docs.find((d) => String(d._id) === k)?.name || '—', total: 0, completed: 0, cancelled: 0, noshow: 0 };
        rows[k].total += x.n;
        if (x._id.s === 'Completed') rows[k].completed += x.n;
        if (x._id.s === 'Cancelled') rows[k].cancelled += x.n;
        if (x._id.s === 'No-show') rows[k].noshow += x.n;
      });
      const table = Object.values(rows).sort((a, b) => b.total - a.total).map((r) => ({ ...r, rate: r.total ? Math.round((r.completed / r.total) * 100) : 0 }));
      const total = count(byStatus, 'value');
      const done = byStatus.find((x) => x._id === 'Completed')?.value || 0;
      return {
        title: 'Appointments',
        cards: [{ label: 'Total appointments', value: total, type: 'number' }, { label: 'Completed', value: done, type: 'number', tone: 'good' },
          { label: 'Cancelled', value: byStatus.find((x) => x._id === 'Cancelled')?.value || 0, type: 'number' },
          { label: 'No-show', value: byStatus.find((x) => x._id === 'No-show')?.value || 0, type: 'number', tone: 'bad' },
          { label: 'Completion rate', value: total ? Math.round((done / total) * 100) : 0, type: 'percent' }],
        charts: [toChart(byStatus, 'donut', 'By status'), toChart(byType, 'bar', 'By type'),
          { type: 'line', title: 'Appointments per day', data: perDay.map((x) => ({ label: x._id.slice(5), value: x.value })) }],
        tables: [{ title: 'By doctor', columns: [{ key: 'doctor', label: 'Doctor' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'completed', label: 'Completed', type: 'number' },
          { key: 'cancelled', label: 'Cancelled', type: 'number' }, { key: 'noshow', label: 'No-show', type: 'number' }, { key: 'rate', label: 'Completion %', type: 'percent' }], rows: table }],
      };
    }

    // ───────────────────────── DOCTORS ─────────────────────────
    case 'doctors': {
      const rows = await M('appointments').aggregate([
        { $match: { ...nd, date: { $gte: f, $lt: t }, status: 'Completed' } },
        { $group: { _id: '$doctor', patients: { $sum: 1 }, revenue: { $sum: '$fee' } } }, { $sort: { revenue: -1 } },
      ]);
      const cons = await M('consultations').aggregate([{ $match: { ...nd, date: { $gte: f, $lt: t } } }, { $group: { _id: '$doctor', n: { $sum: 1 } } }]);
      const docs = await M('doctors').find({ _id: { $in: rows.map((r) => r._id) } }).select('name specialization').lean();
      const table = rows.map((r) => {
        const d = docs.find((x) => String(x._id) === String(r._id));
        return { doctor: d?.name || '—', specialization: d?.specialization || '', patients: r.patients, consultations: cons.find((c) => String(c._id) === String(r._id))?.n || 0, revenue: r.revenue };
      });
      return {
        title: 'Doctor performance',
        cards: [{ label: 'Completed visits', value: count(rows, 'patients'), type: 'number' }, { label: 'Consultation revenue', value: count(rows, 'revenue'), type: 'money' }],
        charts: [{ type: 'bar', title: 'Revenue by doctor', data: table.slice(0, 10).map((r) => ({ label: r.doctor, value: r.revenue })) }],
        tables: [{ title: 'Performance', columns: [{ key: 'doctor', label: 'Doctor' }, { key: 'specialization', label: 'Specialization' }, { key: 'patients', label: 'Completed visits', type: 'number' },
          { key: 'consultations', label: 'Consultation notes', type: 'number' }, { key: 'revenue', label: 'Fee revenue', type: 'money' }], rows: table }],
      };
    }

    // ───────────────────────── PATIENTS ─────────────────────────
    case 'patients': {
      const all = await M('patients').find(nd).select('gender dob age bloodGroup city createdAt').limit(50000).lean();
      const inRange = all.filter((p) => p.createdAt >= f && p.createdAt < t);
      const now = todayDate();
      const ageOf = (p) => (p.dob ? Math.floor((now - new Date(p.dob)) / 31557600000) : p.age);
      const bucket = (a) => (a == null ? 'Unknown' : a < 5 ? '0-4' : a < 13 ? '5-12' : a < 20 ? '13-19' : a < 40 ? '20-39' : a < 60 ? '40-59' : '60+');
      const tally = (fn) => {
        const m = {};
        all.forEach((p) => { const k = fn(p) || 'Unknown'; m[k] = (m[k] || 0) + 1; });
        return Object.entries(m).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
      };
      const age = tally((p) => bucket(ageOf(p)));
      const gender = tally((p) => p.gender);
      const blood = tally((p) => p.bloodGroup);
      const city = tally((p) => p.city).slice(0, 10);
      return {
        title: 'Patients & demographics',
        cards: [{ label: 'Total patients', value: all.length, type: 'number' }, { label: 'New in period', value: inRange.length, type: 'number', tone: 'good' }],
        charts: [{ type: 'donut', title: 'Gender', data: gender }, { type: 'bar', title: 'Age groups', data: age }, { type: 'bar', title: 'Blood groups', data: blood }],
        tables: [{ title: 'Top cities / districts', columns: [{ key: 'label', label: 'City' }, { key: 'value', label: 'Patients', type: 'number' }], rows: city }],
      };
    }

    // ───────────────────────── PHARMACY ─────────────────────────
    case 'pharmacy': {
      const base = [{ $match: { ...nd, createdAt: { $gte: addDays(f, -1), $lt: addDays(t, 1) } } }, { $addFields: { d: day('$createdAt') } }, { $match: { d: { $gte: from, $lte: to } } }];
      const [sum, perDay, top] = await Promise.all([
        M('pharmacySales').aggregate([...base, { $group: { _id: '$status', n: { $sum: 1 }, amount: { $sum: '$total' } } }]),
        M('pharmacySales').aggregate([...base, { $match: { status: { $ne: 'Refunded' } } }, { $group: { _id: '$d', value: { $sum: '$total' } } }, { $sort: { _id: 1 } }]),
        M('pharmacySales').aggregate([...base, { $match: { status: { $ne: 'Refunded' } } }, { $unwind: '$items' },
          { $group: { _id: '$items.medicineName', qty: { $sum: '$items.quantity' }, amount: { $sum: '$items.amount' } } }, { $sort: { amount: -1 } }, { $limit: 20 }]),
      ]);
      const ok = sum.filter((x) => x._id !== 'Refunded');
      const sales = count(ok, 'amount');
      const n = count(ok, 'n');
      return {
        title: 'Pharmacy sales',
        cards: [{ label: 'Sales', value: round2(sales), type: 'money' }, { label: 'Invoices', value: n, type: 'number' }, { label: 'Average basket', value: n ? round2(sales / n) : 0, type: 'money' },
          { label: 'Refunded', value: round2(sum.find((x) => x._id === 'Refunded')?.amount || 0), type: 'money', tone: 'bad' }],
        charts: [{ type: 'line', title: 'Daily sales', data: perDay.map((x) => ({ label: x._id.slice(5), value: round2(x.value) })) },
          { type: 'bar', title: 'Top medicines (amount)', data: top.slice(0, 10).map((x) => ({ label: x._id, value: round2(x.amount) })) }],
        tables: [{ title: 'Top selling medicines', columns: [{ key: 'name', label: 'Medicine' }, { key: 'qty', label: 'Qty sold', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }],
          rows: top.map((x) => ({ name: x._id, qty: x.qty, amount: x.amount })) }],
      };
    }

    // ───────────────────────── STOCK ─────────────────────────
    case 'stock': {
      const meds = await M('medicines').find({ ...nd, active: { $ne: false } }).sort({ name: 1 }).lean();
      const today = todayDate();
      const soon = addDays(today, 90);
      const row = (m) => ({ name: m.name, generic: m.genericName, stock: m.stock, reorder: m.reorderLevel, expiry: m.expiryDate, batch: m.batchNo });
      const cols = [{ key: 'name', label: 'Medicine' }, { key: 'generic', label: 'Generic' }, { key: 'stock', label: 'Stock', type: 'number' }, { key: 'reorder', label: 'Reorder lvl', type: 'number' },
        { key: 'expiry', label: 'Expiry', type: 'date' }, { key: 'batch', label: 'Batch' }];
      const low = meds.filter((m) => m.stock <= (m.reorderLevel || 0));
      const expiring = meds.filter((m) => m.stock > 0 && m.expiryDate && m.expiryDate >= today && m.expiryDate <= soon);
      const expired = meds.filter((m) => m.stock > 0 && m.expiryDate && m.expiryDate < today);
      return {
        title: 'Stock & expiry',
        cards: [{ label: 'Medicines', value: meds.length, type: 'number' }, { label: 'Stock value (cost)', value: round2(meds.reduce((s, m) => s + m.stock * (m.purchasePrice || 0), 0)), type: 'money' },
          { label: 'Stock value (retail)', value: round2(meds.reduce((s, m) => s + m.stock * (m.price || 0), 0)), type: 'money' },
          { label: 'Low stock', value: low.length, type: 'number', tone: low.length ? 'bad' : 'good' }, { label: 'Expiring ≤ 90 days', value: expiring.length, type: 'number', tone: expiring.length ? 'bad' : 'good' },
          { label: 'Expired in stock', value: expired.length, type: 'number', tone: expired.length ? 'bad' : 'good' }],
        charts: [],
        tables: [{ title: 'Low stock', columns: cols, rows: low.map(row) }, { title: 'Expiring within 90 days', columns: cols, rows: expiring.map(row) }, { title: 'Expired (still in stock)', columns: cols, rows: expired.map(row) }],
      };
    }

    // ───────────────────────── LAB ─────────────────────────
    case 'lab': {
      const match = { ...nd, orderDate: { $gte: f, $lt: t } };
      const [byStatus, top, orders] = await Promise.all([
        M('labOrders').aggregate([{ $match: match }, { $group: { _id: '$status', value: { $sum: 1 } } }]),
        M('labOrders').aggregate([{ $match: { ...match, status: { $ne: 'Cancelled' } } }, { $unwind: '$items' },
          { $group: { _id: '$items.test', n: { $sum: 1 }, amount: { $sum: '$items.price' }, abnormal: { $sum: { $cond: [{ $in: ['$items.flag', ['High', 'Low', 'Critical']] }, 1, 0] } } } },
          { $sort: { n: -1 } }, { $limit: 20 }]),
        M('labOrders').find({ ...match, status: 'Completed' }).select('createdAt completedAt total').lean(),
      ]);
      const tests = await M('labTests').find({ _id: { $in: top.map((x) => x._id) } }).select('name category').lean();
      const rows = top.map((x) => ({ test: tests.find((tt) => String(tt._id) === String(x._id))?.name || '—', n: x.n, abnormal: x.abnormal, amount: x.amount }));
      const tat = orders.filter((o) => o.completedAt).map((o) => (new Date(o.completedAt) - new Date(o.createdAt)) / 3600000);
      return {
        title: 'Laboratory',
        cards: [{ label: 'Orders', value: count(byStatus, 'value'), type: 'number' }, { label: 'Completed', value: byStatus.find((x) => x._id === 'Completed')?.value || 0, type: 'number', tone: 'good' },
          { label: 'Test revenue', value: round2(count(top, 'amount')), type: 'money' }, { label: 'Avg turnaround (hrs)', value: tat.length ? round2(tat.reduce((a, b) => a + b, 0) / tat.length) : 0, type: 'number' }],
        charts: [toChart(byStatus, 'donut', 'Orders by status'), { type: 'bar', title: 'Most ordered tests', data: rows.slice(0, 10).map((r) => ({ label: r.test, value: r.n })) }],
        tables: [{ title: 'Tests', columns: [{ key: 'test', label: 'Test' }, { key: 'n', label: 'Orders', type: 'number' }, { key: 'abnormal', label: 'Abnormal results', type: 'number' }, { key: 'amount', label: 'Revenue', type: 'money' }], rows }],
      };
    }

    // ───────────────────────── DUES ─────────────────────────
    case 'dues': {
      const inv = await M('invoices').find({ ...nd, status: { $in: ['Unpaid', 'Partial'] } }).populate('patient', 'name code phone').sort({ dueDate: 1 }).lean();
      const today = todayDate();
      const rows = inv.map((i) => {
        const late = i.dueDate ? Math.floor((today - new Date(i.dueDate)) / 86400000) : 0;
        return { invoice: i.code, patient: i.patient?.name, phone: i.patient?.phone, date: i.invoiceDate, due: i.dueDate, total: i.total, paid: i.paid, balance: i.balance, late: Math.max(0, late) };
      });
      const buckets = { 'Not due': 0, '1-30 days': 0, '31-60 days': 0, '60+ days': 0 };
      rows.forEach((r) => { const k = r.late === 0 ? 'Not due' : r.late <= 30 ? '1-30 days' : r.late <= 60 ? '31-60 days' : '60+ days'; buckets[k] += r.balance; });
      return {
        title: 'Outstanding dues (aging)',
        cards: [{ label: 'Open invoices', value: rows.length, type: 'number' }, { label: 'Total outstanding', value: round2(count(rows, 'balance')), type: 'money', tone: 'bad' }],
        charts: [{ type: 'bar', title: 'Aging', data: Object.entries(buckets).map(([label, value]) => ({ label, value: round2(value) })) }],
        tables: [{ title: 'Open invoices', columns: [{ key: 'invoice', label: 'Invoice' }, { key: 'patient', label: 'Patient' }, { key: 'phone', label: 'Phone' }, { key: 'date', label: 'Date', type: 'date' },
          { key: 'due', label: 'Due', type: 'date' }, { key: 'total', label: 'Total', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }, { key: 'balance', label: 'Balance', type: 'money' }, { key: 'late', label: 'Days late', type: 'number' }], rows }],
      };
    }

    // ───────────────────────── INPATIENT ─────────────────────────
    case 'inpatient': {
      const [beds, adm, surg] = await Promise.all([
        M('beds').find(nd).populate('ward', 'name type').lean(),
        M('admissions').find({ ...nd, admitDate: { $gte: f, $lt: t } }).select('admitDate dischargeDate status').lean(),
        M('surgeries').aggregate([{ $match: { ...nd, scheduledAt: { $gte: f, $lt: t } } }, { $group: { _id: '$status', value: { $sum: 1 } } }]),
      ]);
      const wards = {};
      beds.forEach((b) => {
        const k = b.ward?.name || '—';
        wards[k] = wards[k] || { ward: k, type: b.ward?.type, beds: 0, occupied: 0 };
        wards[k].beds += 1;
        if (b.status === 'Occupied') wards[k].occupied += 1;
      });
      const wardRows = Object.values(wards).map((w) => ({ ...w, available: w.beds - w.occupied, rate: w.beds ? Math.round((w.occupied / w.beds) * 100) : 0 }));
      const stays = adm.filter((a) => a.dischargeDate).map((a) => (new Date(a.dischargeDate) - new Date(a.admitDate)) / 86400000);
      const occ = beds.filter((b) => b.status === 'Occupied').length;
      return {
        title: 'Inpatient & bed occupancy',
        cards: [{ label: 'Admissions (period)', value: adm.length, type: 'number' }, { label: 'Currently admitted', value: await M('admissions').countDocuments({ ...nd, status: 'Admitted' }), type: 'number' },
          { label: 'Bed occupancy', value: beds.length ? Math.round((occ / beds.length) * 100) : 0, type: 'percent' }, { label: 'Avg length of stay (days)', value: stays.length ? round2(stays.reduce((a, b) => a + b, 0) / stays.length) : 0, type: 'number' }],
        charts: [{ type: 'bar', title: 'Occupancy % by ward', data: wardRows.map((w) => ({ label: w.ward, value: w.rate })) }, toChart(surg, 'donut', 'Surgeries by status')],
        tables: [{ title: 'Ward occupancy', columns: [{ key: 'ward', label: 'Ward' }, { key: 'type', label: 'Type' }, { key: 'beds', label: 'Beds', type: 'number' }, { key: 'occupied', label: 'Occupied', type: 'number' },
          { key: 'available', label: 'Available', type: 'number' }, { key: 'rate', label: 'Occupancy', type: 'percent' }], rows: wardRows }],
      };
    }

    // ───────────────────────── HR ─────────────────────────
    case 'hr': {
      const [att, pay] = await Promise.all([
        M('attendance').aggregate([{ $match: { ...nd, date: { $gte: f, $lt: t } } }, { $group: { _id: { s: '$staff', st: '$status' }, n: { $sum: 1 } } }]),
        M('payroll').aggregate([{ $match: { ...nd, month: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) } } }, { $group: { _id: '$month', net: { $sum: '$net' }, paid: { $sum: { $cond: [{ $eq: ['$status', 'Paid'] }, '$net', 0] } } } }, { $sort: { _id: 1 } }]),
      ]);
      const staff = await M('staff').find({ _id: { $in: [...new Set(att.map((a) => String(a._id.s)))] } }).select('name designation').lean();
      const map = {};
      att.forEach((a) => {
        const k = String(a._id.s);
        map[k] = map[k] || { name: staff.find((s) => String(s._id) === k)?.name || '—', Present: 0, Absent: 0, Late: 0, 'Half-day': 0, Leave: 0 };
        map[k][a._id.st] = a.n;
      });
      return {
        title: 'Attendance & payroll',
        cards: [{ label: 'Payroll total', value: round2(count(pay, 'net')), type: 'money' }, { label: 'Paid out', value: round2(count(pay, 'paid')), type: 'money', tone: 'good' }],
        charts: [{ type: 'bar', title: 'Payroll by month', data: pay.map((p) => ({ label: p._id, value: round2(p.net) })) }],
        tables: [{ title: 'Attendance summary', columns: [{ key: 'name', label: 'Staff' }, { key: 'Present', label: 'Present', type: 'number' }, { key: 'Late', label: 'Late', type: 'number' },
          { key: 'Absent', label: 'Absent', type: 'number' }, { key: 'Leave', label: 'Leave', type: 'number' }, { key: 'Half-day', label: 'Half-day', type: 'number' }], rows: Object.values(map) },
        { title: 'Payroll by month', columns: [{ key: 'month', label: 'Month' }, { key: 'net', label: 'Net payroll', type: 'money' }, { key: 'paid', label: 'Paid', type: 'money' }], rows: pay.map((p) => ({ month: p._id, net: p.net, paid: p.paid })) }],
      };
    }
    default:
      return { title: 'Report', cards: [], charts: [], tables: [] };
  }
}
export { ymd };
