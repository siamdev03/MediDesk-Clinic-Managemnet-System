import { useState } from 'react';
import { Modal } from './ui.jsx';
import { FieldInput } from './RecordForm.jsx';
import { initialValues, serialize } from '../lib.js';
import { useApp } from '../App.jsx';

// Small form shown for workflow actions / tools that need input (cancel reason, payment amount, …).
export default function ActionDialog({ title, fields, record, confirm, danger, onClose, onRun }) {
  const { byKey } = useApp();
  const cfg = { fields };
  const [values, setValues] = useState(() => {
    const v = initialValues(byKey, cfg, null);
    for (const f of fields) if (f.defaultFrom && record?.[f.defaultFrom] !== undefined) v[f.name] = record[f.defaultFrom];
    return v;
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await onRun(serialize(cfg, values)); } catch (ex) { setErr(ex.message); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className={`btn ${danger ? 'danger' : 'primary'}`} form="action-form" disabled={busy}>{busy ? 'Working…' : 'Confirm'}</button></>}>
      <form id="action-form" onSubmit={submit} className="form-grid one">
        {confirm && <p className="full">{confirm}</p>}
        {err && <div className="alert err full">{err}</div>}
        {fields.map((f) => (
          <div className="field full" key={f.name}>
            <label>{f.label}{f.required && <b className="req"> *</b>}</label>
            <FieldInput f={f} value={values[f.name]} onChange={(v) => setValues((x) => ({ ...x, [f.name]: v }))} />
          </div>
        ))}
      </form>
    </Modal>
  );
}
