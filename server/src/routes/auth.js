import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { M } from '../config/registry.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { asyncH, HttpError } from '../utils/helpers.js';
import { audit } from '../config/engine.js';
import QRCode from 'qrcode';
import { newSecret, verifyTotp, otpauthUrl } from '../utils/totp.js';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts, try again later' } });
const safe = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, role: u.role, branch: u.branch, twoFactor: !!u.totpEnabled });

router.get('/setup-status', asyncH(async (req, res) => {
  res.json({ needsSetup: (await M('users').countDocuments({ deleted: { $ne: true } })) === 0 });
}));

// First-run only: create the initial administrator
router.post('/setup', asyncH(async (req, res) => {
  if ((await M('users').countDocuments({})) > 0) throw new HttpError(403, 'Setup already completed');
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) throw new HttpError(400, 'Name, email and a password of 6+ characters are required');
  const user = await M('users').create({ name, email: String(email).toLowerCase(), password: await bcrypt.hash(password, 10), role: 'admin', active: true });
  res.json({ token: signToken(user), user: safe(user) });
}));

router.post('/login', loginLimiter, asyncH(async (req, res) => {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const password = String(req.body?.password || '');
  if (!email || !password) throw new HttpError(400, 'Email and password are required');
  const user = await M('users').findOne({ email, deleted: { $ne: true } }).select('+password +totpSecret');
  if (!user || user.active === false) throw new HttpError(401, 'Invalid email or password');
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new HttpError(423, `Account locked. Try again after ${user.lockUntil.toLocaleTimeString()}`);
  }
  const ok = await bcrypt.compare(password, user.password || '');
  if (!ok) {
    user.loginAttempts = (user.loginAttempts || 0) + 1;
    if (user.loginAttempts >= 5) { user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); user.loginAttempts = 0; }
    await user.save();
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.totpEnabled) { // two-factor login: the client repeats the request with `code`
    const code = String(req.body?.code || '').trim();
    if (!code) return res.json({ need2fa: true });
    if (!verifyTotp(user.totpSecret, code)) {
      user.loginAttempts = (user.loginAttempts || 0) + 1;
      if (user.loginAttempts >= 5) { user.lockUntil = new Date(Date.now() + 15 * 60 * 1000); user.loginAttempts = 0; }
      await user.save();
      throw new HttpError(401, 'Invalid authentication code');
    }
  }
  user.loginAttempts = 0; user.lockUntil = undefined; user.lastLoginAt = new Date();
  await user.save();
  await audit(user, 'users', user._id, 'login', `${user.name} signed in`, req);
  res.json({ token: signToken(user), user: safe(user) });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: safe(req.user) }));

router.put('/profile', requireAuth, asyncH(async (req, res) => {
  const { name, phone } = req.body || {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'Name is required');
  const u = await M('users').findByIdAndUpdate(req.user._id, { name: String(name).trim(), phone: phone || '' }, { new: true });
  res.json({ user: safe(u) });
}));

router.put('/password', requireAuth, asyncH(async (req, res) => {
  const { current, next } = req.body || {};
  if (!next || next.length < 6) throw new HttpError(400, 'New password must be at least 6 characters');
  const u = await M('users').findById(req.user._id).select('+password');
  if (!(await bcrypt.compare(String(current || ''), u.password))) throw new HttpError(400, 'Current password is incorrect');
  u.password = await bcrypt.hash(next, 10);
  await u.save();
  res.json({ ok: true });
}));

// ── Feature 15: two-factor login (authenticator app)
router.post('/2fa/setup', requireAuth, asyncH(async (req, res) => {
  const u = await M('users').findById(req.user._id).select('+totpSecret');
  if (u.totpEnabled) throw new HttpError(400, 'Two-factor login is already on');
  u.totpSecret = newSecret();
  await u.save();
  const uri = otpauthUrl(u.totpSecret, u.email);
  res.json({ secret: u.totpSecret, uri, qr: await QRCode.toDataURL(uri, { width: 220, margin: 1 }) });
}));

router.post('/2fa/enable', requireAuth, asyncH(async (req, res) => {
  const u = await M('users').findById(req.user._id).select('+totpSecret');
  if (!u.totpSecret || !verifyTotp(u.totpSecret, req.body?.code)) throw new HttpError(400, 'That code is not correct – check the time on your phone and try again');
  u.totpEnabled = true;
  await u.save();
  await audit(u, 'users', u._id, 'action', 'Two-factor login enabled', req);
  res.json({ ok: true });
}));

router.post('/2fa/disable', requireAuth, asyncH(async (req, res) => {
  const u = await M('users').findById(req.user._id).select('+password +totpSecret');
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.password))) throw new HttpError(400, 'Password is incorrect');
  if (u.totpEnabled && !verifyTotp(u.totpSecret, req.body?.code)) throw new HttpError(400, 'Authentication code is incorrect');
  u.totpEnabled = false; u.totpSecret = undefined;
  await u.save();
  await audit(u, 'users', u._id, 'action', 'Two-factor login disabled', req);
  res.json({ ok: true });
}));

export default router;