import { useEffect, useMemo, useRef, useState } from 'react';
import { api, mod } from '../api.js';
import { useApp } from '../App.jsx';
import { AsyncSelect, Modal, useToast } from './ui.jsx';
import Webcam from './Webcam.jsx';
import ScanBox from './Scanner.jsx';
import { RxTemplateBar, RxWarnings } from './RxTools.jsx';
import { useLang } from '../i18n.jsx';
import { blankRow, evalComputed, fmtMoney, initialValues, serialize } from '../lib.js';

// Single input for one field definition. `onFill` lets a ref field fill sibling fields.
export function FieldInput({ f, value, onChange, onFill, disabled }) {
  const common = { disabled, id: `f_${f.name}` };
  switch (f.type) {
    case 'textarea': return <textarea rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'number': return <input type="number" step="any" min={f.min} max={f.max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'date': return <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'datetime': return <input type="datetime-local" value={value || ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'time': return <input type="time" value={value || ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'month': return <input type="month" value={value || ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'email': return <input type="email" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'url': return <input type="url" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'password': return <input type="password" autoComplete="new-password" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    case 'checkbox': return <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> <span>Yes</span></label>;
    case 'select':
      return (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common}>
          <option value="">— select —</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'multiselect':
      return (
        <div className="chips">
          {f.options.map((o) => {
            const on = (value || []).includes(o);
            return <button type="button" key={o} className={`chip ${on ? 'on' : ''}`} disabled={disabled} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...(value || []), o])}>{o}</button>;
          })}
        </div>
      );
    case 'ref':
      return (
        <AsyncSelect
          module={f.module} value={value} disabled={disabled} params={f.refFilter || {}}
          onChange={(opt) => { onChange(opt); if (opt && f.fill && onFill) onFill(f.fill, opt.data || {}); }}
        />
      );
    case 'file':
      return <FileInput value={value} onChange={onChange} disabled={disabled} camera={f.name === 'photo'} />;
    case 'tags': return <input type="text" placeholder="comma, separated" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
    default: return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...common} />;
  }
}

function FileInput({ value, onChange, disabled, camera }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [cam, setCam] = useState(false);
  const send = async (file) => {
    setBusy(true);
    try { const r = await api.upload(file); onChange(r.url); } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  const pick = (e) => { const file = e.target.files?.[0]; if (file) send(file); };
  return (
    <div className="file-input">
      {value && <a href={value} target="_blank" rel="noreferrer">{/\.(png|jpe?g|webp|gif)$/i.test(value) ? <img className="thumb" src={value} alt="" /> : 'View file'}</a>}
      <input type="file" onChange={pick} disabled={disabled || busy} />
      {camera && <button type="button" className="btn sm" disabled={disabled || busy} onClick={() => setCam(true)}>📷 Camera</button>}
      {cam && <Webcam onClose={() => setCam(false)} onCapture={(file) => { setCam(false); send(file); }} />}
      {value && <button type="button" className="btn sm" onClick={() => onChange('')}>Remove</button>}
      {busy && <span className="muted">Uploading…</span>}
    </div>
  );
}

function ItemsEditor({ f, rows, onChange, currency, scan }) {
  const toast = useToast();
  // Keep the latest rows in a ref so two updates in the same event (select a medicine, then auto-fill
  // its name/price) build on each other instead of the second overwriting the first.
  const latest = useRef(rows);
  latest.current = rows;
  const commit = (next) => { latest.current = next; onChange(next); };
  const setCell = (i, name, v) => commit(latest.current.map((r, idx) => (idx === i ? { ...r, [name]: v } : r)));
  const fillRow = (i, map, data) => commit(latest.current.map((r, idx) => {
    if (idx !== i) return r;
    const next = { ...r };
    for (const [target, src] of Object.entries(map)) if (data[src] !== undefined) next[target] = data[src];
    return next;
  }));
  const visible = f.fields.filter((sf) => sf.form !== false);
  // Pharmacy POS: a scanned barcode adds the medicine (or +1 qty when it is already in the list)
  const onScan = async (code) => {
    try {
      const r = await api.get('/api/x/lookup', { code });
      if (r.module !== 'medicines' || !r.record) { toast(`${code}: not a medicine`, 'err'); return; }
      const med = r.record;
      const cur = latest.current;
      const at = cur.findIndex((x) => x.medicine?.value === med._id);
      if (at >= 0) commit(cur.map((x, i) => (i === at ? { ...x, quantity: (Number(x.quantity) || 0) + 1 } : x)));
      else {
        const row = { ...blankRow(f), medicine: { value: med._id, label: med.name }, medicineName: med.name, unitPrice: med.price, quantity: 1 };
        const blank = cur.length === 1 && !cur[0].medicine ? [] : cur;
        commit([...blank, row]);
      }
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="items-editor">
      {scan && <ScanBox onCode={onScan} />}
      <div className="table-wrap">
        <table className="items-table">
          <thead><tr>{visible.map((sf) => <th key={sf.name}>{sf.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {visible.map((sf) => (
                  <td key={sf.name} className={sf.type === 'ref' ? 'wide-cell' : ''}>
                    {sf.computed
                      ? <b>{fmtMoney(evalComputed(sf.computed, row), currency)}</b>
                      : <FieldInput f={sf} value={row[sf.name]} onChange={(v) => setCell(i, sf.name, v)} onFill={(map, data) => fillRow(i, map, data)} />}
                  </td>
                ))}
                <td><button type="button" className="icon-btn" title="Remove row" onClick={() => commit(latest.current.filter((_, idx) => idx !== i))}>🗑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn sm" onClick={() => commit([...latest.current, blankRow(f)])}>＋ Add row</button>
    </div>
  );
}

// Time-slot picker for appointments: shows the doctor's free slots for the chosen date.
function SlotPicker({ doctorId, date, time, onPick }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!doctorId || !date) { setData(null); return undefined; }
    let alive = true;
    api.get('/api/x/slots', { doctor: doctorId, date }).then((r) => { if (alive) { setData(r); setErr(''); } }).catch((e) => { if (alive) { setErr(e.message); setData(null); } });
    return () => { alive = false; };
  }, [doctorId, date]);
  if (!doctorId || !date) return <p className="muted small">Choose a doctor and date to see available slots.</p>;
  if (err) return <p className="error-text">{err}</p>;
  if (!data) return <p className="muted small">Loading slots…</p>;
  if (!data.slots.length) return <p className="error-text">{data.message || 'No slots available on this day'}</p>;
  return (
    <div className="slots">
      {data.slots.map((s) => (
        <button type="button" key={s.time} disabled={!s.available && s.time !== time} title={s.bookedBy ? `Booked: ${s.bookedBy}` : s.past ? 'Past' : 'Free'}
          className={`slot ${s.time === time ? 'on' : ''} ${s.available ? '' : 'taken'}`} onClick={() => onPick(s.time)}>{s.time}</button>
      ))}
    </div>
  );
}

// Create / edit form for any module.
export default function RecordForm({ cfg, record, preset, onClose, onSaved }) {
  const { byKey, settings } = useApp();
  const { t } = useLang();
  const toast = useToast();
  const [values, setValues] = useState(() => initialValues(byKey, cfg, record, preset));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fields = useMemo(() => cfg.fields.filter((f) => f.form !== false), [cfg]);
  const set = (name, v) => setValues((x) => ({ ...x, [name]: v }));
  const fill = (map, data) => setValues((x) => {
    const next = { ...x };
    for (const [target, src] of Object.entries(map)) if (data[src] !== undefined && (next[target] === '' || next[target] === undefined || next[target] === null || Number(next[target]) === 0)) next[target] = data[src];
    return next;
  });

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const body = serialize(cfg, values);
      const saved = record ? await mod.update(cfg.key, record._id, body) : await mod.create(cfg.key, body);
      toast(record ? 'Changes saved' : `${cfg.label.replace(/s$/, '')} created`);
      onSaved(saved);
    } catch (err) { setError(err.message); }
    setSaving(false);
  };

  const isAppt = cfg.key === 'appointments';
  const isRx = cfg.key === 'prescriptions';
  return (
    <Modal wide title={`${record ? 'Edit' : 'New'} ${cfg.label.replace(/ \(.*\)/, '').replace(/s$/, '')}`} onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" form="record-form" disabled={saving} title="Ctrl + Enter">{saving ? `${t('Saving')}…` : t('Save')}</button></>}>
      <form id="record-form" onSubmit={submit} className="form-grid" onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.currentTarget.requestSubmit(); } }}>
        {error && <div className="alert err full">{error}</div>}
        {isRx && !record && <RxTemplateBar cfg={cfg} byKey={byKey} values={values} setValues={setValues} />}
        {isRx && <RxWarnings values={values} />}
        {fields.map((f) => {
          const full = ['textarea', 'items', 'multiselect', 'file'].includes(f.type);
          return (
            <div key={f.name} className={`field ${full ? 'full' : ''}`}>
              <label htmlFor={`f_${f.name}`}>{t(f.label)}{f.required && <b className="req"> *</b>}</label>
              {f.type === 'items'
                ? <ItemsEditor f={f} rows={values[f.name] || []} onChange={(v) => set(f.name, v)} currency={settings.currency} scan={cfg.key === 'pharmacySales'} />
                : <FieldInput f={f} value={values[f.name]} onChange={(v) => set(f.name, v)} onFill={fill} />}
              {isAppt && f.name === 'time' && (
                <SlotPicker doctorId={values.doctor?.value} date={values.date} time={values.time} onPick={(t) => set('time', t)} />
              )}
            </div>
          );
        })}
      </form>
    </Modal>
  );
}