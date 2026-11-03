// Feature 5: printable patient ID card with QR code – /card/:id
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { authUrl, mod } from '../api.js';
import { useApp } from '../App.jsx';
import { Spinner } from '../components/ui.jsx';
import { ageOf } from '../lib.js';

export default function PatientCard() {
  const { id } = useParams();
  const { settings } = useApp();
  const [p, setP] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { mod.get('patients', id).then(setP).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="page"><div className="alert err">{err}</div></div>;
  if (!p) return <div className="page"><Spinner /></div>;
  return (
    <div className="card-page">
      <div className="id-card">
        <div className="id-head"><span>🏥</span><div><b>{settings.clinicName}</b><small>{settings.phone}</small></div></div>
        <div className="id-body">
          {p.photo ? <img className="id-photo" src={p.photo} alt="" /> : <div className="id-photo ph">{p.name?.[0]}</div>}
          <div className="id-info"><h3>{p.name}</h3><div className="mono">{p.code}</div>
            <div>{[p.gender, ageOf(p) !== '' && `${ageOf(p)} yrs`, p.bloodGroup].filter(Boolean).join(' · ')}</div><div>{p.phone}</div></div>
          <img className="id-qr" src={authUrl(`/api/x/qr?data=${encodeURIComponent(p.code)}&size=220`)} alt="QR" />
        </div>
        <div className="id-foot">Scan the QR at reception · Please bring this card on every visit</div>
      </div>
      <p className="no-print"><button className="btn primary" onClick={() => window.print()}>🖨 Print card</button></p>
    </div>
  );
}