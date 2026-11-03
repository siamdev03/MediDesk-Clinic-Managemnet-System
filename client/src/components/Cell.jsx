import { Link } from 'react-router-dom';
import { Badge } from './ui.jsx';
import { fmtDate, fmtDateTime, fmtMoney, isBadge, labelOf } from '../lib.js';

// Renders one field value (list cell or detail row).
export function Value({ f, v, byKey, currency, link = true }) {
  if (v === undefined || v === null || v === '') return <span className="muted">—</span>;
  switch (f.type) {
    case 'ref': {
      const label = labelOf(byKey, f.module, v) || (typeof v === 'object' ? v.code : '') || '—';
      if (link && f.module === 'patients' && v._id) return <Link to={`/patient/${v._id}`} onClick={(e) => e.stopPropagation()}>{label}</Link>;
      return <span>{label}</span>;
    }
    case 'date': return <span>{fmtDate(v)}</span>;
    case 'datetime': return <span>{fmtDateTime(v)}</span>;
    case 'number': return <span>{f.money ? fmtMoney(v, currency) : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>;
    case 'checkbox': return v ? <span className="badge good">Yes</span> : <span className="badge">No</span>;
    case 'multiselect':
    case 'tags': return <span className="tag-list">{(v || []).map((t) => <span key={t} className="tag">{t}</span>)}</span>;
    case 'select': return isBadge(f) ? <Badge value={v} /> : <span>{v}</span>;
    case 'url': return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{String(v).replace(/^https?:\/\//, '').slice(0, 40)}</a>;
    case 'file': return <a href={v} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open file</a>;
    case 'password': return <span>••••••</span>;
    default: return <span>{String(v)}</span>;
  }
}

export function ItemsTable({ f, rows, byKey, currency }) {
  if (!rows?.length) return <span className="muted">—</span>;
  const cols = f.fields.filter((sf) => sf.form !== false || sf.computed);
  return (
    <div className="table-wrap">
      <table className="items-table readonly">
        <thead><tr>{cols.map((c) => <th key={c.name}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r._id || i}>{cols.map((c) => <td key={c.name}><Value f={c} v={r[c.name]} byKey={byKey} currency={currency} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
