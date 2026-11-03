import mongoose from 'mongoose';
import { modules } from './modules.js';
import { logic } from './logic.js';
import { buildModel } from './buildModel.js';
import { errorLogModule, errorLogLogic } from './errorLog.js';
import { featureModules, featureLogic, patchModules } from './features.js';

export const modulesByKey = {};
export const models = {};

const allModules = [...modules, errorLogModule, ...featureModules];
patchModules(allModules);
const allLogic = { ...logic, errorLogs: errorLogLogic };

// run the original hook first, then the add-on hook
const chain = (a, b) => (a && b ? async (...args) => { await a(...args); await b(...args); } : a || b);
const mergeHooks = (a = {}, b = {}) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, chain(a[k], b[k])]));

for (const m of allModules) {
  const l = allLogic[m.key] || {};
  const x = featureLogic[m.key] || {};
  modulesByKey[m.key] = {
    search: [],
    optionFields: [],
    populateFields: [],
    ...m,
    roles: m.roles || { read: [], write: [], delete: ['admin'] },
    hooks: mergeHooks(l.hooks, x.hooks),
    actions: [...(l.actions || []), ...(x.actions || [])],
    tools: [...(l.tools || []), ...(x.tools || [])],
  };
}
for (const key of Object.keys(modulesByKey)) models[key] = buildModel(modulesByKey[key]);

export const moduleList = Object.values(modulesByKey);
export const getModule = (key) => modulesByKey[key];
export const M = (key) => {
  if (!models[key]) throw new Error(`Unknown module ${key}`);
  return models[key];
};

// ── helper collections that are not generic modules ──
export const Counter = mongoose.model('Counter', new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }), 'counters');
export const Setting = mongoose.model('Setting', new mongoose.Schema({ _id: String, value: mongoose.Schema.Types.Mixed }), 'settings');

export async function nextCode(prefix) {
  const c = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  return `${prefix}-${String(c.seq).padStart(6, '0')}`;
}