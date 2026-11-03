import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import mongoose from 'mongoose';
import './config/registry.js';
import authRoutes from './routes/auth.js';
import crudRoutes, { metaHandler } from './routes/crud.js';
import customRoutes, { uploadDir } from './routes/custom.js';
import errorRoutes from './routes/errors.js';
import xtraRoutes from './routes/xtra.js';
import xlsxRoutes from './routes/xlsx.js';
import publicRoutes from './routes/publicApi.js';
import portalRoutes from './routes/portal.js';
import payRoutes from './routes/payCallback.js';
import labRoutes from './routes/labInstrument.js';
import { requireAuth, errorHandler } from './middleware/auth.js';
import { branchContext } from './middleware/branch.js';
import { logError } from './utils/errorLogger.js';
import { attachRealtime } from './services/realtime.js';
import { startScheduler } from './services/scheduler.js';
import { loadPermissions } from './services/permissions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5001;
const authed = [requireAuth, branchContext];

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' }, contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' })); // payment gateways post forms
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/uploads', express.static(uploadDir));
app.get('/api/health', (req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// public (no staff login)
app.use('/api/public', publicRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/pay', payRoutes);
app.use('/api/lab-instrument', labRoutes);

app.use('/api/auth', authRoutes);
app.get('/api/meta', authed, metaHandler);
app.use('/api/errors', requireAuth, errorRoutes);
app.use('/api/x', authed, customRoutes, xtraRoutes);
app.use('/api/m', authed, xlsxRoutes, crudRoutes);

// Serve the built React app when available (npm start)
const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads|ws).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

// Anything that escapes Express: write it to the Error Log, then stop (a process manager / --watch restarts it)
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  logError({ message: reason?.message || String(reason), stack: reason?.stack, path: 'process:unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError({ message: err.message, stack: err.stack, path: 'process:uncaughtException' }).finally(() => process.exit(1));
});

async function start() {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://siamsalehin1_db_user:qyARJzuuyAkIJmIO@cluster0.5our1j8.mongodb.net/', { serverSelectionTimeoutMS: 6000 });
    console.log('✔ MongoDB connected');
  } catch (e) {
    console.error('\n✖ Could not connect to MongoDB at', process.env.MONGO_URI || 'mongodb+srv://siamsalehin1_db_user:qyARJzuuyAkIJmIO@cluster0.5our1j8.mongodb.net/');
    console.error('  Start MongoDB first (see README), or set MONGO_URI in server/.env\n');
    process.exit(1);
  }
  await loadPermissions();
  const server = app.listen(PORT, () => console.log(`✔ MediDesk API running on http://localhost:${PORT}`));
  attachRealtime(server);
  if (process.env.SCHEDULER !== 'off') startScheduler();
}

if (process.env.NO_LISTEN !== '1') start();
export default app;