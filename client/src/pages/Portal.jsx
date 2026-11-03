// Feature 3: patient portal – /portal. Sign in with phone + SMS code, then see/book/pay.
import { useCallback, useEffect, useState } from 'react';
import { pub, qs } from '../pubApi.js';
import PublicShell, { SlotChooser } from '../components/PublicShell.jsx';
import { useLang } from '../i18n.jsx';

const KEY = 'medidesk_portal';
const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; } };
const money = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const d10 = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

function SignIn({ onDone }) {
  const { t } = useLang();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await pub('POST', '/api/portal/otp', { phone }); setSent(true); setDev(r.devOtp || ''); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const verify = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await pub('POST', '/api/portal/verify', { phone, otp }); onDone({ token: r.token, patients: r.patients }); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <div className="card public-card">
      <h2>{t('Patient portal')}</h2>
      {err && <div className="alert err">{err}</div>}
      {!sent ? (
        <form onSubmit={send} className="form-grid one">
          <div className="field"><label>{t('Mobile number')}</label><input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" required autoFocus /></div>
          <button className="btn primary block" disabled={busy}>{t('Send code')}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="form-grid one">
          <p className="muted small">We sent a 6-digit code to {phone}.</p>
          {dev && <div className="alert info">Test mode (no SMS provider set): your code is <b className="mono">{dev}</b></div>}
          <div className="field"><label>Code</label><input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} required autoFocus /></div>
          <button className="btn primary block" disabled={busy}>{t('Verify')}</button>
          <button type="button" className="btn" onClick={() => { setSent(false); setOtp(''); }}>{t('Back')}</button>
        </form>
      )}
    </div>
  );
}

function Dashboard({ session, onOut }) {
  const { t } = useLang();
  const { token, patients } = session;
  const [pid, setPid] = useState(patients[0]?._id);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('home');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [doctors, setDoctors] = useState([]);
  const [bk, setBk] = useState({ doctor: '', date: '', time: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => pub('GET', `/api/portal/summary${qs({ pid })}`, undefined, token).then(setData).catch((e) => { setErr(e.message); if (/sign in/i.test(e.message)) onOut(); }), [pid, token, onOut]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  useEffect(() => { pub('GET', '/api/portal/doctors', undefined, token).then(setDoctors).catch(() => {}); }, [token]);
  const file = (path) => `/api/portal/${path}${path.includes('?') ? '&' : '?'}pid=${pid}&token=${encodeURIComponent(token)}`;
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 5000); };

  const book = async (e) => {
    e.preventDefault();
    if (!bk.time) { setErr('Choose a time slot'); return; }
    setBusy(true); setErr('');
    try { const r = await pub('POST', '/api/portal/book', { pid, ...bk }, token); flash(`Booked ${r.code}: ${r.date} ${r.time}`); setBk({ doctor: '', date: '', time: '', reason: '' }); setTab('home'); reload(); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  const cancel = async (id) => {
    if (!window.confirm('Cancel this appointment?')) return;
    try { await pub('POST', '/api/portal/cancel', { pid, id }, token); flash('Appointment cancelled'); reload(); } catch (x) { setErr(x.message); }
  };
  const pay = async (inv, provider) => {
    try { const r = await pub('POST', '/api/portal/pay', { pid, invoiceId: inv._id, amount: inv.balance, provider }, token); window.location.href = r.url; } catch (x) { setErr(x.message); }
  };
  const TABS = [['home', 'Upcoming appointments'], ['book', 'Book an appointment'], ['rx', 'Prescriptions'], ['lab', 'Lab reports'], ['bills', 'Bills']];

  return (
    <div className="portal">
      <div className="card portal-head">
        <div>
          {patients.length > 1 ? <select value={pid} onChange={(e) => setPid(e.target.value)}>{patients.map((p) => <option key={p._id} value={p._id}>{p.name} ({p.code})</option>)}</select> : <h2>{data?.patient?.name || patients[0]?.name}</h2>}
          <p className="muted small mono">{data?.patient?.code}</p>
        </div>
        <div className="qr-box"><img src={file('qr')} alt="Patient QR" width="96" height="96" /><small>Show at reception</small></div>
        <button className="btn sm" onClick={onOut}>{t('Sign out')}</button>
      </div>
      {msg && <div className="alert ok">{msg}</div>}
      {err && <div className="alert err" onClick={() => setErr('')}>{err}</div>}
      <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{t(l)}</button>)}</div>
      {!data ? <p className="muted">{t('Loading')}…</p> : (
        <div className="card">
          {tab === 'home' && (!data.upcoming.length ? <p className="muted">No upcoming appointments.</p> : data.upcoming.map((a) => (
            <div className="row-line" key={a._id}><div><b>{d10(a.date)} · {a.time}</b><br /><span className="muted small">Dr. {a.doctor?.name} {a.doctor?.room ? `· Room ${a.doctor.room}` : ''} · {a.code}</span></div>
              <div><span className="badge info">{a.status}</span> {['Scheduled', 'Confirmed'].includes(a.status) && <button className="btn sm danger" onClick={() => cancel(a._id)}>Cancel</button>}</div></div>
          )))}
          {tab === 'book' && (
            <form className="form-grid" onSubmit={book}>
              <SlotChooser base="/api/portal" token={token} doctors={doctors} value={bk} onChange={(o) => setBk((x) => ({ ...x, ...o }))} />
              <div className="field full"><label>Reason</label><textarea rows={2} value={bk.reason} onChange={(e) => setBk({ ...bk, reason: e.target.value })} /></div>
              <div className="full"><button className="btn primary" disabled={busy}>{t('Book an appointment')}</button></div>
            </form>
          )}
          {tab === 'rx' && (!data.prescriptions.length ? <p className="muted">No prescriptions yet.</p> : data.prescriptions.map((r) => (
            <div className="row-line" key={r._id}><div><b>{d10(r.date)} · Dr. {r.doctor}</b><br /><span className="muted small">{r.diagnosis} — {r.items.join(', ')}</span></div>
              <a className="btn sm" href={file(`pdf/prescriptions/${r._id}`)} target="_blank" rel="noreferrer">{t('Download PDF')}</a></div>
          )))}
          {tab === 'lab' && (!data.labs.length ? <p className="muted">No finished lab reports yet.</p> : data.labs.map((l) => (
            <div className="row-line" key={l._id}><div><b>{l.code}</b> · {d10(l.date)}<br /><span className="muted small">{l.tests} test(s)</span></div>
              <a className="btn sm" href={file(`pdf/labOrders/${l._id}`)} target="_blank" rel="noreferrer">{t('Download PDF')}</a></div>
          )))}
          {tab === 'bills' && (!data.invoices.length ? <p className="muted">No bills.</p> : data.invoices.map((i) => (
            <div className="row-line" key={i._id}><div><b>{i.code}</b> · {d10(i.date)}<br /><span className="muted small">Total {money(i.total)} · Paid {money(i.paid)} · <b>Due {money(i.balance)}</b></span></div>
              <div className="row-actions">
                <a className="btn sm" href={file(`pdf/invoices/${i._id}`)} target="_blank" rel="noreferrer">PDF</a>
                {i.balance > 0 && data.payProviders.map((p) => <button key={p} className="btn sm primary" onClick={() => pay(i, p)}>{t('Pay now')} · {p}</button>)}
              </div></div>
          )))}
        </div>
      )}
    </div>
  );
}

export default function Portal() {
  const [clinic, setClinic] = useState(null);
  const [session, setSession] = useState(load);
  useEffect(() => { pub('GET', '/api/public/clinic').then(setClinic).catch(() => {}); }, []);
  const save = (s) => { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch { /* ignore */ } setSession(s); };
  const out = useCallback(() => save(null), []);
  return <PublicShell clinic={clinic} wide>{session ? <Dashboard session={session} onOut={out} /> : <SignIn onDone={save} />}</PublicShell>;
}