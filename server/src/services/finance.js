// Features 7, 8, 9: doctor commission, daily cash closing, profit & loss / tax.
import { M } from '../config/registry.js';
import { TZ, toDateOnly, round2, ymd } from '../utils/helpers.js';

const nd = { deleted: { $ne: true } };
const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));

function tzOffsetMin(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second);
  return Math.round((asUtc - d.getTime()) / 60000);
}
// [start, end) instants of a clinic-timezone calendar day (or range of days)
export function range(from, to = from) {
  const guess = new Date(`${from}T00:00:00Z`);
  const start = new Date(guess.getTime() - tzOffsetMin(guess) * 60000);
  const g2 = new Date(`${to}T00:00:00Z`);
  const end = new Date(g2.getTime() - tzOffsetMin(g2) * 60000 + 86400000);
  return { start, end };
}
const methodOf = (m) => (m === 'Cash' ? 'cash' : m === 'Card' ? 'card' : m === 'Mobile Banking' ? 'mobile' : 'other');

export async function dayTotals(d) {
  const { start, end } = range(d);
  const [pays, sales, exps] = await Promise.all([
    M('payments').find({ date: toDateOnly(d), status: 'Received', ...nd }).lean(),
    M('pharmacySales').find({ createdAt: { $gte: start, $lt: end }, status: { $ne: 'Refunded' }, ...nd }).lean(),
    M('expenses').find({ date: toDateOnly(d), ...nd }).lean(),
  ]);
  const out = { billing: { cash: 0, card: 0, mobile: 0, other: 0 }, pharmacy: { cash: 0, card: 0, mobile: 0, other: 0 }, expensesCash: 0, counts: { payments: pays.length, sales: sales.length, expenses: exps.length } };
  pays.forEach((p) => { out.billing[methodOf(p.method)] += p.amount || 0; });
  sales.forEach((s) => { out.pharmacy[methodOf(s.paymentMethod)] += s.amountPaid || 0; });
  exps.filter((e) => e.paymentMethod === 'Cash').forEach((e) => { out.expensesCash += e.amount || 0; });
  for (const g of ['billing', 'pharmacy']) for (const k of Object.keys(out[g])) out[g][k] = round2(out[g][k]);
  out.expensesCash = round2(out.expensesCash);
  out.expectedCash = round2(out.billing.cash + out.pharmacy.cash - out.expensesCash);
  out.totalCollected = round2(Object.values(out.billing).reduce((a, b) => a + b, 0) + Object.values(out.pharmacy).reduce((a, b) => a + b, 0));
  return out;
}

export async function profitLoss(from, to) {
  const { start, end } = range(from, to);
  const dr = { $gte: toDateOnly(from), $lte: toDateOnly(to) };
  const [pays, sales, exps, invs, due] = await Promise.all([
    M('payments').find({ date: dr, status: 'Received', ...nd }).lean(),
    M('pharmacySales').find({ createdAt: { $gte: start, $lt: end }, status: { $ne: 'Refunded' }, ...nd }).lean(),
    M('expenses').find({ date: dr, ...nd }).lean(),
    M('invoices').find({ invoiceDate: dr, status: { $ne: 'Cancelled' }, ...nd }).select('tax total').lean(),
    M('invoices').find({ status: { $in: ['Unpaid', 'Partial'] }, ...nd }).select('balance').lean(),
  ]);
  const medIds = [...new Set(sales.flatMap((s) => s.items.map((i) => String(i.medicine))))];
  const meds = await M('medicines').find({ _id: { $in: medIds } }).select('purchasePrice').lean();
  const cost = Object.fromEntries(meds.map((m) => [String(m._id), m.purchasePrice || 0]));
  const cogs = round2(sales.reduce((s, x) => s + x.items.reduce((a, i) => a + (cost[String(i.medicine)] || 0) * (i.quantity || 0), 0), 0));
  const billing = sum(pays, (p) => p.amount);
  const pharmacy = sum(sales, (s) => s.amountPaid);
  const byCat = {};
  exps.forEach((e) => { byCat[e.category] = round2((byCat[e.category] || 0) + (e.amount || 0)); });
  const expenses = sum(exps, (e) => e.amount);
  return {
    from, to,
    income: { billing, pharmacy, total: round2(billing + pharmacy) },
    expenses: { byCategory: byCat, total: expenses },
    pharmacyCogsEstimate: cogs,
    netProfit: round2(billing + pharmacy - expenses),
    tax: { invoiceTax: sum(invs, (i) => i.tax), pharmacyTax: sum(sales, (s) => s.tax), total: round2(sum(invs, (i) => i.tax) + sum(sales, (s) => s.tax)) },
    receivablesOutstanding: sum(due, (i) => i.balance),
  };
}

export async function commissions(from, to, paidOnly = false) {
  const appts = await M('appointments').find({ date: { $gte: toDateOnly(from), $lte: toDateOnly(to) }, status: 'Completed', ...nd })
    .populate('doctor', 'name commissionPct specialization').populate('invoice', 'status').lean();
  const map = new Map();
  for (const a of appts) {
    if (!a.doctor) continue;
    if (paidOnly && a.invoice?.status !== 'Paid') continue;
    const k = String(a.doctor._id);
    const r = map.get(k) || { doctor: a.doctor.name, specialization: a.doctor.specialization, pct: a.doctor.commissionPct || 0, visits: 0, fees: 0, commission: 0 };
    r.visits += 1; r.fees = round2(r.fees + (a.fee || 0));
    r.commission = round2((r.fees * r.pct) / 100);
    map.set(k, r);
  }
  const rows = [...map.values()].sort((a, b) => b.commission - a.commission);
  return { from, to, paidOnly, rows, totalFees: sum(rows, (r) => r.fees), totalCommission: sum(rows, (r) => r.commission) };
}

export { ymd };