import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { mod } from '../api.js';
import { useApp } from '../App.jsx';
import { AsyncSelect, Badge, Empty } from '../components/ui.jsx';
import { fmtDate, pad, todayStr } from '../lib.js';
import { useLiveTick } from '../realtime.js';

const DOW = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function CalendarPage() {
  const { byKey, settings } = useApp();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [doctor, setDoctor] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(todayStr());

  const first = new Date(cursor.y, cursor.m, 1);
  const days = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const lead = (first.getDay() + 1) % 7; // Saturday-first week
  const from = `${cursor.y}-${pad(cursor.m + 1)}-01`;
  const to = `${cursor.y}-${pad(cursor.m + 1)}-${pad(days)}`;

  const tick = useLiveTick(['appointments']);
  useEffect(() => {
    let alive = true;
    mod.list('appointments', { from, to, limit: 200, f_doctor: doctor?.value, sort: 'time', order: 'asc' }).then((r) => alive && setRows(r.data)).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [from, to, doctor, tick]);

  const byDay = useMemo(() => {
    const m = {};
    rows.forEach((r) => { const k = fmtDate(r.date); (m[k] = m[k] || []).push(r); });
    return m;
  }, [rows]);
  const move = (n) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const dayKey = (n) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(n)}`;
  const list = (byDay[sel] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
  const label = (v) => (v && typeof v === 'object' ? v.name || v.code : '');

  return (
    <div className="page">
      <div className="page-head"><div><h1>🗓️ Appointment Calendar</h1><p className="muted">{first.toLocaleString('en', { month: 'long', year: 'numeric' })}</p></div>
        <div className="head-actions"><button className="btn" onClick={() => move(-1)}>‹ Prev</button><button className="btn" onClick={() => { const d = new Date(); setCursor({ y: d.getFullYear(), m: d.getMonth() }); setSel(todayStr()); }}>Today</button><button className="btn" onClick={() => move(1)}>Next ›</button>
          {byKey.appointments?.canWrite && <Link className="btn primary" to="/m/appointments?new=1">＋ Book</Link>}</div></div>
      <div className="card toolbar"><div className="grow-sm"><AsyncSelect module="doctors" value={doctor} onChange={setDoctor} placeholder="All doctors" /></div></div>
      <div className="calendar-layout">
        <div className="card calendar">
          {DOW.map((d) => <div key={d} className="cal-head">{d}</div>)}
          {cells.map((n, i) => {
            if (!n) return <div key={`e${i}`} className="cal-cell empty" />;
            const k = dayKey(n); const items = byDay[k] || [];
            return (
              <div key={k} className={`cal-cell ${k === todayStr() ? 'today' : ''} ${k === sel ? 'sel' : ''}`} onClick={() => setSel(k)}>
                <div className="cal-num">{n}{items.length > 0 && <span className="cal-count">{items.length}</span>}</div>
                {items.slice(0, 2).map((a) => <div key={a._id} className="cal-ev">{a.time} {label(a.patient).split(' ')[0]}</div>)}
                {items.length > 2 && <div className="muted small">+{items.length - 2} more</div>}
              </div>
            );
          })}
        </div>
        <div className="card">
          <h4>{sel}</h4>
          {!list.length ? <Empty>No appointments</Empty> : (
            <ul className="agenda">{list.map((a) => (
              <li key={a._id}><span className="mono">{a.time}</span><div><Link to={`/m/appointments?open=${a._id}`}><b>{label(a.patient)}</b></Link><div className="muted small">{label(a.doctor)} · {a.type}</div></div><Badge value={a.status} /></li>
            ))}</ul>
          )}
          <p className="muted small">{settings.clinicName}</p>
        </div>
      </div>
    </div>
  );
}