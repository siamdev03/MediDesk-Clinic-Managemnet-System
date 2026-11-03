import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, authUrl, mod } from '../api.js';
import { useApp } from '../App.jsx';
import { AsyncSelect, Badge, Confirm, Empty, Modal, Pagination, Spinner, useToast } from '../components/ui.jsx';
import { ItemsTable, Value } from '../components/Cell.jsx';
import RecordForm from '../components/RecordForm.jsx';
import ActionDialog from '../components/ActionDialog.jsx';
import { fmtDateTime, labelOf } from '../lib.js';
import { useLiveTick } from '../realtime.js';
import { useLang } from '../i18n.jsx';

const PASS_THROUGH = ['lowStock', 'expiring', 'expired'];
const NO_PRINT = ['auditLogs', 'stockMovements', 'errorLogs', 'messageLogs', 'onlinePayments']; // log-style modules: no print column
const PDF_KEYS = ['invoices', 'prescriptions', 'labOrders']; // modules that have a PDF

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') inQ = false; else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.replace(/^﻿/, '').trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

function ImportDialog({ cfg, onClose, onDone }) {
  const [rows, setRows] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fields = cfg.fields.filter((f) => f.form !== false && !['items', 'file', 'password'].includes(f.type));
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRows(parseCsv(await file.text()));
  };
  const run = async () => {
    setBusy(true); setErr('');
    try { setResult(await api.post(`/api/m/${cfg.key}/import`, { rows })); onDone(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Import ${cfg.label} from CSV`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={!rows.length || busy} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length} row(s)`}</button></>}>
      <p className="muted small">The first row must contain column headings matching these field names or labels:</p>
      <p className="small"><code>{fields.map((f) => f.label).join(', ')}</code></p>
      <p className="muted small">For reference columns (e.g. Doctor) use the record code or exact name. Max 500 rows.</p>
      <input type="file" accept=".csv,text/csv" onChange={onFile} />
      {err && <div className="alert err">{err}</div>}
      {result && (
        <div className="alert ok">
          Created {result.created} record(s). {result.failed.length > 0 && <>Failed: {result.failed.length}<ul>{result.failed.slice(0, 10).map((f) => <li key={f.row}>Row {f.row}: {f.error}</li>)}</ul></>}
        </div>
      )}
    </Modal>
  );
}

function Detail({ cfg, rec, onClose, onEdit, onDelete, onRestore, onAction, trash }) {
  const { byKey, settings } = useApp();
  const nav = useNavigate();
  const visible = (a) => !a.when || (a.when.empty ? [undefined, null, ''].includes(rec[a.when.field]) : a.when.in.includes(rec[a.when.field]));
  const scalar = cfg.fields.filter((f) => f.type !== 'items' && f.type !== 'password' && rec[f.name] !== undefined && rec[f.name] !== null && rec[f.name] !== '' && !(Array.isArray(rec[f.name]) && !rec[f.name].length));
  const lists = cfg.fields.filter((f) => f.type === 'items');
  const title = rec.code ? `${cfg.label.replace(/s$/, '')} ${rec.code}` : cfg.label.replace(/s$/, '');
  return (
    <Modal wide title={title} onClose={onClose}
      footer={(
        <>
          {cfg.key === 'patients' && <button className="btn" onClick={() => nav(`/patient/${rec._id}`)}>Open full profile</button>}
          {trash && cfg.canDelete && <button className="btn" onClick={onRestore}>♻ Restore</button>}
          {!trash && cfg.canEdit && <button className="btn" onClick={onEdit}>✎ Edit</button>}
          {!trash && cfg.canDelete && <button className="btn danger" onClick={onDelete}>🗑 Delete</button>}
        </>
      )}>
      {!trash && cfg.actions.filter(visible).length > 0 && (
        <div className="action-bar">
          {cfg.actions.filter(visible).map((a) => <button key={a.key} className={`btn sm ${a.danger ? 'danger-outline' : 'primary-outline'}`} onClick={() => onAction(a)}>{a.label}</button>)}
        </div>
      )}
      <dl className="detail-grid">
        {scalar.map((f) => (
          <div key={f.name} className={f.type === 'textarea' ? 'full' : ''}>
            <dt>{f.label}</dt>
            <dd className={f.type === 'textarea' ? 'pre' : ''}><Value f={f} v={rec[f.name]} byKey={byKey} currency={settings.currency} /></dd>
          </div>
        ))}
      </dl>
      {lists.map((f) => <div key={f.name} className="detail-items"><h4>{f.label}</h4><ItemsTable f={f} rows={rec[f.name]} byKey={byKey} currency={settings.currency} /></div>)}
      <p className="muted small meta-line">Created {fmtDateTime(rec.createdAt)} · Updated {fmtDateTime(rec.updatedAt)}</p>
    </Modal>
  );
}

function ModuleView({ cfg }) {
  const { byKey, settings } = useApp();
  const { t } = useLang();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const [state, setState] = useState(() => ({
    page: 1, q: '', filters: {}, from: sp.get('from') || '', to: sp.get('to') || '', sort: '', order: 'desc', trash: false,
    extra: Object.fromEntries(PASS_THROUGH.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)])),
  }));
  const [data, setData] = useState({ data: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null); // { record, preset }
  const [confirm, setConfirm] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const listFields = useMemo(() => cfg.fields.filter((f) => f.list && f.type !== 'password' && f.type !== 'items'), [cfg]);
  const filterFields = useMemo(() => cfg.fields.filter((f) => f.filter && f.type !== 'checkbox'), [cfg]);

  const params = useMemo(() => {
    const p = { page: state.page, limit: 15, q: state.q || undefined, from: state.from || undefined, to: state.to || undefined, sort: state.sort || undefined, order: state.order, trash: state.trash ? '1' : undefined, ...state.extra };
    Object.entries(state.filters).forEach(([k, v]) => { if (v && typeof v === 'string' && !k.endsWith('_o')) p[`f_${k}`] = v; });
    return p;
  }, [state]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setData(await mod.list(cfg.key, params)); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [cfg.key, params]);
  useEffect(() => { const t = setTimeout(load, state.q ? 250 : 0); return () => clearTimeout(t); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSelected(new Set()); }, [data]);
  // real-time: reload the list when anybody changes this module
  const liveTick = useLiveTick([cfg.key]);
  useEffect(() => { if (liveTick) load(); }, [liveTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // deep links: ?open=<id>  and  ?new=1&patient=<id>
  useEffect(() => {
    const openId = sp.get('open');
    if (openId) { mod.get(cfg.key, openId).then(setDetail).catch((e) => toast(e.message, 'err')); }
    if (sp.get('new') && cfg.canWrite) {
      (async () => {
        const preset = {};
        for (const f of cfg.fields) {
          if (f.type === 'ref' && sp.get(f.name)) {
            try { const r = await mod.get(f.module, sp.get(f.name)); preset[f.name] = { value: r._id, label: labelOf(byKey, f.module, r) || r.code }; } catch { /* ignore */ }
          }
        }
        setForm({ record: null, preset });
      })();
    }
    if (openId || sp.get('new')) setSp((p) => { const n = new URLSearchParams(p); ['open', 'new', ...cfg.fields.map((f) => f.name)].forEach((k) => n.delete(k)); return n; }, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setState((s) => ({ ...s, page: 1, ...patch }));
  const refreshAll = async (keepDetailId) => {
    await load();
    if (keepDetailId) { try { setDetail(await mod.get(cfg.key, keepDetailId)); } catch { setDetail(null); } }
  };

  const doDelete = (rec) => setConfirm({
    message: `Delete this ${cfg.label.toLowerCase().replace(/s$/, '')}? It can be restored from the trash by an administrator.`, danger: true,
    run: async () => { try { await mod.remove(cfg.key, rec._id); toast('Deleted'); setDetail(null); load(); } catch (e) { toast(e.message, 'err'); } },
  });
  const doRestore = async (rec) => { try { await mod.restore(cfg.key, rec._id); toast('Restored'); setDetail(null); load(); } catch (e) { toast(e.message, 'err'); } };

  const runAction = (rec, a) => {
    const exec = async (body) => {
      const r = await mod.action(cfg.key, rec._id, a.key, body || {});
      toast(r.message);
      setDialog(null); setConfirm(null);
      refreshAll(rec._id);
    };
    if (a.fields?.length) setDialog({ title: a.label, fields: a.fields, record: rec, confirm: a.confirm, danger: a.danger, run: exec });
    else if (a.confirm) setConfirm({ message: a.confirm, danger: a.danger, run: async () => { try { await exec(); } catch (e) { toast(e.message, 'err'); setConfirm(null); } } });
    else exec().catch((e) => toast(e.message, 'err'));
  };
  const runTool = (t) => {
    const exec = async (body) => { const r = await mod.tool(cfg.key, t.key, body || {}); toast(r.message || 'Done'); setDialog(null); load(); };
    if (t.fields?.length) setDialog({ title: t.label, fields: t.fields, run: exec });
    else exec().catch((e) => toast(e.message, 'err'));
  };

  const bulkDelete = () => setConfirm({
    message: `Delete ${selected.size} selected record(s)?`, danger: true,
    run: async () => { try { const r = await api.post(`/api/m/${cfg.key}/bulk-delete`, { ids: [...selected] }); toast(`${r.deleted} deleted${r.failed.length ? `, ${r.failed.length} failed` : ''}`, r.failed.length ? 'err' : 'ok'); load(); } catch (e) { toast(e.message, 'err'); } },
  });

  const exportCsv = () => api.download(`/api/m/${cfg.key}/export.csv`, params, `${cfg.key}.csv`).catch((e) => toast(e.message, 'err'));
  const exportXlsx = () => api.download(`/api/m/${cfg.key}/export.xlsx`, params, `${cfg.key}.xlsx`).catch((e) => toast(e.message, 'err'));
  const emailPdf = async (r) => {
    const to = window.prompt("E-mail the PDF to (leave empty to use the patient's e-mail):", '');
    if (to === null) return;
    try { const x = await api.post(`/api/x/pdf/${cfg.key}/${r._id}/email`, { to: to.trim() }); toast(x.message); } catch (e) { toast(e.message, 'err'); }
  };
  const payLink = async (r) => {
    try {
      const provs = await api.get('/api/x/pay/providers');
      const provider = provs.length > 1 ? window.prompt(`Payment provider (${provs.join(' / ')}):`, provs[provs.length - 1]) : provs[0];
      if (!provider) return;
      const x = await api.post('/api/x/pay/init', { invoiceId: r._id, amount: r.balance, provider: provider.trim() });
      try { await navigator.clipboard.writeText(x.url); toast('Payment link copied – send it to the patient'); } catch { toast('Payment link opened in a new tab'); }
      window.open(x.url, '_blank');
    } catch (e) { toast(e.message, 'err'); }
  };
  const toggleSort = (f) => setState((s) => ({ ...s, page: 1, sort: f.name, order: s.sort === f.name && s.order === 'desc' ? 'asc' : 'desc' }));
  const activeFilters = Object.entries(state.filters).filter(([k, v]) => v && typeof v === 'string' && !k.endsWith('_o')).length + (state.from ? 1 : 0) + (state.to ? 1 : 0) + Object.keys(state.extra).length;
  const canBulk = cfg.canDelete && !state.trash;

  // Print column sits right before the Status column (or at the end when the module has no status column).
  const statusIdx = listFields.findIndex((f) => f.name === 'status');
  const printAt = NO_PRINT.includes(cfg.key) ? -1 : statusIdx >= 0 ? statusIdx : listFields.length;
  const printHead = <th key="__print" className="print-col">Print</th>;
  const headCells = [];
  listFields.forEach((f, i) => {
    if (i === printAt) headCells.push(printHead);
    headCells.push(
      <th key={f.name} className={f.type === 'ref' ? '' : 'sortable'} onClick={() => f.type !== 'ref' && toggleSort(f)}>
        {t(f.label)}{state.sort === f.name ? (state.order === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>,
    );
  });
  if (printAt === listFields.length) headCells.push(printHead);
  const rowCells = (r) => {
    const cells = [];
    const printCell = (
      <td key="__print" className="print-col" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="Print" onClick={() => window.open(`/print/${cfg.key}/${r._id}`, '_blank')}>🖨</button>
        {PDF_KEYS.includes(cfg.key) && <button className="icon-btn" title="Open PDF" onClick={() => window.open(authUrl(`/api/x/pdf/${cfg.key}/${r._id}`), '_blank')}>📄</button>}
        {PDF_KEYS.includes(cfg.key) && <button className="icon-btn" title="E-mail PDF" onClick={() => emailPdf(r)}>✉</button>}
        {cfg.key === 'invoices' && r.balance > 0 && r.status !== 'Cancelled' && <button className="icon-btn" title="Online payment link" onClick={() => payLink(r)}>💳</button>}
      </td>
    );
    listFields.forEach((f, i) => {
      if (i === printAt) cells.push(printCell);
      cells.push(<td key={f.name}><Value f={f} v={r[f.name]} byKey={byKey} currency={settings.currency} /></td>);
    });
    if (printAt === listFields.length) cells.push(printCell);
    return cells;
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{cfg.icon} {t(cfg.label)}</h1><p className="muted">{data.total} record{data.total === 1 ? '' : 's'}{state.trash ? ' in trash' : ''}</p></div>
        <div className="head-actions">
          {cfg.tools.map((t) => <button key={t.key} className="btn" onClick={() => runTool(t)}>⚡ {t.label}</button>)}
          <button className="btn" onClick={exportCsv}>⬇ CSV</button>
          <button className="btn" onClick={exportXlsx}>⬇ Excel</button>
          {cfg.canWrite && !cfg.readOnly && <button className="btn" onClick={() => setImporting(true)}>⬆ Import</button>}
          {cfg.canWrite && <button className="btn primary" data-shortcut="new" title="n" onClick={() => setForm({ record: null })}>＋ {t('New')}</button>}
        </div>
      </div>

      <div className="card toolbar">
        <input className="search" placeholder={`Search ${cfg.label.toLowerCase()}…`} value={state.q} onChange={(e) => set({ q: e.target.value })} />
        {cfg.dateField && (
          <>
            <input type="date" value={state.from} onChange={(e) => set({ from: e.target.value })} title="From" />
            <input type="date" value={state.to} onChange={(e) => set({ to: e.target.value })} title="To" />
          </>
        )}
        {filterFields.length > 0 && <button className="btn" onClick={() => setShowFilters(!showFilters)}>Filters{activeFilters ? ` (${activeFilters})` : ''}</button>}
        {user_isAdmin(cfg) && <label className="check"><input type="checkbox" checked={state.trash} onChange={(e) => set({ trash: e.target.checked })} /> <span>Trash</span></label>}
        {activeFilters > 0 && <button className="btn sm" onClick={() => { set({ filters: {}, from: '', to: '', extra: {} }); }}>Clear</button>}
        {selected.size > 0 && canBulk && <button className="btn danger sm" onClick={bulkDelete}>Delete selected ({selected.size})</button>}
      </div>
      {showFilters && (
        <div className="card filter-row">
          {filterFields.map((f) => (
            <div className="field" key={f.name}>
              <label>{f.label}</label>
              {f.type === 'select' ? (
                <select value={state.filters[f.name] || ''} onChange={(e) => set({ filters: { ...state.filters, [f.name]: e.target.value } })}>
                  <option value="">All</option>{f.options.map((o) => <option key={o}>{o}</option>)}
                </select>
              ) : f.type === 'ref' ? (
                <AsyncSelect module={f.module} value={state.filters[f.name + '_o'] || null} onChange={(o) => set({ filters: { ...state.filters, [f.name]: o?.value || '', [f.name + '_o']: o } })} />
              ) : (
                <input value={state.filters[f.name] || ''} onChange={(e) => set({ filters: { ...state.filters, [f.name]: e.target.value } })} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card table-card">
        {error && <div className="alert err">{error}</div>}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {canBulk && <th className="check-col"><input type="checkbox" checked={data.data.length > 0 && selected.size === data.data.length} onChange={(e) => setSelected(e.target.checked ? new Set(data.data.map((r) => r._id)) : new Set())} /></th>}
                {cfg.prefix && <th>Code</th>}
                {headCells}
                <th />
              </tr>
            </thead>
            <tbody>
              {data.data.map((r) => (
                <tr key={r._id} onClick={() => setDetail(r)} className="clickable">
                  {canBulk && <td className="check-col" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(r._id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(r._id); else n.delete(r._id); setSelected(n); }} /></td>}
                  {cfg.prefix && <td className="mono">{r.code}</td>}
                  {rowCells(r)}
                  <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                    {!state.trash && cfg.canEdit && <button className="icon-btn" title="Edit" onClick={() => setForm({ record: r })}>✎</button>}
                    {!state.trash && cfg.canDelete && <button className="icon-btn" title="Delete" onClick={() => doDelete(r)}>🗑</button>}
                    {state.trash && cfg.canDelete && <button className="icon-btn" title="Restore" onClick={() => doRestore(r)}>♻</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="table-loading"><Spinner /></div>}
          {!loading && !data.data.length && <Empty>No {cfg.label.toLowerCase()} found</Empty>}
        </div>
        <Pagination page={data.page || 1} pages={data.pages} total={data.total} onPage={(p) => setState((s) => ({ ...s, page: p }))} />
      </div>

      {detail && (
        <Detail cfg={cfg} rec={detail} trash={state.trash} onClose={() => setDetail(null)}
          onEdit={() => { setForm({ record: detail }); setDetail(null); }} onDelete={() => doDelete(detail)} onRestore={() => doRestore(detail)}
          onAction={(a) => runAction(detail, a)} />
      )}
      {form && <RecordForm cfg={cfg} record={form.record} preset={form.preset} onClose={() => setForm(null)} onSaved={(saved) => { setForm(null); load(); if (form.record) setDetail(saved); }} />}
      {confirm && <Confirm message={confirm.message} danger={confirm.danger} onNo={() => setConfirm(null)} onYes={async () => { const c = confirm; setConfirm(null); await c.run(); }} />}
      {dialog && <ActionDialog {...dialog} onClose={() => setDialog(null)} onRun={dialog.run} />}
      {importing && <ImportDialog cfg={cfg} onClose={() => setImporting(false)} onDone={load} />}
    </div>
  );
}

// the Trash switch is for admins only (the API enforces nothing special for reading, restore is admin-only)
function user_isAdmin(cfg) { return cfg.canDelete && !cfg.readOnly; }

export default function ModulePage() {
  const { key } = useParams();
  const { byKey } = useApp();
  const cfg = byKey[key];
  if (!cfg) return <div className="page"><div className="card"><Empty>This section does not exist or you do not have access to it.</Empty> <Link to="/">Back to dashboard</Link></div></div>;
  return <ModuleView key={key} cfg={cfg} />;
}