import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { useToast } from '../components/ui.jsx';
import { humanize } from '../lib.js';

export default function Settings() {
  const { settings, setSettings, user } = useApp();
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  if (user.role !== 'admin') return <div className="page"><div className="alert err">Only administrators can change settings.</div></div>;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { setSettings(await api.put('/api/x/settings', form)); toast('Settings saved'); } catch (err) { toast(err.message, 'err'); }
    setBusy(false);
  };
  const backup = () => api.download('/api/x/backup', {}, `medidesk-backup-${new Date().toISOString().slice(0, 10)}.json`).catch((e) => toast(e.message, 'err'));
  const keys = Object.keys(form);

  return (
    <div className="page">
      <div className="page-head"><div><h1>⚙️ Settings</h1><p className="muted">Clinic details, billing defaults and alert thresholds</p></div></div>
      <form className="card form-grid" onSubmit={save}>
        {keys.map((k) => (
          <div className="field" key={k}>
            <label>{humanize(k)}</label>
            <input type={typeof form[k] === 'number' ? 'number' : 'text'} step="any" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: typeof settings[k] === 'number' ? e.target.value : e.target.value })} />
          </div>
        ))}
        <div className="full"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
      </form>
      <div className="card">
        <h4>Backup</h4>
        <p className="muted">Download every collection as one JSON file (users' passwords are included as hashes — keep it safe).</p>
        <button className="btn" onClick={backup}>⬇ Download full backup</button>
      </div>
    </div>
  );
}
