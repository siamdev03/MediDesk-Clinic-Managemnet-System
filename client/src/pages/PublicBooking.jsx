// Feature 2: online appointment booking page for patients – /book (no login)
import { useEffect, useState } from 'react';
import { pub } from '../pubApi.js';
import PublicShell, { SlotChooser } from '../components/PublicShell.jsx';
import { useLang } from '../i18n.jsx';

export default function PublicBooking() {
  const { t } = useLang();
  const [clinic, setClinic] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [v, setV] = useState({ doctor: '', date: '', time: '', name: '', phone: '', gender: 'Male', age: '', reason: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  useEffect(() => {
    pub('GET', '/api/public/clinic').then(setClinic).catch(() => {});
    pub('GET', '/api/public/doctors').then(setDoctors).catch((e) => setErr(e.message));
  }, []);
  const patch = (o) => setV((x) => ({ ...x, ...o }));
  const submit = async (e) => {
    e.preventDefault();
    if (!v.time) { setErr('Please choose a time slot'); return; }
    setBusy(true); setErr('');
    try { setDone(await pub('POST', '/api/public/book', v)); } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  if (done) {
    const doc = doctors.find((d) => d._id === v.doctor);
    return (
      <PublicShell clinic={clinic}>
        <div className="card public-card center">
          <div className="big-ok">✅</div>
          <h2>{t('Booking confirmed')}</h2>
          <p>Reference <b className="mono">{done.code}</b></p>
          <p>{doc ? `Dr. ${doc.name}` : done.doctor}<br /><b>{done.date}</b> at <b>{done.time}</b>{done.room ? ` · Room ${done.room}` : ''}</p>
          <p className="muted small">A confirmation SMS is sent to your mobile. Please arrive 10 minutes early and bring this reference.</p>
          <button className="btn" onClick={() => { setDone(null); setV((x) => ({ ...x, time: '', reason: '' })); }}>Book another</button>
        </div>
      </PublicShell>
    );
  }
  return (
    <PublicShell clinic={clinic}>
      <form className="card public-card form-grid" onSubmit={submit}>
        <h2 className="full">{t('Book an appointment')}</h2>
        {err && <div className="alert err full">{err}</div>}
        <SlotChooser base="/api/public" doctors={doctors} value={v} onChange={patch} />
        <div className="field"><label>{t('Your name')} *</label><input value={v.name} onChange={(e) => patch({ name: e.target.value })} required minLength={2} /></div>
        <div className="field"><label>{t('Mobile number')} *</label><input type="tel" inputMode="tel" value={v.phone} onChange={(e) => patch({ phone: e.target.value })} required placeholder="01XXXXXXXXX" /></div>
        <div className="field"><label>{t('Gender')}</label><select value={v.gender} onChange={(e) => patch({ gender: e.target.value })}><option>Male</option><option>Female</option><option>Other</option></select></div>
        <div className="field"><label>{t('Age')}</label><input type="number" min="0" max="120" value={v.age} onChange={(e) => patch({ age: e.target.value })} /></div>
        <div className="field full"><label>{t('Reason')}</label><textarea rows={2} value={v.reason} onChange={(e) => patch({ reason: e.target.value })} /></div>
        <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={v.website} onChange={(e) => patch({ website: e.target.value })} />
        <div className="full"><button className="btn primary block" disabled={busy}>{busy ? `${t('Loading')}…` : t('Book an appointment')}</button></div>
      </form>
    </PublicShell>
  );
}