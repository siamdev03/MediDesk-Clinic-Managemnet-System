// Feature 25: one shared WebSocket to the API. Pages call useLiveTick(['queue']) and re-load when it changes.
import { useEffect, useState } from 'react';
import { getToken, getBranch } from './api.js';

const listeners = new Set();
let ws = null;
let retry = 0;
let timer = null;
let wanted = false;

function connect() {
  if (!wanted || ws || !getToken()) return;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // in dev the Vite proxy forwards /ws to the API; in production the API serves the page itself
  ws = new WebSocket(`${proto}://${window.location.host}/ws?token=${encodeURIComponent(getToken())}`);
  ws.onopen = () => { retry = 0; };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type !== 'change') return;
      const b = getBranch();
      const changes = msg.changes.filter((c) => !b || !c.branch || c.branch === b); // ignore other branches
      if (changes.length) listeners.forEach((fn) => fn(changes.map((c) => c.module)));
    } catch { /* ignore */ }
  };
  ws.onclose = () => {
    ws = null;
    if (wanted) { timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry)); retry += 1; }
  };
  ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
}

export function startRealtime() { wanted = true; connect(); }
export function stopRealtime() { wanted = false; clearTimeout(timer); if (ws) { ws.onclose = null; ws.close(); ws = null; } }
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Returns a number that changes whenever one of `keys` is written by anybody (debounced).
export function useLiveTick(keys) {
  const [tick, setTick] = useState(0);
  const sig = keys.join(',');
  useEffect(() => {
    let t = null;
    const off = subscribe((mods) => {
      if (!mods.some((m) => keys.includes(m))) return;
      clearTimeout(t);
      t = setTimeout(() => setTick((n) => n + 1), 250);
    });
    return () => { off(); clearTimeout(t); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return tick;
}