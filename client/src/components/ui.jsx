import { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { mod } from '../api.js';
import { toneOf } from '../lib.js';

// ───────── toasts ─────────
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'err' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// ───────── basic pieces ─────────
export const Badge = ({ value }) => (value ? <span className={`badge ${toneOf(value)}`}>{value}</span> : null);
export const Spinner = () => <div className="spinner" aria-label="Loading" />;
export const Empty = ({ children = 'Nothing here yet' }) => <div className="empty">{children}</div>;

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head"><h3>{title}</h3><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ message, onYes, onNo, danger }) {
  return (
    <Modal title="Please confirm" onClose={onNo} footer={<><button className="btn" onClick={onNo}>No</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onYes}>Yes, continue</button></>}>
      <p>{message}</p>
    </Modal>
  );
}

export function Pagination({ page, pages, total, onPage }) {
  return (
    <div className="pagination">
      <span className="muted">{total} record{total === 1 ? '' : 's'}</span>
      <div>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(1)}>«</button>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span className="page-label">Page {page} / {pages}</span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(pages)}>»</button>
      </div>
    </div>
  );
}

// ───────── async select for reference fields ─────────
export function AsyncSelect({ module, value, onChange, params = {}, placeholder = 'Search…', disabled }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState([]);
  const [loading, setLoading] = useState(false);
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  const paramsKey = JSON.stringify(params);

  // The menu is position:fixed so parents with overflow (item tables, modals) cannot clip it.
  useEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = box.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const h = 250;
      setPos(below < h && r.top > below ? { left: r.left, width: Math.max(r.width, 240), top: 'auto', bottom: window.innerHeight - r.top + 4 } : { left: r.left, width: Math.max(r.width, 240), top: r.bottom + 4 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      try { const r = await mod.options(module, { ...params, q, limit: 30 }); if (alive) setOpts(r); } catch { if (alive) setOpts([]); }
      if (alive) setLoading(false);
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, module, paramsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="async-select" ref={box}>
      {!open && (
        <div className={`as-display ${disabled ? 'disabled' : ''}`} onClick={() => !disabled && setOpen(true)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && !disabled && setOpen(true)}>
          {value ? <span>{value.label}</span> : <span className="muted">{placeholder}</span>}
          {value && !disabled && <button type="button" className="as-clear" onClick={(e) => { e.stopPropagation(); onChange(null); }} aria-label="Clear">✕</button>}
        </div>
      )}
      {open && (
        <>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
          <div className="as-menu" style={pos ? { position: 'fixed', ...pos } : undefined}>
            {loading && <div className="as-item muted">Searching…</div>}
            {!loading && !opts.length && <div className="as-item muted">No matches</div>}
            {opts.map((o) => (
              <div key={o.value} className="as-item" onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); setQ(''); }}>{o.label}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ───────── tiny SVG charts (no external library) ─────────
const PALETTE = ['#0e7c86', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#10b981', '#ec4899', '#64748b'];

export function BarChart({ data = [], height = 160, color = PALETTE[0], format = (v) => v }) {
  if (!data.length) return <Empty>No data</Empty>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="bar-col" title={`${d.label}: ${format(d.value)}`}>
          <div className="bar-val">{d.value ? format(d.value) : ''}</div>
          <div className="bar" style={{ height: `${Math.max(2, (d.value / max) * (height - 46))}px`, background: color }} />
          <div className="bar-label">{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export function LineChart({ data = [], height = 170, color = PALETTE[0], format = (v) => v }) {
  if (!data.length) return <Empty>No data</Empty>;
  const w = 600; const h = height; const pad = 26;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i) => pad + (data.length === 1 ? (w - 2 * pad) / 2 : (i * (w - 2 * pad)) / (data.length - 1));
  const y = (v) => h - pad - (v / max) * (h - 2 * pad);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const step = Math.ceil(data.length / 8);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="line-chart" role="img">
      {[0, 0.5, 1].map((t) => <line key={t} x1={pad} x2={w - pad} y1={h - pad - t * (h - 2 * pad)} y2={h - pad - t * (h - 2 * pad)} className="grid" />)}
      <polyline fill="none" stroke={color} strokeWidth="2.5" points={pts} strokeLinejoin="round" />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(d.value)} r="3.5" fill={color}><title>{`${d.label}: ${format(d.value)}`}</title></circle>)}
      {data.map((d, i) => (i % step === 0 ? <text key={`t${i}`} x={x(i)} y={h - 8} textAnchor="middle" className="axis">{d.label}</text> : null))}
      <text x={pad} y={14} className="axis">{format(max)}</text>
    </svg>
  );
}

export function DonutChart({ data = [], size = 150 }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <Empty>No data</Empty>;
  const r = 52; const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox="0 0 140 140" role="img">
        <g transform="rotate(-90 70 70)">
          {data.map((d, i) => {
            const len = (d.value / total) * c;
            const el = <circle key={i} cx="70" cy="70" r={r} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc}><title>{`${d.label}: ${d.value}`}</title></circle>;
            acc += len;
            return el;
          })}
        </g>
        <text x="70" y="75" textAnchor="middle" className="donut-total">{total}</text>
      </svg>
      <ul className="legend">{data.map((d, i) => <li key={i}><i style={{ background: PALETTE[i % PALETTE.length] }} />{d.label} <b>{d.value}</b></li>)}</ul>
    </div>
  );
}

export function Chart({ def, format }) {
  const T = def.type === 'donut' ? DonutChart : def.type === 'line' ? LineChart : BarChart;
  return <div className="card"><h4>{def.title}</h4><T data={def.data} format={format} /></div>;
}