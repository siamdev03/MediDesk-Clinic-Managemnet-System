// Features 16 & 17 (+20 badge): permission editor and backups – /admin-tools (administrators only)
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Spinner, useToast } from '../components/ui.jsx';
import { fmtDateTime } from '../lib.js';

const ROLES = ['doctor', 'nurse', 'receptionist', 'pharmacist', 'labtech', 'accountant'];
const SHORT = { doctor: 'Dr', nurse: 'Nu', receptionist: 'Re', pharmacist: 'Ph', labtech: 'Lab', accountant: 'Ac' };
const same = (a = [], b = []) => JSON.stringify([...a].filter((r) => r !== 'admin').sort()) === JSON.stringify([...b].filter((r) => r !== 'admin').sort());

function Permissions() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const load = () => api.get('/api/x/permissions').then((r) => { setRows(r); setDraft(Object.fromEntries(r.map((m) => [m.key, { read: m.roles.read, write: m.roles.write, delete: m.roles.delete }]))); }).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (key, kind, role) => setDraft((d) => {
    const cur = d[key][kind];
    const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
    const o = { ...d[key], [kind]: next };
    if (kind === 'write' && next.includes(role)) o.read = [...new Set([...o.read, role])]; // writing implies reading
    if (kind === 'read' && !next.includes(role)) { o.write = o.write.filter((r) => r !== role); o.delete = o.delete.filter((r) => r !== role); }
    return { ...d, [key]: o };
  });
  const changed = useMemo(() => (rows || []).filter((m) => ['read', 'write', 'delete'].some((k) => !same(draft[m.key]?.[k], m.defaults[k]))), [rows, draft]);
  const save = async () => {
    setBusy(true);
    try { setRows(await api.put('/api/x/permissions', { permissions: Object.fromEntries(changed.map((m) => [m.key, draft[m.key]])) })); toast('Permissions saved – users get them on their next page load'); load(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  if (!rows) return <Spinner />;
  const groups = [...new Set(rows.map((m) => m.group))];
  return (
    <div className="card">
      <div className="toolbar"><input className="search" placeholder="Filter modules…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn primary" disabled={busy || !changed.length} onClick={save}>{busy ? 'Saving…' : `Save ${changed.length ? `(${changed.length} changed)` : ''}`}</button>
        <button className="btn" disabled={!changed.length} onClick={load}>Discard</button></div>
      <p className="muted small">Administrators always have full access. <b>R</b> = can see, <b>W</b> = can add/edit, <b>D</b> = can delete. Special rules inside a workflow (for example “only a pharmacist may refund a sale”) stay in force.</p>
      <div className="table-wrap"><table className="perm-table"><thead><tr><th>Module</th>{['Read', 'Write', 'Delete'].map((k) => <th key={k} colSpan={ROLES.length}>{k}</th>)}</tr>
        <tr><th />{['read', 'write', 'delete'].flatMap((k) => ROLES.map((r) => <th key={k + r} title={r} className="sub">{SHORT[r]}</th>))}</tr></thead>
        <tbody>{groups.map((g) => (
          <FragmentRows key={g} g={g} rows={rows.filter((m) => m.group === g && m.label.toLowerCase().includes(q.toLowerCase()))} draft={draft} toggle={toggle} changed={changed} />))}</tbody></table></div>
    </div>
  );
}
function FragmentRows({ g, rows, draft, toggle, changed }) {
  if (!rows.length) return null;
  return (
    <>
      <tr className="grp"><td colSpan={1 + 3 * ROLES.length}>{g}</td></tr>
      {rows.map((m) => (
        <tr key={m.key} className={changed.includes(m) ? 'dirty' : ''}>
          <td>{m.label}{m.readOnly && <small className="muted"> (read-only module)</small>}</td>
          {['read', 'write', 'delete'].flatMap((k) => ROLES.map((r) => (
            <td key={k + r} className="c"><input type="checkbox" disabled={m.readOnly && k !== 'read'} checked={!!draft[m.key]?.[k]?.includes(r)} onChange={() => toggle(m.key, k, r)} /></td>)))}
        </tr>))}
    </>
  );
}

function Backups() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.get('/api/x/backups').then(setList).catch((e) => toast(e.message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const make = async () => { setBusy(true); try { const b = await api.post('/api/x/backups'); toast(`Backup created: ${b.name}`); load(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <div className="card">
      <div className="toolbar"><button className="btn primary" disabled={busy} onClick={make}>{busy ? 'Working…' : '💾 Back up now'}</button></div>
      <p className="muted small">The server also backs up automatically once a day (default 2 AM) and keeps the newest 7 files in <code>server/backups</code>. Copy that folder somewhere safe – a backup on the same disk does not protect you from a dead disk.</p>
      {!list ? <Spinner /> : !list.length ? <p className="muted">No backups yet.</p> : (
        <table className="plain"><thead><tr><th>File</th><th>Created</th><th className="num">Size</th><th /></tr></thead>
          <tbody>{list.map((b) => <tr key={b.name}><td className="mono small">{b.name}</td><td>{fmtDateTime(b.createdAt)}</td><td className="num">{(b.size / 1024).toFixed(0)} KB</td>
            <td><button className="btn sm" onClick={() => api.download(`/api/x/backups/${b.name}`, {}, b.name).catch((e) => toast(e.message, 'err'))}>⬇ Download</button></td></tr>)}</tbody></table>
      )}
      <details className="how"><summary>How to restore</summary><ol className="small"><li>Stop the API (Ctrl+C).</li><li>In <code>server</code> run: <code>npm run restore -- backups/&lt;file&gt;.json.gz</code></li><li>Start the API again. ⚠ Restoring replaces <b>all</b> current data.</li></ol></details>
    </div>
  );
}

export default function AdminTools() {
  const { user } = useApp();
  const [tab, setTab] = useState('perm');
  if (user.role !== 'admin') return <div className="page"><div className="alert err">Only administrators can open this page.</div></div>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>🛠️ Admin tools</h1><p className="muted">Permissions and backups · <Link to="/m/errorLogs">Error log</Link> · <Link to="/m/messageLogs">Message log</Link> · <Link to="/m/branches">Branches</Link> · <Link to="/profile">Two-factor login</Link></p></div></div>
      <div className="tabs">{[['perm', '🔑 Permissions'], ['backup', '💾 Backups']].map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'perm' ? <Permissions /> : <Backups />}
    </div>
  );
}