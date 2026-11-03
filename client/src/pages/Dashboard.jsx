import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useLiveTick } from '../realtime.js';
import { useApp } from '../App.jsx';
import { Badge, BarChart, DonutChart, Empty, LineChart, Spinner } from '../components/ui.jsx';
import { fmtDate, fmtMoney } from '../lib.js';

const Stat = ({ icon, label, value, to, tone = '' }) => {
  const nav = useNavigate();
  return (
    <div className={`stat ${tone} ${to ? 'clickable' : ''}`} onClick={() => to && nav(to)}>
      <span className="stat-icon">{icon}</span>
      <div><div className="stat-value">{value}</div><div className="stat-label">{label}</div></div>
    </div>
  );
};

export default function Dashboard() {
  const { user, settings, has } = useApp();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const tick = useLiveTick(['appointments', 'queue', 'invoices', 'payments', 'pharmacySales', 'admissions', 'labOrders', 'medicines']);
  useEffect(() => {
    const load = () => api.get('/api/x/dashboard').then(setD).catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [tick]);
  if (err) return <div className="page"><div className="alert err">{err}</div></div>;
  if (!d) return <div className="page"><Spinner /></div>;
  const s = d.stats; const cur = settings.currency;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <div className="page-head"><div><h1>{greet}, {user.name.split(' ')[0]} 👋</h1><p className="muted">{new Date().toDateString()} · {settings.clinicName}</p></div>
        <div className="head-actions">
          {has('patients') && <Link className="btn" to="/m/patients?new=1">＋ Patient</Link>}
          {has('appointments') && <Link className="btn primary" to="/m/appointments?new=1">＋ Appointment</Link>}
        </div>
      </div>

      {d.announcements.length > 0 && (
        <div className="announce">{d.announcements.map((a) => <div key={a._id} className={`alert ${a.priority === 'Urgent' ? 'err' : a.priority === 'Important' ? 'warn' : 'info'}`}><b>{a.title}</b> — {a.body}</div>)}</div>
      )}

      {d.finance && (
        <div className="stats">
          <Stat icon="💵" label="Revenue today" value={fmtMoney(d.finance.revenueToday, cur)} tone="good" />
          <Stat icon="📈" label="Revenue this month" value={fmtMoney(d.finance.revenueMonth, cur)} tone="good" />
          <Stat icon="📉" label="Expenses this month" value={fmtMoney(d.finance.expensesMonth, cur)} />
          <Stat icon="🧾" label="Outstanding dues" value={fmtMoney(d.finance.dues, cur)} tone="warn" to="/m/invoices" />
        </div>
      )}

      <div className="stats">
        {has('patients') && <Stat icon="🧑‍⚕️" label={`Patients (+${s.newPatients} this month)`} value={s.patients} to="/m/patients" />}
        {has('doctors') && <Stat icon="👨‍⚕️" label="Active doctors" value={s.doctors} to="/m/doctors" />}
        {has('appointments') && <Stat icon="📅" label="Appointments today" value={s.apptToday} to="/calendar" />}
        {has('appointments') && <Stat icon="⏳" label="Pending today" value={s.apptPending} tone="warn" />}
        {has('queue') && <Stat icon="🎫" label="In OPD queue" value={s.queueWaiting} to="/queue-board" />}
        {has('admissions') && <Stat icon="🛌" label="Admitted patients" value={s.admitted} to="/m/admissions" />}
        {has('beds') && <Stat icon="🛏️" label={`Beds free (of ${s.bedsTotal})`} value={s.bedsAvailable} to="/bed-map" />}
        {has('labOrders') && <Stat icon="🔬" label="Lab pending" value={s.labPending} to="/m/labOrders" />}
        {has('medicines') && <Stat icon="💊" label="Low stock" value={s.lowStock} tone={s.lowStock ? 'bad' : ''} to="/m/medicines?lowStock=1" />}
        {has('medicines') && <Stat icon="⌛" label="Expiring soon" value={s.expiringSoon} tone={s.expiringSoon ? 'warn' : ''} to="/m/medicines?expiring=1" />}
        {has('medicines') && <Stat icon="⛔" label="Expired in stock" value={s.expired} tone={s.expired ? 'bad' : ''} to="/m/medicines?expired=1" />}
        {has('invoices') && <Stat icon="🧾" label="Unpaid invoices" value={s.unpaidInvoices} to="/m/invoices" />}
        {has('surgeries') && <Stat icon="🔪" label="Surgeries today" value={s.surgeriesToday} to="/m/surgeries" />}
        {has('bloodBank') && <Stat icon="🩸" label="Blood units available" value={s.bloodUnits} to="/m/bloodBank" />}
        {has('ambulances') && <Stat icon="🚑" label="Ambulances free" value={s.ambulancesFree} to="/m/ambulances" />}
        {has('tasks') && <Stat icon="✅" label="My open tasks" value={s.tasksOpen} to="/m/tasks" />}
      </div>

      <div className="grid-2">
        <div className="card"><h4>Appointments – last 14 days</h4><LineChart data={d.charts.apptDaily} /></div>
        {d.charts.revenueDaily
          ? <div className="card"><h4>Collections – last 14 days ({cur})</h4><BarChart data={d.charts.revenueDaily} color="#10b981" format={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} /></div>
          : <div className="card"><h4>New patients per month</h4><BarChart data={d.charts.patientsMonthly} /></div>}
        <div className="card"><h4>Appointments by status (this month)</h4><DonutChart data={d.charts.apptStatus} /></div>
        <div className="card"><h4>Top doctors this month</h4><BarChart data={d.charts.topDoctors} color="#8b5cf6" /></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h4>Today's schedule</h4>
          {!d.upcoming.length ? <Empty>No appointments left today</Empty> : (
            <table className="mini-table"><tbody>
              {d.upcoming.map((a) => <tr key={a._id}><td className="mono">{a.time}</td><td>{a.patient}</td><td className="muted">{a.doctor}</td><td><Badge value={a.status} /></td></tr>)}
            </tbody></table>
          )}
        </div>
        <div className="card">
          <h4>Recently registered patients</h4>
          {!d.recentPatients.length ? <Empty>No patients yet</Empty> : (
            <table className="mini-table"><tbody>
              {d.recentPatients.map((p) => <tr key={p._id}><td className="mono">{p.code}</td><td><Link to={`/patient/${p._id}`}>{p.name}</Link></td><td className="muted">{p.gender}</td><td className="muted">{fmtDate(p.createdAt)}</td></tr>)}
            </tbody></table>
          )}
        </div>
      </div>
    </div>
  );
}