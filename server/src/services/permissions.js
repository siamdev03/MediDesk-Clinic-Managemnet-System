// Feature 16: permission editor. Overrides which roles may read / write / delete each module.
// Stored in the settings collection; applied on boot and on save. Administrators always keep full access.
// Limit: business rules written in logic.js (e.g. "only a pharmacist may refund") still apply on top.
import { Setting, modulesByKey } from '../config/registry.js';
import { HttpError } from '../utils/helpers.js';

export const ROLES = ['admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'labtech', 'accountant'];
const LOCKED = new Set(['users', 'auditLogs', 'errorLogs', 'branches']);
const KEY = 'permissions';

export const editableModules = () => Object.values(modulesByKey).filter((m) => !LOCKED.has(m.key));

function apply(map = {}) {
  for (const cfg of editableModules()) {
    if (!cfg._defaultRoles) cfg._defaultRoles = JSON.parse(JSON.stringify(cfg.roles));
    const o = map[cfg.key];
    if (!o) { cfg.roles = JSON.parse(JSON.stringify(cfg._defaultRoles)); continue; }
    const write = [...new Set(['admin', ...(o.write || [])])];
    const read = [...new Set(['admin', ...(o.read || []), ...write])];
    cfg.roles = { read, write, delete: [...new Set(['admin', ...(o.delete || [])])] };
  }
}

export async function loadPermissions() {
  const doc = await Setting.findById(KEY).lean();
  apply(doc?.value || {});
}

export async function getPermissionMatrix() {
  const doc = await Setting.findById(KEY).lean();
  return editableModules().map((m) => ({
    key: m.key, label: m.label, group: m.group, readOnly: !!m.readOnly,
    roles: m.roles, defaults: m._defaultRoles || m.roles, customised: !!doc?.value?.[m.key],
  }));
}

export async function savePermissions(map) {
  const clean = {};
  for (const [key, o] of Object.entries(map || {})) {
    if (!modulesByKey[key] || LOCKED.has(key)) continue;
    const pick = (a) => (Array.isArray(a) ? a.filter((r) => ROLES.includes(r)) : []);
    clean[key] = { read: pick(o.read), write: pick(o.write), delete: pick(o.delete) };
  }
  if (Object.keys(map || {}).length && !Object.keys(clean).length) throw new HttpError(400, 'No valid module in request');
  await Setting.findByIdAndUpdate(KEY, { value: clean }, { upsert: true });
  apply(clean);
  return getPermissionMatrix();
}