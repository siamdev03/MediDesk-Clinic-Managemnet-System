// Generic record engine: validation, auto-codes, hooks, soft delete, audit, workflow actions, CSV.
import mongoose from 'mongoose';
import { getModule, M, nextCode } from './registry.js';
import { getSettings } from './settings.js';
import { HttpError, todayDate, todayStr, escapeRegex, addDays, ymd } from '../utils/helpers.js';

const isId = (v) => /^[a-f\d]{24}$/i.test(String(v));
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

// ───────────── permissions ─────────────
export function can(user, roles = []) {
  return !!user && (user.role === 'admin' || roles.includes(user.role));
}
export function assertRole(user, roles, msg = 'You do not have permission to do this') {
  if (!can(user, roles)) throw new HttpError(403, msg);
}

// ───────────── coercion / validation ─────────────
function coerceValue(f, v) {
  switch (f.type) {
    case 'number': {
      if (v === '' || v === null) return null;
      const n = Number(v);
      if (Number.isNaN(n)) throw new HttpError(400, `${f.label} must be a number`);
      if (f.min !== undefined && n < f.min) throw new HttpError(400, `${f.label} must be at least ${f.min}`);
      if (f.max !== undefined && n > f.max) throw new HttpError(400, `${f.label} must be at most ${f.max}`);
      return n;
    }
    case 'date':
    case 'datetime': {
      if (!v) return null;
      if (v instanceof Date) return v;
      const s = String(v);
      const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : new Date(s);
      if (Number.isNaN(d.getTime())) throw new HttpError(400, `${f.label} is not a valid date`);
      return d;
    }
    case 'checkbox':
      return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    case 'ref': {
      if (!v) return null;
      const id = typeof v === 'object' ? v._id || v.value : v;
      if (!isId(id)) throw new HttpError(400, `${f.label} is invalid`);
      return String(id);
    }
    case 'multiselect':
    case 'tags': {
      const a = Array.isArray(v) ? v : String(v || '').split(',');
      return a.map((x) => String(x).trim()).filter(Boolean);
    }
    case 'select': {
      if (v === '' || v === null) return '';
      if (f.options && !f.options.includes(String(v))) throw new HttpError(400, `Invalid value for ${f.label}`);
      return String(v);
    }
    case 'items': {
      if (!Array.isArray(v)) throw new HttpError(400, `${f.label} must be a list`);
      const rows = v.map((r) => coerceRow(f, r)).filter(Boolean);
      return rows;
    }
    case 'password':
      return v === null ? '' : String(v);
    default:
      return v === null ? '' : String(v).trim();
  }
}

function coerceRow(parent, row) {
  const out = {};
  for (const sf of parent.fields) {
    if (sf.computed || !(sf.name in (row || {}))) continue;
    const val = coerceValue(sf, row[sf.name]);
    if (!isEmpty(val) && val !== false) out[sf.name] = val;
  }
  // Defaults inside rows (e.g. quantity = 1) only apply when the row has real content
  const meaningful = Object.keys(out).filter((k) => {
    const sf = parent.fields.find((x) => x.name === k);
    return sf.default === undefined || out[k] !== sf.default;
  });
  if (!meaningful.length) return null;
  for (const sf of parent.fields) {
    if (sf.default !== undefined && isEmpty(out[sf.name]) && !sf.computed) out[sf.name] = applyDefault(sf.default);
    if (sf.required && isEmpty(out[sf.name])) throw new HttpError(400, `${parent.label}: "${sf.label}" is required in every row`);
  }
  return out;
}

function applyDefault(d) {
  if (d === 'today') return todayDate();
  if (d === 'now') return new Date();
  if (d === 'month') return todayStr().slice(0, 7);
  return d;
}

export function coerceBody(cfg, body = {}, { partial = false } = {}) {
  const out = {};
  for (const f of cfg.fields) {
    if (f.form === false) continue;
    if (!(f.name in body)) continue;
    let val = coerceValue(f, body[f.name]);
    if (f.type === 'ref' && val === null && partial) val = null; // allow clearing
    if (f.required && isEmpty(val)) {
      throw new HttpError(400, f.type === 'items' ? `Add at least one row in "${f.label}"` : `${f.label} is required`);
    }
    out[f.name] = val;
  }
  if (!partial) {
    for (const f of cfg.fields) {
      if (f.form === false) continue;
      if (isEmpty(out[f.name]) && f.default !== undefined) out[f.name] = applyDefault(f.default);
      if (f.required && isEmpty(out[f.name])) {
        throw new HttpError(400, f.type === 'items' ? `Add at least one row in "${f.label}"` : `${f.label} is required`);
      }
    }
  }
  // remove nulls for fresh records so Mongo does not store them
  if (!partial) for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
}

// ───────────── populate / labels ─────────────
function selectOf(mod) {
  const set = new Set(mod.display || []);
  if (mod.prefix) set.add('code');
  (mod.populateFields || []).forEach((x) => set.add(x));
  (mod.optionFields || []).forEach((x) => set.add(x));
  return [...set].join(' ');
}
function popFor(path, moduleKey) {
  const t = getModule(moduleKey);
  const p = { path, select: selectOf(t), options: { strictPopulate: false } };
  const nested = t.fields.filter((x) => x.type === 'ref' && (t.display || []).includes(x.name));
  if (nested.length) p.populate = nested.map((x) => ({ path: x.name, select: selectOf(getModule(x.module)) }));
  return p;
}
export function populateSpec(cfg) {
  const pops = [];
  for (const f of cfg.fields) {
    if (f.type === 'ref') pops.push(popFor(f.name, f.module));
    if (f.type === 'items') for (const sf of f.fields) if (sf.type === 'ref') pops.push(popFor(`${f.name}.${sf.name}`, sf.module));
  }
  return pops;
}
function displayPopulate(cfg) {
  return cfg.fields
    .filter((f) => f.type === 'ref' && (cfg.display || []).includes(f.name))
    .map((f) => popFor(f.name, f.module));
}
export function labelOf(cfg, doc) {
  if (!doc) return '';
  return (cfg.display || [])
    .map((name) => {
      const f = cfg.fields.find((x) => x.name === name);
      const v = doc[name];
      if (v === undefined || v === null || v === '') return '';
      if (f?.type === 'ref') return typeof v === 'object' ? labelOf(getModule(f.module), v) : '';
      if (v instanceof Date) return ymd(v);
      return String(v);
    })
    .filter(Boolean)
    .join(' · ');
}

// ───────────── context passed to hooks & actions ─────────────
export function makeCtx(user, req) {
  return { user, req, M, engine, getSettings, todayStr, todayDate, HttpError, labelOf, getModule };
}

// ───────────── audit ─────────────
export async function audit(user, module, recordId, action, summary, req) {
  try {
    await M('auditLogs').create({
      user: user?._id, userName: user?.name, module, recordId: String(recordId || ''), action, summary: String(summary || '').slice(0, 300),
      ip: req?.ip,
    });
  } catch { /* never block the main flow */ }
}

// ───────────── filters ─────────────
async function refSearchIds(cfg, term) {
  const rx = new RegExp(escapeRegex(term), 'i');
  const out = [];
  const refs = cfg.fields.filter((f) => f.type === 'ref' && f.list).slice(0, 3);
  for (const f of refs) {
    const t = getModule(f.module);
    const ors = [...(t.search || [])].map((s) => ({ [s]: rx }));
    if (!ors.length) continue;
    const ids = await M(f.module).find({ deleted: { $ne: true }, $or: ors }).limit(80).distinct('_id');
    if (ids.length) out.push({ [f.name]: { $in: ids } });
  }
  return out;
}

export async function buildFilter(cfg, q = {}) {
  const filter = { deleted: q.trash === '1' ? true : { $ne: true } };
  const and = [];
  if (q.q) {
    const rx = new RegExp(escapeRegex(String(q.q).trim()), 'i');
    const ors = (cfg.search || []).map((s) => ({ [s]: rx }));
    ors.push(...(await refSearchIds(cfg, String(q.q).trim())));
    if (ors.length) and.push({ $or: ors });
  }
  for (const f of cfg.fields) {
    const raw = q[f.name] ?? q[`f_${f.name}`];
    if (raw === undefined || raw === '') continue;
    if (!(f.filter || f.refFilter || q[`f_${f.name}`] !== undefined)) continue;
    if (f.type === 'ref') {
      if (isId(raw)) filter[f.name] = raw;
    } else if (f.type === 'checkbox') filter[f.name] = raw === 'true';
    else if (f.type === 'number') filter[f.name] = Number(raw);
    else filter[f.name] = raw;
  }
  if (cfg.dateField && (q.from || q.to)) {
    const range = {};
    if (q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) range.$gte = new Date(`${q.from}T00:00:00.000Z`);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) range.$lt = addDays(new Date(`${q.to}T00:00:00.000Z`), 1);
    if (Object.keys(range).length) filter[cfg.dateField] = range;
  }
  if (cfg.key === 'medicines') {
    const today = todayDate();
    if (q.lowStock === '1') filter.$expr = { $lte: ['$stock', '$reorderLevel'] };
    if (q.expiring === '1') { filter.stock = { $gt: 0 }; filter.expiryDate = { $gte: today, $lte: addDays(today, 60) }; }
    if (q.expired === '1') { filter.stock = { $gt: 0 }; filter.expiryDate = { $lt: today }; }
  }
  if (and.length) filter.$and = and;
  return filter;
}

function sortOf(cfg, q) {
  if (q.sort) {
    const allowed = ['createdAt', 'code', ...cfg.fields.filter((f) => f.type !== 'items').map((f) => f.name)];
    if (allowed.includes(q.sort)) return { [q.sort]: q.order === 'asc' ? 1 : -1, _id: -1 };
  }
  return cfg.sort || { createdAt: -1 };
}

// ───────────── reads ─────────────
export async function listRecords(cfg, q = {}) {
  const filter = await buildFilter(cfg, q);
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 15));
  const [data, total] = await Promise.all([
    M(cfg.key).find(filter).sort(sortOf(cfg, q)).skip((page - 1) * limit).limit(limit).populate(populateSpec(cfg)).lean(),
    M(cfg.key).countDocuments(filter),
  ]);
  return { data, total, page, pages: Math.max(1, Math.ceil(total / limit)), limit };
}

export async function getRecord(cfg, id) {
  if (!isId(id)) throw new HttpError(400, 'Invalid id');
  const doc = await M(cfg.key).findById(id).populate(populateSpec(cfg)).lean();
  if (!doc) throw new HttpError(404, `${cfg.label} record not found`);
  return doc;
}

export async function optionsFor(cfg, q = {}) {
  const filter = await buildFilter(cfg, { ...q, q: undefined });
  if (q.q) {
    const rx = new RegExp(escapeRegex(String(q.q).trim()), 'i');
    filter.$or = (cfg.search || []).map((s) => ({ [s]: rx }));
  }
  const limit = Math.min(50, parseInt(q.limit, 10) || 30);
  const pickKeys = [...new Set([...(cfg.optionFields || []), 'status', 'active'])];
  const docs = await M(cfg.key).find(filter).sort(cfg.optionSort || cfg.sort || { createdAt: -1 }).limit(limit).populate(displayPopulate(cfg)).lean();
  return docs.map((d) => {
    const data = {};
    for (const k of pickKeys) if (d[k] !== undefined) data[k] = d[k];
    return { value: String(d._id), label: labelOf(cfg, d) || String(d._id), data };
  });
}

// ───────────── unique checks ─────────────
async function checkUnique(cfg, data, existing) {
  for (const combo of cfg.unique || []) {
    const q = { deleted: { $ne: true } };
    let complete = true;
    for (const k of combo) {
      let v = data[k] !== undefined ? data[k] : existing?.[k];
      if (v === undefined || v === null || v === '') { complete = false; break; }
      if (v && typeof v === 'object' && v._id) v = v._id;
      q[k] = typeof v === 'string' && combo.includes('email') ? v.toLowerCase() : v;
    }
    if (!complete) continue;
    if (existing) q._id = { $ne: existing._id };
    if (await M(cfg.key).exists(q)) {
      const labels = combo.map((k) => cfg.fields.find((f) => f.name === k)?.label || k).join(' + ');
      throw new HttpError(409, `A record with the same ${labels} already exists`);
    }
  }
}

// ───────────── writes ─────────────
export async function createRecord(key, body, user, opts = {}) {
  const cfg = getModule(key);
  if (!cfg) throw new HttpError(404, 'Unknown module');
  if (!opts.internal) {
    if (cfg.readOnly) throw new HttpError(403, `${cfg.label} cannot be created manually`);
    assertRole(user, cfg.roles.write);
  }
  const ctx = makeCtx(user, opts.req);
  const data = coerceBody(cfg, body);
  if (opts.raw) Object.assign(data, opts.raw);
  await checkUnique(cfg, data, null);
  if (cfg.prefix) data.code = await nextCode(cfg.prefix);
  data.createdBy = user?._id;
  await cfg.hooks.beforeCreate?.(data, ctx);
  const doc = await M(key).create(data);
  await cfg.hooks.afterCreate?.(doc, ctx);
  await audit(user, key, doc._id, 'create', `${cfg.label}: ${doc.code || labelOf(cfg, doc.toObject())}`, opts.req);
  return getRecord(cfg, doc._id);
}

export async function updateRecord(key, id, body, user, opts = {}) {
  const cfg = getModule(key);
  assertRole(user, cfg.roles.write);
  if (cfg.readOnly || cfg.noEdit) throw new HttpError(403, `${cfg.label} records cannot be edited`);
  if (!isId(id)) throw new HttpError(400, 'Invalid id');
  const doc = await M(key).findOne({ _id: id, deleted: { $ne: true } });
  if (!doc) throw new HttpError(404, 'Record not found');
  const ctx = makeCtx(user, opts.req);
  const data = coerceBody(cfg, body, { partial: true });
  await checkUnique(cfg, data, doc);
  await cfg.hooks.beforeUpdate?.(data, doc, ctx);
  doc.set(data);
  doc.updatedBy = user._id;
  await doc.save();
  await cfg.hooks.afterUpdate?.(doc, ctx);
  await audit(user, key, doc._id, 'update', `${cfg.label}: ${doc.code || ''}`, opts.req);
  return getRecord(cfg, doc._id);
}

export async function deleteRecord(key, id, user, opts = {}) {
  const cfg = getModule(key);
  assertRole(user, cfg.roles.delete, 'Only an administrator can delete records');
  if (cfg.readOnly || cfg.noDelete) throw new HttpError(403, `${cfg.label} records cannot be deleted`);
  const doc = await M(key).findOne({ _id: id, deleted: { $ne: true } });
  if (!doc) throw new HttpError(404, 'Record not found');
  await cfg.hooks.beforeDelete?.(doc, makeCtx(user, opts.req));
  doc.deleted = true;
  doc.deletedAt = new Date();
  await doc.save();
  await audit(user, key, doc._id, 'delete', `${cfg.label}: ${doc.code || ''}`, opts.req);
  return { ok: true };
}

export async function restoreRecord(key, id, user, opts = {}) {
  const cfg = getModule(key);
  assertRole(user, ['admin']);
  const doc = await M(key).findOne({ _id: id, deleted: true });
  if (!doc) throw new HttpError(404, 'Record not found in trash');
  doc.deleted = false;
  doc.deletedAt = undefined;
  await doc.save();
  await audit(user, key, doc._id, 'restore', `${cfg.label}: ${doc.code || ''}`, opts.req);
  return { ok: true };
}

// ───────────── workflow actions & tools ─────────────
export async function runAction(key, id, name, body, user, opts = {}) {
  const cfg = getModule(key);
  const act = cfg.actions.find((a) => a.key === name);
  if (!act) throw new HttpError(404, 'Unknown action');
  assertRole(user, act.roles || cfg.roles.write);
  const doc = await M(key).findOne({ _id: id, deleted: { $ne: true } });
  if (!doc) throw new HttpError(404, 'Record not found');
  if (act.when) {
    const v = doc[act.when.field];
    const ok = act.when.empty ? v === undefined || v === null || v === '' : act.when.in.includes(v);
    if (!ok) throw new HttpError(400, `"${act.label}" is not available for this record right now`);
  }
  const input = act.fields ? coerceBody({ fields: act.fields }, body || {}) : {};
  const result = await act.run(doc, input, makeCtx(user, opts.req));
  if (doc.isModified()) await doc.save();
  await audit(user, key, doc._id, 'action', `${act.label}: ${doc.code || ''}`, opts.req);
  return { record: await getRecord(cfg, doc._id), message: result?.message || `${act.label} completed` };
}

export async function runTool(key, name, body, user, opts = {}) {
  const cfg = getModule(key);
  const tool = cfg.tools.find((t) => t.key === name);
  if (!tool) throw new HttpError(404, 'Unknown tool');
  assertRole(user, tool.roles || cfg.roles.write);
  const input = tool.fields ? coerceBody({ fields: tool.fields }, body || {}) : {};
  const result = await tool.run(input, makeCtx(user, opts.req));
  await audit(user, key, '', 'action', `Tool: ${tool.label}`, opts.req);
  return result || { message: 'Done' };
}

// ───────────── CSV export / import ─────────────
const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function plain(cfg, f, v) {
  if (v === undefined || v === null) return '';
  if (f.type === 'date') return ymd(v);
  if (f.type === 'datetime') return new Date(v).toISOString().replace('T', ' ').slice(0, 16);
  if (f.type === 'ref') return typeof v === 'object' ? labelOf(getModule(f.module), v) : '';
  if (f.type === 'multiselect' || f.type === 'tags') return (v || []).join('; ');
  if (f.type === 'checkbox') return v ? 'Yes' : 'No';
  if (f.type === 'items') {
    return (v || []).map((r) => f.fields.filter((sf) => !sf.computed && r[sf.name] !== undefined)
      .map((sf) => (sf.type === 'ref' ? labelOf(getModule(sf.module), r[sf.name]) : r[sf.name] instanceof Date ? ymd(r[sf.name]) : r[sf.name])).join(' / ')).join(' | ');
  }
  return v;
}
export async function exportCsv(cfg, q) {
  const filter = await buildFilter(cfg, q);
  const docs = await M(cfg.key).find(filter).sort(sortOf(cfg, q)).limit(10000).populate(populateSpec(cfg)).lean();
  const fields = cfg.fields.filter((f) => f.type !== 'password' && f.type !== 'file' && (f.list || f.type === 'items' || f.required));
  const head = [...(cfg.prefix ? ['Code'] : []), ...fields.map((f) => f.label)].map(csvCell).join(',');
  const lines = docs.map((d) => [...(cfg.prefix ? [d.code] : []), ...fields.map((f) => plain(cfg, f, d[f.name]))].map(csvCell).join(','));
  return `﻿${[head, ...lines].join('\r\n')}`;
}

async function resolveRef(f, value) {
  if (!value) return null;
  if (isId(value)) return value;
  const t = getModule(f.module);
  const rx = new RegExp(`^${escapeRegex(String(value).trim())}$`, 'i');
  const keys = [...new Set([...(t.prefix ? ['code'] : []), ...(t.search || [])])];
  const doc = await M(f.module).findOne({ deleted: { $ne: true }, $or: keys.map((k) => ({ [k]: rx })) }).select('_id');
  if (!doc) throw new HttpError(400, `${f.label} "${value}" not found`);
  return String(doc._id);
}

export async function importRows(key, rows, user, req) {
  const cfg = getModule(key);
  assertRole(user, cfg.roles.write);
  if (cfg.readOnly) throw new HttpError(403, 'This module cannot be imported into');
  if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No rows to import');
  if (rows.length > 500) throw new HttpError(400, 'Import at most 500 rows at a time');
  const result = { created: 0, failed: [] };
  for (let i = 0; i < rows.length; i += 1) {
    try {
      const body = {};
      for (const f of cfg.fields) {
        if (f.form === false || f.type === 'items' || f.type === 'file' || f.type === 'password') continue;
        const raw = rows[i][f.name] ?? rows[i][f.label];
        if (raw === undefined || raw === '') continue;
        body[f.name] = f.type === 'ref' ? await resolveRef(f, raw) : raw;
      }
      await createRecord(key, body, user, { req });
      result.created += 1;
    } catch (e) {
      result.failed.push({ row: i + 2, error: e.message });
    }
  }
  await audit(user, key, '', 'import', `Imported ${result.created} rows`, req);
  return result;
}

// Public façade used by hooks/actions through ctx.engine
export const engine = {
  createRecord, updateRecord, deleteRecord, getRecord, runAction, listRecords, labelOf, can,
};
