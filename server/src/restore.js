// Restore a backup:  npm run restore -- backups/medidesk-2026-11-04-02-00-00-auto.json.gz
// ⚠ Replaces ALL current data. Stop the API first.
import 'dotenv/config';
import fs from 'fs';
import zlib from 'zlib';
import mongoose from 'mongoose';
import { models, Setting, Counter } from './config/registry.js';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Usage: npm run restore -- <backup file>'); process.exit(1); }
const { data } = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString());
await mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://siamsalehin1_db_user:qyARJzuuyAkIJmIO@cluster0.5our1j8.mongodb.net/');
const targets = { ...models, __settings: Setting, __counters: Counter };
for (const [key, rows] of Object.entries(data)) {
  const model = targets[key];
  if (!model) { console.log('skip unknown collection', key); continue; }
  await model.deleteMany({});
  if (rows.length) await model.insertMany(rows, { ordered: false });
  console.log(`✔ ${key}: ${rows.length}`);
}
await mongoose.disconnect();
console.log('Restore finished.');