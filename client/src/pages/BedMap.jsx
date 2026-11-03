import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mod } from '../api.js';
import { Empty, Spinner } from '../components/ui.jsx';
import { useLiveTick } from '../realtime.js';

const COLORS = { Available: 'good', Occupied: 'bad', Cleaning: 'warn', Maintenance: 'muted', Reserved: 'info' };

export default function BedMap() {
  const [beds, setBeds] = useState(null);
  const nav = useNavigate();
  const tick = useLiveTick(['beds', 'admissions']);
  useEffect(() => { const load = () => mod.list('beds', { limit: 200, sort: 'bedNumber', order: 'asc' }).then((r) => setBeds(r.data)).catch(() => setBeds([])); load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [tick]);
  if (!beds) return <div className="page"><Spinner /></div>;
  const wards = {};
  beds.forEach((b) => { const k = b.ward?.name || 'Unassigned'; (wards[k] = wards[k] || []).push(b); });
  const counts = beds.reduce((a, b) => ({ ...a, [b.status]: (a[b.status] || 0) + 1 }), {});
  return (
    <div className="page">
      <div className="page-head"><div><h1>🛏️ Bed Map</h1><p className="muted">{beds.length} beds · {counts.Occupied || 0} occupied · {counts.Available || 0} available</p></div></div>
      <div className="legend-row">{Object.keys(COLORS).map((s) => <span key={s} className={`badge ${COLORS[s]}`}>{s} ({counts[s] || 0})</span>)}</div>
      {!beds.length && <div className="card"><Empty>No beds configured yet</Empty></div>}
      {Object.entries(wards).map(([w, list]) => (
        <div className="card" key={w}>
          <h4>{w}</h4>
          <div className="bed-grid">{list.map((b) => (
            <div key={b._id} className={`bed ${COLORS[b.status]}`} onClick={() => nav(`/m/beds?open=${b._id}`)} title={b.status}>
              <b>{b.bedNumber}</b><span>{b.status}</span>
            </div>
          ))}</div>
        </div>
      ))}
    </div>
  );
}