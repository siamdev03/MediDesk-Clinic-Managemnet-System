import { Router } from 'express';
import { getModule, moduleList } from '../config/registry.js';
import {
  can, assertRole, listRecords, getRecord, optionsFor, createRecord, updateRecord, deleteRecord, restoreRecord,
  runAction, runTool, exportCsv, importRows,
} from '../config/engine.js';
import { asyncH, HttpError } from '../utils/helpers.js';

const router = Router();

// Strip server-only bits (functions) from a module definition
export function publicModule(cfg, user) {
  return {
    key: cfg.key, label: cfg.label, group: cfg.group, icon: cfg.icon, prefix: cfg.prefix, display: cfg.display,
    dateField: cfg.dateField, readOnly: !!cfg.readOnly, noDelete: !!cfg.noDelete, noEdit: !!cfg.noEdit,
    canWrite: can(user, cfg.roles.write) && !cfg.readOnly, canDelete: can(user, cfg.roles.delete) && !cfg.readOnly && !cfg.noDelete,
    canEdit: can(user, cfg.roles.write) && !cfg.readOnly && !cfg.noEdit,
    fields: cfg.fields,
    actions: cfg.actions.filter((a) => can(user, a.roles || cfg.roles.write)).map(({ run, roles, ...a }) => a),
    tools: cfg.tools.filter((t) => can(user, t.roles || cfg.roles.write)).map(({ run, roles, ...t }) => t),
  };
}

export const metaHandler = (req, res) => {
  const mods = moduleList.filter((m) => can(req.user, m.roles.read)).map((m) => publicModule(m, req.user));
    res.json({ modules: mods, user: { _id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role, branch: req.user.branch, twoFactor: !!req.user.totpEnabled } });
};

function load(req, res, next) {
  const cfg = getModule(req.params.key);
  if (!cfg) return next(new HttpError(404, 'Unknown module'));
  req.cfg = cfg;
  return next();
}
const canRead = (req, res, next) => {
  try { assertRole(req.user, req.cfg.roles.read, `You do not have access to ${req.cfg.label}`); next(); } catch (e) { next(e); }
};

router.use('/:key', load);

router.get('/:key', canRead, asyncH(async (req, res) => {
  res.json(await listRecords(req.cfg, req.query));
}));

router.get('/:key/export.csv', canRead, asyncH(async (req, res) => {
  const csv = await exportCsv(req.cfg, req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.cfg.key}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// Lightweight lookups for dropdowns. Any signed-in user may look up reference data.
router.get('/:key/options', asyncH(async (req, res) => {
  res.json(await optionsFor(req.cfg, req.query));
}));

router.post('/:key/import', asyncH(async (req, res) => {
  res.json(await importRows(req.cfg.key, req.body?.rows, req.user, req));
}));

router.post('/:key/bulk-delete', asyncH(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 200) : [];
  let deleted = 0;
  const failed = [];
  for (const id of ids) {
    try { await deleteRecord(req.cfg.key, id, req.user, { req }); deleted += 1; } catch (e) { failed.push(e.message); }
  }
  res.json({ deleted, failed });
}));

router.post('/:key/tools/:tool', asyncH(async (req, res) => {
  res.json(await runTool(req.cfg.key, req.params.tool, req.body, req.user, { req }));
}));

router.post('/:key', asyncH(async (req, res) => {
  res.status(201).json(await createRecord(req.cfg.key, req.body || {}, req.user, { req }));
}));

router.get('/:key/:id', canRead, asyncH(async (req, res) => {
  res.json(await getRecord(req.cfg, req.params.id));
}));

router.put('/:key/:id', asyncH(async (req, res) => {
  res.json(await updateRecord(req.cfg.key, req.params.id, req.body || {}, req.user, { req }));
}));

router.delete('/:key/:id', asyncH(async (req, res) => {
  res.json(await deleteRecord(req.cfg.key, req.params.id, req.user, { req }));
}));

router.post('/:key/:id/restore', asyncH(async (req, res) => {
  res.json(await restoreRecord(req.cfg.key, req.params.id, req.user, { req }));
}));

router.post('/:key/:id/actions/:action', asyncH(async (req, res) => {
  res.json(await runAction(req.cfg.key, req.params.id, req.params.action, req.body, req.user, { req }));
}));

export default router;
