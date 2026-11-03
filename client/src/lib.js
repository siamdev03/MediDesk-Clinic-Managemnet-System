// Shared helpers: formatting, labels, form value conversion.
export const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nowLocalInput = () => { const d = new Date(); return `${todayStr()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const toLocalInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};
export const fmtDateTime = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtMoney = (v, cur = '৳') => `${cur}${(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const ageOf = (p) => {
  if (!p) return '';
  if (p.dob) {
    const d = new Date(p.dob); const n = new Date();
    let a = n.getUTCFullYear() - d.getUTCFullYear();
    if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a -= 1;
    return a;
  }
  return p.age ?? '';
};

const GOOD = ['Completed', 'Paid', 'Active', 'Available', 'Confirmed', 'Done', 'Received', 'Approved', 'Present', 'Discharged', 'Normal', 'Reviewed', 'Resolved', 'Dispensed', 'Open', 'Live', 'Issued'];
const BAD = ['Cancelled', 'No-show', 'Rejected', 'Expired', 'Refunded', 'Absent', 'Critical', 'Urgent', 'Emergency', 'STAT', 'Unpaid', 'High', 'Deceased', 'Skipped', 'Discarded', 'Resigned'];
const WARN = ['Pending', 'Partial', 'Waiting', 'Scheduled', 'Low', 'Maintenance', 'Cleaning', 'Priority', 'On leave', 'Due', 'Important', 'Late', 'Reserved', 'Called', 'Ordered', 'Draft', 'Submitted', 'Sample Collected', 'Requested', 'New', 'Todo'];
export const toneOf = (v) => (GOOD.includes(v) ? 'good' : BAD.includes(v) ? 'bad' : WARN.includes(v) ? 'warn' : 'info');
const BADGE_FIELDS = ['status', 'priority', 'flag', 'severity'];
export const isBadge = (f) => f.type === 'select' && (f.badge || BADGE_FIELDS.includes(f.name));

// label of a (populated) referenced record
export function labelOf(byKey, moduleKey, doc) {
  const cfg = byKey[moduleKey];
  if (!cfg || !doc || typeof doc !== 'object') return '';
  return (cfg.display || []).map((name) => {
    const f = cfg.fields.find((x) => x.name === name);
    const v = doc[name];
    if (v === undefined || v === null || v === '') return '';
    if (f?.type === 'ref') return labelOf(byKey, f.module, v);
    if (f?.type === 'date') return fmtDate(v);
    return String(v);
  }).filter(Boolean).join(' · ');
}

export function evalComputed(expr, row) {
  const m = String(expr).match(/^(\w+)\*(\w+)$/);
  if (!m) return 0;
  return Math.round((Number(row[m[1]]) || 0) * (Number(row[m[2]]) || 0) * 100) / 100;
}

const defaultFor = (f) => {
  const d = f.default;
  if (d === 'today') return todayStr();
  if (d === 'now') return f.type === 'datetime' ? nowLocalInput() : new Date().toISOString();
  if (d === 'month') return todayStr().slice(0, 7);
  if (d !== undefined) return d;
  if (f.type === 'checkbox') return false;
  if (f.type === 'multiselect') return [];
  if (f.type === 'items') return [];
  return '';
};

function fromRecord(byKey, f, v) {
  if (v === undefined || v === null) return defaultFor(f);
  switch (f.type) {
    case 'ref': return v && typeof v === 'object' ? { value: v._id, label: labelOf(byKey, f.module, v) || v.code || String(v._id) } : v ? { value: v, label: '…' } : null;
    case 'date': return fmtDate(v);
    case 'datetime': return toLocalInput(v);
    case 'tags': return Array.isArray(v) ? v.join(', ') : v;
    case 'multiselect': return Array.isArray(v) ? v : [];
    case 'items': return (v || []).map((row) => Object.fromEntries(f.fields.map((sf) => [sf.name, sf.computed ? row[sf.name] : fromRecord(byKey, sf, row[sf.name])])));
    case 'password': return '';
    default: return v;
  }
}

export function initialValues(byKey, cfg, record, preset = {}) {
  const out = {};
  for (const f of cfg.fields) {
    if (f.form === false) continue;
    if (record) out[f.name] = fromRecord(byKey, f, record[f.name]);
    else if (preset[f.name] !== undefined) out[f.name] = preset[f.name];
    else out[f.name] = f.type === 'items' ? [blankRow(f)] : defaultFor(f);
  }
  return out;
}

export function blankRow(f) {
  return Object.fromEntries(f.fields.map((sf) => [sf.name, sf.computed ? 0 : sf.type === 'ref' ? null : sf.default !== undefined ? sf.default : '']));
}

export function serialize(cfg, values) {
  const out = {};
  for (const f of cfg.fields) {
    if (f.form === false || !(f.name in values)) continue;
    const v = values[f.name];
    if (f.type === 'datetime') out[f.name] = v ? new Date(v).toISOString() : null;
    else if (f.type === 'items') out[f.name] = v.map((row) => { const r = { ...row }; for (const sf of f.fields) if (sf.type === 'datetime' && r[sf.name]) r[sf.name] = new Date(r[sf.name]).toISOString(); return r; });
    else if (f.type === 'password' && !v) continue;
    else out[f.name] = v;
  }
  return out;
}

export const humanize = (s) => String(s).replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
