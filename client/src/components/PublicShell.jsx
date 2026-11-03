import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { pub, qs } from '../pubApi.js';

export default function PublicShell({ clinic, children, wide }) {
  const { lang, setLang } = useLang();
  return (
    <div className="public-page">
      <header className="public-head">
        <Link to="/" className="public-brand"><span>🏥</span><div><b>{clinic?.clinicName || 'MediDesk Clinic'}</b>{clinic?.tagline && <small>{clinic.tagline}</small>}</div></Link>
        <div className="public-nav">
          <Link to="/book">Book</Link><Link to="/portal">Patient portal</Link>
          <button className="btn sm" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}>{lang === 'bn' ? 'English' : 'বাংলা'}</button>
        </div>
      </header>
      <main className={`public-main ${wide ? 'wide' : ''}`}>{children}</main>
      {clinic && <footer className="public-foot">{[clinic.address, clinic.phone, clinic.email].filter(Boolean).join('  ·  ')}</footer>}
    </div>
  );
}

// Doctor + date + time slots picker shared by online booking and the portal
export function SlotChooser({ base, doctors, token, value, onChange }) {
  const { t } = useLang();
  const [slots, setSlots] = useState(null);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const { doctor, date, time } = value;
  useEffect(() => {
    if (!doctor || !date) { setSlots(null); return undefined; }
    let alive = true;
    pub('GET', `${base}/slots${qs({ doctor, date })}`, undefined, token).then((r) => alive && setSlots(r)).catch((e) => alive && setSlots({ slots: [], message: e.message }));
    return () => { alive = false; };
  }, [doctor, date, base, token]);
  const doc = doctors.find((d) => d._id === doctor);
  return (
    <>
      <div className="field"><label>{t('Choose a doctor')}</label>
        <select value={doctor || ''} onChange={(e) => onChange({ doctor: e.target.value, time: '' })} required>
          <option value="">— select —</option>
          {doctors.map((d) => <option key={d._id} value={d._id}>{d.name} — {d.specialization}{d.fee ? ` (${d.fee})` : ''}</option>)}
        </select>
        {doc?.workDays?.length > 0 && <small className="muted">Works: {doc.workDays.join(', ')}</small>}
      </div>
      <div className="field"><label>{t('Choose a date')}</label><input type="date" min={today} value={date || ''} onChange={(e) => onChange({ date: e.target.value, time: '' })} required /></div>
      <div className="field full"><label>{t('Choose a time')}</label>
        {!doctor || !date ? <p className="muted small">Pick a doctor and a date first.</p>
          : !slots ? <p className="muted small">{t('Loading')}…</p>
            : !slots.slots.length ? <p className="error-text">{slots.message || 'No slots on this day'}</p>
              : <div className="slots">{slots.slots.map((s) => <button type="button" key={s.time} disabled={!s.available} className={`slot ${s.time === time ? 'on' : ''} ${s.available ? '' : 'taken'}`} onClick={() => onChange({ time: s.time })}>{s.time}</button>)}</div>}
      </div>
    </>
  );
}