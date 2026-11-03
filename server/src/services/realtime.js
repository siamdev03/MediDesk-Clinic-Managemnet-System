// Feature 25: real-time updates over WebSocket (path /ws?token=JWT).
// Every Mongoose save/updateMany is batched (300 ms) and broadcast as { type:'change', changes:[{module,branch}] }.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';

let wss = null;
let timer = null;
const pending = new Map();
const QUIET = new Set(['auditLogs', 'messageLogs']);

export function emitChange(module, branch) {
  if (!wss || QUIET.has(module)) return;
  pending.set(module, branch ? String(branch) : '');
  if (!timer) timer = setTimeout(flush, 300);
}

function flush() {
  timer = null;
  if (!wss || !pending.size) return;
  const msg = JSON.stringify({ type: 'change', changes: [...pending].map(([module, branch]) => ({ module, branch })) });
  pending.clear();
  wss.clients.forEach((c) => { if (c.readyState === 1) c.send(msg); });
}

export function attachRealtime(server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }, cb) => {
      try {
        const token = new URL(req.url, 'http://localhost').searchParams.get('token');
        const p = jwt.verify(token, process.env.JWT_SECRET);
        if (!p.id || p.portal) throw new Error('not staff');
        cb(true);
      } catch { cb(false, 401, 'Unauthorized'); }
    },
  });
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});
  });
  const beat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) { ws.terminate(); return; }
      ws.isAlive = false; ws.ping();
    });
  }, 30000);
  beat.unref();
  console.log('✔ Real-time updates on ws://localhost:%s/ws', process.env.PORT || 5001);
}