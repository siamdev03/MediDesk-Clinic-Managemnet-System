import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { Chart, Empty, Spinner } from '../components/ui.jsx';
import { fmtMoney, todayStr } from '../lib.js';

export default function Reports() {
  const { settings } = useApp();
  const cur = settings.currency;
  const [list, setList] = useState([]);
  const [key, setKey] = useState('');
  const [from, setFrom] = useState(`${todayStr().slice(0, 7)}-01`);
  const [to, setTo] = useState(todayStr());
  const [rep, setRep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.get('/api/x/reports').then((r) => { setList(r); if (r[0]) setKey(r[0].key); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (!key) return;
    setLoading(true); setErr('');
    api.get(`/api/x/reports/${key}`, { from, to }).then(setRep).catch((e) => { setErr(e.message); setRep(null); }).finally(() => setLoading(false));
  }, [key, from, to]);

  const fmt = (v, type) => (type === 'money' ? fmtMoney(v, cur) : type === 'percent' ? `${v}%` : type === 'number' ? Number(v).toLocaleString() : v);
  const csv = (t) => {
    const lines = [t.columns.map((c) => c.label).join(','), ...t.rows.map((r) => t.columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv' }));
    a.download = `${key}-${t.title.replace(/\W+/g, '-')}.csv`;
    a.click();
  };

  return (
    <div className="page">
      <div className="page-head no-print"><div><h1>📈 Reports</h1><p className="muted">Pick a report and a date range</p></div><button className="btn" onClick={() => window.print()}>🖨 Print</button></div>
      <div className="card toolbar no-print">
        <select value={key} onChange={(e) => setKey(e.target.value)}>{list.map((r) => <option key={r.key} value={r.key}>{r.icon} {r.label}</option>)}</select>
        <label className="inline">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {err && <div className="alert err">{err}</div>}
      {loading && <Spinner />}
      {rep && !loading && (
        <>
          <h2 className="report-title">{rep.title} <small className="muted">{rep.from} → {rep.to}</small></h2>
          <div className="stats">{rep.cards?.map((c, i) => <div key={i} className={`stat ${c.tone || ''}`}><div><div className="stat-value">{fmt(c.value, c.type)}</div><div className="stat-label">{c.label}</div></div></div>)}</div>
          <div className="grid-2">{rep.charts?.map((c, i) => <Chart key={i} def={c} format={c.title?.match(/revenue|sales|Revenue|expense/i) ? (v) => fmtMoney(v, cur) : undefined} />)}</div>
          {rep.tables?.map((t, i) => (
            <div className="card" key={i}>
              <div className="card-head"><h4>{t.title}</h4><button className="btn sm no-print" onClick={() => csv(t)}>⬇ CSV</button></div>
              {!t.rows.length ? <Empty>No data in this period</Empty> : (
                <div className="table-wrap"><table className="data-table"><thead><tr>{t.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                  <tbody>{t.rows.map((r, j) => <tr key={j}>{t.columns.map((c) => <td key={c.key}>{fmt(r[c.key], c.type) ?? '—'}</td>)}</tr>)}</tbody></table></div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
