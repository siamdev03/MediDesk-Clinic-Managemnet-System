// Minimal RFC 6238 TOTP (Google Authenticator / Authy compatible) using only Node's crypto.
import crypto from 'crypto';

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret() {
  let bits = '';
  for (const b of crypto.randomBytes(20)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += ALPHA[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function decode(s) {
  let bits = '';
  for (const c of String(s).replace(/=+$/, '').toUpperCase()) {
    const v = ALPHA.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = (((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

export function verifyTotp(secret, token, window = 1) {
  const t = String(token || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(t) || !secret) return false;
  const c = Math.floor(Date.now() / 30000);
  for (let i = -window; i <= window; i += 1) if (hotp(secret, c + i) === t) return true;
  return false;
}

export const otpauthUrl = (secret, account, issuer = 'MediDesk') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;