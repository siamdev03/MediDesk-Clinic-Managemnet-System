import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { mod } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Empty, useToast } from '../components/ui.jsx';
import { todayStr } from '../lib.js';
import { useLiveTick } from '../realtime.js';

export default function QueueBoard() {
  const { byKey } = useApp();
  const toast = useToast();
  const cfg = byKey.queue;
  const [rows, setRows] = useState([]);
  const load = useCallback(() => mod.list('queue', { from: todayStr(), to: todayStr(), limit: 200, sort: 'token', order: 'asc' }).then((r) => setRows(r.data)).catch(() => {}), []);
  const tick = useLiveTick(['queue']);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load, tick]);

  const groups = {};
  rows.forEach((r) => { const k = r.doctor?.name || 'Unassigned'; (groups[k] = groups[k] || []).push(r); });
  const act = async (r, a) => { try { const x = await mod.action('queue', r._id, a.key, {}); toast(x.message); load(); } catch (e) { toast(e.message, 'err'); } };
  const avail = (r) => (cfg?.actions || []).filter((a) => !a.when || a.when.in.includes(r[a.when.field]));

  return (
    <div className="page">
      <div className="page-head"><div><h1>📺 Live OPD Queue</h1><p className="muted">Today · updates live</p></div>
        <div className="head-actions">{cfg?.canWrite && <Link className="btn primary" to="/m/queue?new=1">＋ Add to queue</Link>}</div></div>
      {!rows.length && <div className="card"><Empty>Nobody in the queue today</Empty></div>}
      <div className="queue-grid">
        {Object.entries(groups).map(([doc, list]) => {
          const now = list.find((x) => x.status === 'In-consultation');
          return (
            <div className="card" key={doc}>
              <h4>👨‍⚕️ {doc}</h4>
              <div className="now-serving">Now serving: <b>{now ? `#${now.token}` : '—'}</b></div>
              <ul className="agenda">
                {list.map((r) => (
                  <li key={r._id} className={r.status === 'Done' || r.status === 'Skipped' ? 'faded' : ''}>
                    <span className="token">#{r.token}</span>
                    <div><b>{r.patient?.name || r.walkInName || 'Walk-in'}</b><div className="small"><Badge value={r.status} /> {r.priority !== 'Normal' && <Badge value={r.priority} />}</div></div>
                    <div className="q-actions">{avail(r).map((a) => <button key={a.key} className={`btn sm ${a.danger ? 'danger-outline' : 'primary-outline'}`} onClick={() => act(r, a)}>{a.label}</button>)}</div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}