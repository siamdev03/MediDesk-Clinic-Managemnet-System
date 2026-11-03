// Features 10 & 11, shown inside the Prescription form:
//  • load / save prescription templates
//  • live drug-interaction and allergy warnings from /api/x/rx-check
import { useEffect, useState } from 'react';
import { api, mod } from '../api.js';
import { AsyncSelect, useToast } from './ui.jsx';
import { initialValues, serialize } from '../lib.js';

export function RxTemplateBar({ cfg, byKey, values, setValues }) {
  const toast = useToast();
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async (opt) => {
    setPicked(opt);
    if (!opt) return;
    try {
      const tpl = await mod.get('rxTemplates', opt.value);
      // reuse the form's own record→values conversion so medicine pickers show their names
      const conv = initialValues(byKey, cfg, { items: tpl.items, advice: tpl.advice, diagnosis: tpl.diagnosis });
      setValues((v) => ({ ...v, items: conv.items?.length ? conv.items : v.items, advice: v.advice || conv.advice || '', diagnosis: v.diagnosis || conv.diagnosis || '' }));
      toast(`Template “${tpl.name}” loaded`);
    } catch (e) { toast(e.message, 'err'); }
    setPicked(null);
  };
  const save = async () => {
    const n = name.trim();
    if (!n) return toast('Type a template name first', 'err');
    const body = serialize(cfg, values);
    const items = (body.items || []).filter((r) => r.medicineName || r.medicine);
    if (!items.length) return toast('Add at least one medicine first', 'err');
    setSaving(true);
    try {
      await mod.create('rxTemplates', { name: n, diagnosis: body.diagnosis, advice: body.advice, items });
      toast('Template saved'); setName('');
    } catch (e) { toast(e.message, 'err'); }
    setSaving(false);
    return null;
  };
  return (
    <div className="rx-bar full">
      <div className="rx-load"><b>📋 Template</b><AsyncSelect module="rxTemplates" value={picked} onChange={load} placeholder="Load a saved template…" /></div>
      <div className="rx-save"><input placeholder="Save these medicines as template…" value={name} onChange={(e) => setName(e.target.value)} /><button type="button" className="btn sm" onClick={save} disabled={saving}>Save template</button></div>
    </div>
  );
}

export function RxWarnings({ values }) {
  const [warnings, setWarnings] = useState([]);
  const patientId = values.patient?.value;
  const sig = JSON.stringify([patientId, (values.items || []).map((r) => [r.medicine?.value, r.medicineName])]);
  useEffect(() => {
    const items = (values.items || []).filter((r) => r.medicine?.value || r.medicineName).map((r) => ({ medicine: r.medicine?.value, medicineName: r.medicineName }));
    if (!items.length) { setWarnings([]); return undefined; }
    let alive = true;
    const t = setTimeout(() => api.post('/api/x/rx-check', { patientId, items }).then((r) => alive && setWarnings(r.warnings)).catch(() => {}), 400);
    return () => { alive = false; clearTimeout(t); };
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!warnings.length) return null;
  return (
    <div className="rx-warnings full">
      <b>⚠ Safety check ({warnings.length})</b>
      <ul>{warnings.map((w, i) => <li key={i} className={`w-${w.severity}`}><span className="w-type">{w.type}</span> {w.message}</li>)}</ul>
      <small className="muted">Advisory only – based on a small built-in table. The prescribing doctor decides.</small>
    </div>
  );
}