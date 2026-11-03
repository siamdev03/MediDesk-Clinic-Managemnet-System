import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { mod } from '../api.js';
import { useApp } from '../App.jsx';
import { ItemsTable, Value } from '../components/Cell.jsx';
import { ageOf, fmtDate, fmtDateTime, fmtMoney, labelOf } from '../lib.js';

function Header({ settings, title, code }) {
  return (
    <header className="print-head">
      <div><h1>{settings.clinicName}</h1><p>{settings.tagline}</p><p className="small">{settings.address} · {settings.phone} · {settings.email}</p></div>
      <div className="print-title"><h2>{title}</h2>{code && <p className="mono">{code}</p>}</div>
    </header>
  );
}

const PatientBox = ({ p }) => (p ? (
  <div className="print-box">
    <div><b>Patient:</b> {p.name} ({p.code})</div>
    <div><b>Age/Sex:</b> {ageOf(p) !== '' ? `${ageOf(p)} y` : '—'} / {p.gender || '—'}</div>
    <div><b>Phone:</b> {p.phone || '—'}</div>
    {p.bloodGroup && <div><b>Blood group:</b> {p.bloodGroup}</div>}
  </div>
) : null);

export default function PrintView() {
  const { key, id } = useParams();
  const { byKey, settings } = useApp();
  const cfg = byKey[key];
  const cur = settings.currency;
  const [rec, setRec] = useState(null);
  const [payments, setPayments] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!cfg) return;
    mod.get(key, id).then(async (r) => {
      setRec(r);
      if (key === 'invoices') { try { setPayments((await mod.list('payments', { f_invoice: id, limit: 50 })).data); } catch { /* optional */ } }
    }).catch((e) => setErr(e.message));
  }, [key, id, cfg]);

  if (!cfg) return <div className="print-page"><p>Not available.</p></div>;
  if (err) return <div className="print-page"><p className="error-text">{err}</p></div>;
  if (!rec) return <div className="print-page"><p>Loading…</p></div>;
  const title = cfg.label.replace(/ \(.*\)/, '').replace(/s$/, '');
  const dr = rec.doctor;

  let body;
  if (key === 'invoices') {
    body = (
      <>
        <PatientBox p={rec.patient} />
        <p><b>Date:</b> {fmtDate(rec.invoiceDate)} &nbsp; <b>Due:</b> {fmtDate(rec.dueDate)} &nbsp; <b>Status:</b> {rec.status}</p>
        <table className="print-table">
          <thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr></thead>
          <tbody>{(rec.items || []).map((i, n) => <tr key={i._id || n}><td>{n + 1}</td><td>{i.description}</td><td className="r">{i.quantity}</td><td className="r">{fmtMoney(i.unitPrice, cur)}</td><td className="r">{fmtMoney(i.amount, cur)}</td></tr>)}</tbody>
        </table>
        <table className="print-totals"><tbody>
          <tr><td>Subtotal</td><td className="r">{fmtMoney(rec.subtotal, cur)}</td></tr>
          {rec.discount > 0 && <tr><td>Discount</td><td className="r">− {fmtMoney(rec.discount, cur)}</td></tr>}
          {rec.tax > 0 && <tr><td>Tax ({rec.taxRate}%)</td><td className="r">{fmtMoney(rec.tax, cur)}</td></tr>}
          <tr className="strong"><td>Total</td><td className="r">{fmtMoney(rec.total, cur)}</td></tr>
          <tr><td>Paid</td><td className="r">{fmtMoney(rec.paid, cur)}</td></tr>
          <tr className="strong"><td>Balance due</td><td className="r">{fmtMoney(rec.balance, cur)}</td></tr>
        </tbody></table>
        {payments.length > 0 && <><h4>Payments</h4><table className="print-table"><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th className="r">Amount</th></tr></thead><tbody>{payments.map((p) => <tr key={p._id}><td>{p.code}</td><td>{fmtDate(p.date)}</td><td>{p.method}</td><td className="r">{fmtMoney(p.amount, cur)}</td></tr>)}</tbody></table></>}
        {rec.notes && <p className="small"><b>Notes:</b> {rec.notes}</p>}
        <p className="print-foot">{settings.invoiceFooter}</p>
      </>
    );
  } else if (key === 'prescriptions') {
    body = (
      <>
        <PatientBox p={rec.patient} />
        <p><b>Date:</b> {fmtDate(rec.date)} {rec.diagnosis && <> &nbsp; <b>Diagnosis:</b> {rec.diagnosis}</>}</p>
        <h3 className="rx">℞</h3>
        <table className="print-table">
          <thead><tr><th>#</th><th>Medicine</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Instructions</th></tr></thead>
          <tbody>{(rec.items || []).map((i, n) => <tr key={i._id || n}><td>{n + 1}</td><td><b>{i.medicineName}</b></td><td>{i.dosage}</td><td>{i.frequency}</td><td>{i.duration}</td><td>{i.instructions}</td></tr>)}</tbody>
        </table>
        {rec.advice && <p><b>Advice:</b> {rec.advice}</p>}
        {rec.followUpDate && <p><b>Follow-up on:</b> {fmtDate(rec.followUpDate)}</p>}
        <div className="signature"><div>{dr?.name}</div><small>{dr?.qualification} {dr?.specialization && `· ${dr.specialization}`}</small></div>
      </>
    );
  } else if (key === 'labOrders') {
    body = (
      <>
        <PatientBox p={rec.patient} />
        <p><b>Ordered:</b> {fmtDate(rec.orderDate)} {dr && <>&nbsp; <b>Referred by:</b> {dr.name}</>} &nbsp; <b>Status:</b> {rec.status}</p>
        <table className="print-table">
          <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Normal range</th><th>Flag</th></tr></thead>
          <tbody>{(rec.items || []).map((i, n) => <tr key={i._id || n}><td>{labelOf(byKey, 'labTests', i.test) || '—'}</td><td><b>{i.result || '—'}</b></td><td>{i.unit}</td><td>{i.normalRange}</td><td>{i.flag}</td></tr>)}</tbody>
        </table>
        {rec.completedAt && <p className="small">Report released: {fmtDateTime(rec.completedAt)}</p>}
        <div className="signature"><div>Laboratory in-charge</div></div>
      </>
    );
  } else {
    body = (
      <table className="print-table kv"><tbody>
        {cfg.fields.filter((f) => f.type !== 'items' && f.type !== 'password' && rec[f.name] !== undefined && rec[f.name] !== null && rec[f.name] !== '').map((f) => (
          <tr key={f.name}><th>{f.label}</th><td><Value f={f} v={rec[f.name]} byKey={byKey} currency={cur} link={false} /></td></tr>
        ))}
      </tbody></table>
    );
  }

  return (
    <div className="print-page">
      <div className="print-bar no-print"><button className="btn primary" onClick={() => window.print()}>🖨 Print</button> <button className="btn" onClick={() => window.close()}>Close</button></div>
      <Header settings={settings} title={title} code={rec.code} />
      {body}
      {!['invoices', 'prescriptions', 'labOrders'].includes(key) && cfg.fields.filter((f) => f.type === 'items').map((f) => <div key={f.name}><h4>{f.label}</h4><ItemsTable f={f} rows={rec[f.name]} byKey={byKey} currency={cur} /></div>)}
    </div>
  );
}
