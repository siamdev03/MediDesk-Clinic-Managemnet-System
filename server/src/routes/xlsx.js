// Feature 23: GET /api/m/:key/export.xlsx – same filters as the CSV export, but a real Excel file.
import { Router } from 'express';
import { getModule } from '../config/registry.js';
import { assertRole, exportCsv } from '../config/engine.js';
import { asyncH, HttpError, todayStr } from '../utils/helpers.js';
import { parseCsv, workbookBuffer } from '../services/xlsx.js';

const router = Router();
router.get('/:key/export.xlsx', asyncH(async (req, res) => {
  const cfg = getModule(req.params.key);
  if (!cfg) throw new HttpError(404, 'Unknown module');
  assertRole(req.user, cfg.roles.read, `You do not have access to ${cfg.label}`);
  const rows = parseCsv(await exportCsv(cfg, req.query));
  const buf = await workbookBuffer([{ name: cfg.label, rows }]);
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${cfg.key}-${todayStr()}.xlsx"`,
  });
  res.send(buf);
}));
export default router;