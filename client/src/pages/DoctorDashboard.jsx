// Feature 13: a doctor's own dashboard – /doctor
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { AsyncSelect, Badge, Empty, Spinner } from '../components/ui.jsx';
import { fmtDate, fmtMoney } from '../lib.js';
import { useLiveTick } from '../realtime.js';

export default function DoctorDashboard() {
  const { user, settings } = useApp();
  const [pick, setPick] = useState(null);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const tick = useLiveTick(['appointments', 'queue', 'labOrders', 'consultations']);
  useEffect(() => { api.get('/api/x/doctor/dashboard', { doctor: pick?.value }).then((r) => { setD(r); setErr(''); }).catch((e) => setErr(e.message)); }, [pick, tick]);
  const cur = settings.currency;
  const max = Math.max(1, ...(d?.week || []).map((w) => w.visits));
  return (
    <div className="page">
      <div className="page-head"><div><h1>🩺 {d?.doctor ? `Dr. ${d.doctor.name}` : 'Doctor dashboard'}</h1><p className="muted">{d?.doctor?.specialization} {d?.doctor?.room ? `· Room ${d.doctor.room}` : ''}</p></div>
        {user.role === 'admin' && <div style={{ minWidth: 260 }}><AsyncSelect module="doctors" value={pick} onChange={setPick} placeholder="View as doctor…" /></div>}</div>
      {err && <div className="alert err">{err}</div>}
      {!d ? !err && <Spinner /> : !d.doctor ? <div className="alert info">{d.message}</div> : (
        <>
          <div className="stat-grid">
            <div className="stat"><b>{d.today.total}</b><span>Appointments today</span></div>
            <div className="stat"><b>{d.today.completed}</b><span>Completed</span></div>
            <div className="stat"><b>{d.today.waiting.length}</b><span>In queue now</span></div>
            <div className="stat"><b>{d.month.visits}</b><span>Visits this month</span></div>
            <div className="stat"><b>{fmtMoney(d.month.fees, cur)}</b><span>Fees this month</span></div>
            <div className="stat"><b>{fmtMoney(d.month.commission, cur)}</b><span>Commission ({d.doctor.commissionPct}%)</span></div>
          </div>
          <div className="grid2">
            <div className="card"><h4>📅 Today's appointments</h4>
              {!d.today.appointments.length ? <Empty>No appointments today</Empty> : d.today.appointments.map((a) => (
                <div className="row-line" key={a._id}><div><b>{a.time}</b> · <Link to={`/patient/${a.patient?._id}`}>{a.patient?.name}</Link><br /><span className="muted small">{a.patient?.age ? `${a.patient.age}y ` : ''}{a.patient?.gender} · {a.reason || a.type}</span></div>
                  <Link to={`/m/appointments?open=${a._id}`}><Badge value={a.status} /></Link></div>))}</div>
            <div className="card"><h4>🎫 Waiting in queue</h4>
              {!d.today.waiting.length ? <Empty>Nobody waiting</Empty> : d.today.waiting.map((q) => (
                <div className="row-line" key={q._id}><div><b>#{q.token}</b> {q.patient?.name || q.walkInName}</div><Badge value={q.status} /></div>))}</div>
            <div className="card"><h4>🧪 Lab orders (last 7 days)</h4>
              {!d.labs.length ? <Empty>No lab orders</Empty> : d.labs.map((l) => (
                <div className="row-line" key={l._id}><div><Link to={`/m/labOrders?open=${l._id}`}>{l.code}</Link> · {l.patient?.name}</div><Badge value={l.status} /></div>))}</div>
            <div className="card"><h4>🔁 Follow-ups due</h4>
              {!d.followUps.length ? <Empty>No follow-ups due this week</Empty> : d.followUps.map((c) => (
                <div className="row-line" key={c._id}><div><Link to={`/patient/${c.patient?._id}`}>{c.patient?.name}</Link><br /><span className="muted small">{c.diagnosis}</span></div><span className="mono small">{fmtDate(c.date)}</span></div>))}
              <Link to="/follow-ups" className="small">Open follow-up tracker →</Link></div>
          </div>
          <div className="card"><h4>Completed visits – last 7 days</h4>
            <div className="mini-bars">{d.week.map((w) => <div key={w.date} title={`${w.date}: ${w.visits}`}><i style={{ height: `${(w.visits / max) * 100}%` }} /><small>{w.date.slice(5)}</small><b>{w.visits}</b></div>)}</div></div>
        </>
      )}
    </div>
  );
}