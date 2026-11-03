import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Badge, Empty, LineChart, Spinner } from '../components/ui.jsx';
import { ageOf, fmtDate, fmtDateTime, fmtMoney } from '../lib.js';

const QUICK = [['appointments', '📅 Appointment'], ['vitals', '❤️ Vitals'], ['consultations', '🩺 Consultation'], ['prescriptions', '📝 Prescription'], ['labOrders', '🔬 Lab order'], ['invoices', '💳 Invoice'], ['admissions', '🛌 Admit'], ['immunizations', '💉 Vaccine'], ['documents', '📎 Document']];

function Rows({ items, cols, linkKey }) {
  if (!items?.length) return <Empty>No records</Empty>;
  return (
    <div className="table-wrap"><table className="data-table"><thead><tr>{cols.map((c) => <th key={c.label}>{c.label}</th>)}</tr></thead>
      <tbody>{items.map((r) => (
        <tr key={r._id} className="clickable" onClick={() => linkKey && window.open(`/m/${linkKey}?open=${r._id}`, '_self')}>
          {cols.map((c) => <td key={c.label}>{c.render(r)}</td>)}
        </tr>
      ))}</tbody></table></div>
  );
}

export default function PatientProfile() {
  const { id } = useParams();
  const { byKey, settings } = useApp();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('timeline');
  const cur = settings.currency;
  useEffect(() => { setD(null); api.get(`/api/x/patient/${id}/summary`).then(setD).catch((e) => setErr(e.message)); }, [id]);

  const timeline = useMemo(() => {
    if (!d) return [];
    const ev = [];
    d.appointments.forEach((x) => ev.push({ at: x.date, icon: '📅', title: `Appointment ${x.code}`, sub: `${x.doctor?.name || ''} · ${x.status}`, link: `/m/appointments?open=${x._id}` }));
    d.consultations.forEach((x) => ev.push({ at: x.date, icon: '🩺', title: `Consultation: ${x.diagnosis}`, sub: x.doctor?.name, link: `/m/consultations?open=${x._id}` }));
    d.prescriptions.forEach((x) => ev.push({ at: x.date, icon: '📝', title: `Prescription ${x.code}`, sub: `${x.items?.length || 0} medicine(s)`, link: `/m/prescriptions?open=${x._id}` }));
    d.labOrders.forEach((x) => ev.push({ at: x.orderDate || x.createdAt, icon: '🔬', title: `Lab order ${x.code}`, sub: x.status, link: `/m/labOrders?open=${x._id}` }));
    d.admissions.forEach((x) => ev.push({ at: x.admitDate, icon: '🛌', title: `Admitted ${x.code}`, sub: `${x.reason} · ${x.status}`, link: `/m/admissions?open=${x._id}` }));
    d.vitals.forEach((x) => ev.push({ at: x.recordedAt, icon: '❤️', title: 'Vitals recorded', sub: `BP ${x.systolic ?? '–'}/${x.diastolic ?? '–'} · Pulse ${x.pulse ?? '–'}`, link: `/m/vitals?open=${x._id}` }));
    d.immunizations.forEach((x) => ev.push({ at: x.date, icon: '💉', title: `Vaccine: ${x.vaccine || x.code}`, sub: '', link: `/m/immunizations?open=${x._id}` }));
    d.invoices.forEach((x) => ev.push({ at: x.createdAt, icon: '💳', title: `Invoice ${x.code}`, sub: `${fmtMoney(x.total, cur)} · ${x.status}`, link: `/m/invoices?open=${x._id}` }));
    return ev.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);
  }, [d, cur]);

  if (err) return <div className="page"><div className="alert err">{err}</div></div>;
  if (!d) return <div className="page"><Spinner /></div>;
  const p = d.patient;
  const vit = [...d.vitals].reverse();
  const tabs = [['timeline', 'Timeline'], ['appointments', `Appointments (${d.appointments.length})`], ['consultations', `Consultations (${d.consultations.length})`], ['prescriptions', `Prescriptions (${d.prescriptions.length})`], ['lab', `Lab (${d.labOrders.length})`], ['vitals', `Vitals (${d.vitals.length})`], ['admissions', `Admissions (${d.admissions.length})`], ['more', 'Vaccines & documents'], ['invoices', `Invoices (${d.invoices.length})`]];

  return (
    <div className="page">
      <div className="card patient-head">
        <div className="avatar big">{p.name?.[0]}</div>
        <div className="grow">
          <h1>{p.name} <small className="mono muted">{p.code}</small> <Badge value={p.status} /></h1>
          <p className="muted">{p.gender} · {ageOf(p) !== '' ? `${ageOf(p)} yrs` : 'age n/a'} · {p.bloodGroup ? `Blood ${p.bloodGroup}` : 'blood group n/a'} · {p.phone} {p.email && `· ${p.email}`}</p>
          <p className="muted">{[p.address, p.city].filter(Boolean).join(', ')}</p>
          <div className="tag-list">
            {(p.allergies || []).map((a) => <span key={a} className="tag bad">⚠ Allergy: {a}</span>)}
            {(p.chronicConditions || []).map((a) => <span key={a} className="tag warn">{a}</span>)}
            {p.insuranceProvider?.name && <span className="tag">🛡 {p.insuranceProvider.name} {p.insuranceNo}</span>}
          </div>
        </div>
        <div className="patient-side">
          {d.dues > 0 && <div className="alert warn">Outstanding dues: <b>{fmtMoney(d.dues, cur)}</b></div>}
          {p.emergencyName && <p className="small muted">Emergency: {p.emergencyName} ({p.emergencyRelation}) {p.emergencyPhone}</p>}
          <button className="btn sm" onClick={() => window.open(`/print/patients/${p._id}`, '_blank')}>🖨 Print card</button>{' '}
          <Link className="btn sm" to={`/card/${p._id}`} target="_blank">🪪 QR ID card</Link>{' '}
          <Link className="btn sm" to={`/m/patients?open=${p._id}`}>Edit</Link>
        </div>
      </div>

      <div className="quick-actions">
        {QUICK.filter(([k]) => byKey[k]?.canWrite).map(([k, label]) => <Link key={k} className="btn sm" to={`/m/${k}?new=1&patient=${p._id}`}>＋ {label}</Link>)}
      </div>

      <div className="tabs">{tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>

      <div className="card">
        {tab === 'timeline' && (!timeline.length ? <Empty>No activity yet</Empty> : (
          <ul className="timeline">{timeline.map((e, i) => <li key={i}><span className="t-icon">{e.icon}</span><div><Link to={e.link}><b>{e.title}</b></Link><div className="muted small">{fmtDate(e.at)} {e.sub && `· ${e.sub}`}</div></div></li>)}</ul>
        ))}
        {tab === 'appointments' && <Rows linkKey="appointments" items={d.appointments} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Date', render: (r) => `${fmtDate(r.date)} ${r.time}` }, { label: 'Doctor', render: (r) => r.doctor?.name }, { label: 'Type', render: (r) => r.type }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} />}
        {tab === 'consultations' && <Rows linkKey="consultations" items={d.consultations} cols={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Doctor', render: (r) => r.doctor?.name }, { label: 'Complaint', render: (r) => r.chiefComplaint }, { label: 'Diagnosis', render: (r) => r.diagnosis }, { label: 'Follow-up', render: (r) => fmtDate(r.followUpDate) }]} />}
        {tab === 'prescriptions' && <Rows linkKey="prescriptions" items={d.prescriptions} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Doctor', render: (r) => r.doctor?.name }, { label: 'Medicines', render: (r) => (r.items || []).map((i) => i.medicineName).join(', ') }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} />}
        {tab === 'lab' && <><Rows linkKey="labOrders" items={d.labOrders} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Date', render: (r) => fmtDate(r.orderDate) }, { label: 'Tests', render: (r) => (r.items || []).length }, { label: 'Total', render: (r) => fmtMoney(r.total, cur) }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} />{d.radiology.length > 0 && <><h4>Imaging</h4><Rows linkKey="radiology" items={d.radiology} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Study', render: (r) => `${r.modality || ''} ${r.bodyPart || ''}` }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} /></>}</>}
        {tab === 'vitals' && (
          <>
            {vit.length > 1 && <div className="grid-2"><div><h4>Systolic BP</h4><LineChart data={vit.filter((v) => v.systolic).map((v) => ({ label: fmtDate(v.recordedAt).slice(5), value: v.systolic }))} color="#ef4444" /></div><div><h4>Weight (kg)</h4><LineChart data={vit.filter((v) => v.weight).map((v) => ({ label: fmtDate(v.recordedAt).slice(5), value: v.weight }))} color="#3b82f6" /></div></div>}
            <Rows linkKey="vitals" items={d.vitals} cols={[{ label: 'When', render: (r) => fmtDateTime(r.recordedAt) }, { label: 'BP', render: (r) => (r.systolic ? `${r.systolic}/${r.diastolic}` : '—') }, { label: 'Pulse', render: (r) => r.pulse ?? '—' }, { label: 'Temp °F', render: (r) => r.temperature ?? '—' }, { label: 'SpO₂', render: (r) => r.spo2 ?? '—' }, { label: 'Weight', render: (r) => r.weight ?? '—' }, { label: 'BMI', render: (r) => r.bmi ?? '—' }]} />
          </>
        )}
        {tab === 'admissions' && <Rows linkKey="admissions" items={d.admissions} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Admitted', render: (r) => fmtDateTime(r.admitDate) }, { label: 'Doctor', render: (r) => r.doctor?.name }, { label: 'Reason', render: (r) => r.reason }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} />}
        {tab === 'more' && (
          <><h4>Immunizations</h4><Rows linkKey="immunizations" items={d.immunizations} cols={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Vaccine', render: (r) => r.vaccine || r.code }, { label: 'Dose', render: (r) => r.doseNumber || '—' }, { label: 'Next due', render: (r) => fmtDate(r.nextDueDate) }]} />
            <h4>Documents</h4><Rows linkKey="documents" items={d.documents} cols={[{ label: 'Date', render: (r) => fmtDate(r.date) }, { label: 'Title', render: (r) => r.title || r.code }, { label: 'Category', render: (r) => r.category || '—' }, { label: 'File', render: (r) => (r.fileUrl ? <a href={r.fileUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open</a> : '—') }]} /></>
        )}
        {tab === 'invoices' && <Rows linkKey="invoices" items={d.invoices} cols={[{ label: 'Code', render: (r) => r.code }, { label: 'Date', render: (r) => fmtDate(r.invoiceDate) }, { label: 'Total', render: (r) => fmtMoney(r.total, cur) }, { label: 'Paid', render: (r) => fmtMoney(r.paid, cur) }, { label: 'Balance', render: (r) => fmtMoney(r.balance, cur) }, { label: 'Status', render: (r) => <Badge value={r.status} /> }]} />}
      </div>
    </div>
  );
}