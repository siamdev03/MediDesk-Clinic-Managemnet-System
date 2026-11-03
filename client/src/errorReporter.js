import { api, getToken } from './api.js';

// Sends browser errors to the Error Log (admin → Error Log). Throttled: each distinct error once, max 10 per page load.
let sent = 0;
const seen = new Set();

export function reportClientError(error, extra = {}) {
  try {
    if (!getToken()) return;
    const message = (error && error.message) || String(error);
    if (!message || /ResizeObserver loop/i.test(message)) return;
    const key = `${message}|${extra.where || ''}`;
    if (seen.has(key) || sent >= 10) return;
    seen.add(key);
    sent += 1;
    api.post('/api/errors/client', {
      message, stack: (error && error.stack) || '', level: extra.level, path: `${window.location.pathname}${extra.where ? ` [${extra.where}]` : ''}`,
    }).catch(() => {});
  } catch { /* reporting must never throw */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportClientError(e.error || new Error(e.message), { where: 'window error' }));
  window.addEventListener('unhandledrejection', (e) => reportClientError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)), { where: 'unhandled promise' }));
}