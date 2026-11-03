// Feature 17: automatic + manual backups (gzipped JSON of every collection). Restore with: npm run restore -- <file>
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { models, Setting, Counter } from '../config/registry.js';
import { als } from '../utils/context.js';
import { HttpError } from '../utils/helpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const backupDir = () => path.resolve(process.env.BACKUP_DIR || path.join(here, '..', '..', 'backups'));
const SECRET_FIELDS = { users: '+password +totpSecret' };

export async function createBackup(label = 'manual') {
  fs.mkdirSync(backupDir(), { recursive: true });
  const data = {};
  await als.run({ branch: null }, async () => { // always dump every branch
    for (const [key, model] of Object.entries(models)) {
      let q = model.find({});
      if (SECRET_FIELDS[key]) q = q.select(SECRET_FIELDS[key]);
      data[key] = await q.lean();
    }
    data.__settings = await Setting.find({}).lean();
    data.__counters = await Counter.find({}).lean();
  });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(backupDir(), `medidesk-${stamp}-${label}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), data })));
  const keep = Number(process.env.BACKUP_KEEP || 7);
  const all = listBackups();
  all.slice(keep).forEach((b) => { try { fs.unlinkSync(path.join(backupDir(), b.name)); } catch { /* ignore */ } });
  return { name: path.basename(file), size: fs.statSync(file).size };
}

export function listBackups() {
  if (!fs.existsSync(backupDir())) return [];
  return fs.readdirSync(backupDir()).filter((f) => f.endsWith('.json.gz'))
    .map((name) => { const st = fs.statSync(path.join(backupDir(), name)); return { name, size: st.size, createdAt: st.mtime }; })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function backupPath(name) {
  if (!/^medidesk-[\w.-]+\.json\.gz$/.test(name || '')) throw new HttpError(400, 'Invalid backup name');
  const p = path.join(backupDir(), name);
  if (!fs.existsSync(p)) throw new HttpError(404, 'Backup not found');
  return p;
}