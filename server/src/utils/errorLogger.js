import crypto from 'crypto';
import { M } from '../config/registry.js';

// Writes one entry to the Error Log. Never throws: logging must not break the request that failed.
// The same error (same source, message, path and status) while still Open only bumps a counter.
export async function logError({ source = 'server', level = 'error', message, stack, statusCode, method, path, user, ip, userAgent }) {
  try {
    const msg = String(message || 'Unknown error').slice(0, 500);
    const fingerprint = crypto.createHash('sha1').update([source, msg, method || '', path || '', statusCode || ''].join('|')).digest('hex');
    const now = new Date();
    const existing = await M('errorLogs').findOneAndUpdate(
      { fingerprint, status: 'Open', deleted: { $ne: true } },
      { $inc: { occurrences: 1 }, $set: { lastSeenAt: now, userName: user?.name, ip, stack: stack ? String(stack).slice(0, 4000) : undefined } },
    );
    if (existing) return;
    await M('errorLogs').create({
      fingerprint, source, level, message: msg, stack: stack ? String(stack).slice(0, 4000) : undefined, statusCode, method, path,
      userName: user?.name, ip, userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined, occurrences: 1, lastSeenAt: now, status: 'Open',
    });
  } catch (e) {
    console.error('Could not write to the error log:', e.message);
  }
}