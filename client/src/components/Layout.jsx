import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api, getBranch, setBranch } from '../api.js';
import { useApp } from '../App.jsx';
import { useLang } from '../i18n.jsx';
import { startRealtime, stopRealtime, useLiveTick } from '../realtime.js';
import { Modal } from './ui.jsx';

const ROLE_LABEL = { admin: 'Administrator', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Receptionist', pharmacist: 'Pharmacist', labtech: 'Lab technician', accountant: 'Accountant' };

// Feature 22: keyboard shortcuts  (g then a letter = go to…)
const GO = {
  d: ['/', 'Dashboard'], p: ['/m/patients', 'Patients'], a: ['/m/appointments', 'Appointments'], c: ['/calendar', 'Appointment Calendar'], q: ['/queue-board', 'Live OPD Queue'],
  i: ['/m/invoices', 'Invoices'], m: ['/m/medicines', 'Medicines'], s: ['/m/pharmacySales', 'Pharmacy Sales'], l: ['/m/labOrders', 'Lab Orders'], r: ['/reports', 'Reports'],
  f: ['/follow-ups', 'Follow-ups'], b: ['/bed-map', 'Bed Map'], x: ['/finance', 'Finance'],
};
const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

function useShortcuts(nav, openHelp) {
  useEffect(() => {
    let pending = null;
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing() || document.querySelector('.modal')) return;
      const k = e.key.toLowerCase();
      if (pending) { clearTimeout(pending); pending = null; if (GO[k]) { e.preventDefault(); nav(GO[k][0]); } return; }
      if (k === 'g') { pending = setTimeout(() => { pending = null; }, 1200); return; }
      if (k === 'n') { const b = document.querySelector('[data-shortcut="new"]'); if (b) { e.preventDefault(); b.click(); } return; }
      if (e.key === '?') { e.preventDefault(); openHelp(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nav, openHelp]);
}

function ShortcutHelp({ onClose }) {
  const { t } = useLang();
  return (
    <Modal title={`⌨️ ${t('Keyboard shortcuts')}`} onClose={onClose}>
      <table className="plain"><tbody>
        <tr><td><kbd>/</kbd></td><td>Search everything</td></tr>
        <tr><td><kbd>n</kbd></td><td>New record on the current list</td></tr>
        <tr><td><kbd>Ctrl</kbd> + <kbd>Enter</kbd></td><td>Save the open form</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close a window</td></tr>
        <tr><td><kbd>?</kbd></td><td>This help</td></tr>
        {Object.entries(GO).map(([k, [, label]]) => <tr key={k}><td><kbd>g</kbd> then <kbd>{k}</kbd></td><td>Go to {t(label)}</td></tr>)}
      </tbody></table>
    </Modal>
  );
}

function GlobalSearch() {
  const { t } = useLang();
  const [q, setQ] = useState('');
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    if (q.trim().length < 2) { setGroups([]); return undefined; }
    let alive = true;
    const t2 = setTimeout(() => api.get('/api/x/search', { q }).then((r) => alive && setGroups(r)).catch(() => {}), 250);
    return () => { alive = false; clearTimeout(t2); };
  }, [q]);
  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const slash = (e) => { if (e.key === '/' && !typing()) { e.preventDefault(); input.current?.focus(); } };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', slash);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', slash); };
  }, []);

  const go = (g, r) => { setOpen(false); setQ(''); nav(g.key === 'patients' ? `/patient/${r._id}` : `/m/${g.key}?open=${r._id}`); };
  // Enter on an exact code / barcode (e.g. from a QR or barcode scanner) jumps straight to the record
  const enter = async (e) => {
    if (e.key !== 'Enter' || !q.trim()) return;
    try { const r = await api.get('/api/x/lookup', { code: q.trim() }); setOpen(false); setQ(''); nav(r.link); } catch { /* fall back to the list below */ }
  };
  return (
    <div className="gsearch" ref={box}>
      <input ref={input} value={q} onKeyDown={enter} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder={t('Search patients, doctors, invoices…  ( / )')} />
      {open && q.trim().length >= 2 && (
        <div className="gsearch-menu">
          {!groups.length && <div className="as-item muted">No results</div>}
          {groups.map((g) => (
            <div key={g.key}>
              <div className="gs-group">{g.icon} {t(g.label)}</div>
              {g.results.map((r) => <div key={r._id} className="as-item" onMouseDown={() => go(g, r)}><b>{r.title}</b> <span className="muted small">{r.sub}</span></div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Bell({ errorCount }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const box = useRef(null);
  const tick = useLiveTick(['medicines', 'invoices', 'appointments', 'labOrders', 'bloodBank']);
  useEffect(() => { api.get('/api/x/notifications').then(setItems).catch(() => {}); }, [tick]);
  useEffect(() => {
    const t = setInterval(() => api.get('/api/x/notifications').then(setItems).catch(() => {}), 120000);
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => { clearInterval(t); document.removeEventListener('mousedown', close); };
  }, []);
  const all = [...(errorCount > 0 ? [{ severity: 'bad', title: `${errorCount} open error${errorCount === 1 ? '' : 's'} in the Error Log`, link: '/m/errorLogs' }] : []), ...items];
  return (
    <div className="bell" ref={box}>
      <button className="icon-btn" onClick={() => setOpen(!open)} aria-label="Notifications">🔔{all.length > 0 && <span className="dot">{all.length}</span>}</button>
      {open && (
        <div className="bell-menu">
          <div className="gs-group">Alerts</div>
          {!all.length && <div className="as-item muted">All clear 🎉</div>}
          {all.map((n, i) => <div key={i} className={`as-item alert-${n.severity}`} onClick={() => { setOpen(false); nav(n.link); }}>{n.title}</div>)}
        </div>
      )}
    </div>
  );
}

function BranchPicker({ user }) {
  const { t } = useLang();
  const [list, setList] = useState([]);
  useEffect(() => { api.get('/api/x/branches').then(setList).catch(() => {}); }, []);
  if (!list.length) return null;
  const locked = user.role !== 'admin' && user.branch;
  const cur = locked ? String(user.branch) : getBranch();
  return (
    <select className="branch-pick" title={t('Branch')} value={cur} disabled={!!locked}
      onChange={(e) => { setBranch(e.target.value); window.location.reload(); }}>
      {!locked && <option value="">🏢 {t('All branches')}</option>}
      {list.map((b) => <option key={b._id} value={b._id}>🏢 {b.name}</option>)}
    </select>
  );
}

export default function Layout() {
  const { user, modules, settings, theme, toggleTheme, logout } = useApp();
  const { t, lang, setLang } = useLang();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [errorCount, setErrorCount] = useState(0);
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => { setNavOpen(false); setMenu(false); }, [loc.pathname, loc.search]);
  useShortcuts(nav, () => setHelp(true));

  useEffect(() => {
    startRealtime();
    const up = () => setOnline(true); const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { stopRealtime(); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  const errTick = useLiveTick(['errorLogs']);
  useEffect(() => { if (user.role === 'admin') api.get('/api/x/error-count').then((r) => setErrorCount(r.open)).catch(() => {}); }, [user.role, errTick]);

  const groups = useMemo(() => {
    const g = [];
    modules.forEach((m) => {
      let grp = g.find((x) => x.name === m.group);
      if (!grp) { grp = { name: m.group, items: [] }; g.push(grp); }
      grp.items.push(m);
    });
    return g;
  }, [modules]);
  const has = (k) => modules.some((m) => m.key === k);
  const isDoc = user.role === 'doctor' || user.role === 'admin';
  const money = user.role === 'admin' || user.role === 'accountant';

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand" onClick={() => nav('/')}><span>🏥</span><div><b>MediDesk</b><small>{settings.clinicName}</small></div></div>
        <nav>
          <NavLink to="/" end className="nav-link">🏠 {t('Dashboard')}</NavLink>
          {isDoc && has('appointments') && <NavLink to="/doctor" className="nav-link">🩺 {t('Doctor Dashboard')}</NavLink>}
          {has('appointments') && <NavLink to="/calendar" className="nav-link">🗓️ {t('Appointment Calendar')}</NavLink>}
          {has('queue') && <NavLink to="/queue-board" className="nav-link">📺 {t('Live OPD Queue')}</NavLink>}
          {has('consultations') && ['admin', 'doctor', 'nurse', 'receptionist'].includes(user.role) && <NavLink to="/follow-ups" className="nav-link">🔁 {t('Follow-ups')}</NavLink>}
          {has('beds') && <NavLink to="/bed-map" className="nav-link">🛏️ {t('Bed Map')}</NavLink>}
          {money && <NavLink to="/finance" className="nav-link">💼 {t('Finance')}</NavLink>}
          <NavLink to="/reports" className="nav-link">📈 {t('Reports')}</NavLink>
          {groups.map((g) => (
            <div key={g.name} className="nav-group">
              <button className="nav-group-title" onClick={() => setCollapsed((c) => ({ ...c, [g.name]: !c[g.name] }))}>{t(g.name)}<span>{collapsed[g.name] ? '▸' : '▾'}</span></button>
              {!collapsed[g.name] && g.items.map((m) => (
                <NavLink key={m.key} to={`/m/${m.key}`} className="nav-link sub">{m.icon} {t(m.label)}{m.key === 'errorLogs' && errorCount > 0 && <span className="nav-badge">{errorCount}</span>}</NavLink>
              ))}
            </div>
          ))}
          {user.role === 'admin' && <NavLink to="/admin-tools" className="nav-link">🛠️ {t('Admin Tools')}</NavLink>}
          {user.role === 'admin' && <NavLink to="/settings" className="nav-link">⚙️ {t('Settings')}</NavLink>}
        </nav>
      </aside>
      <div className="main">
        {!online && <div className="offline-bar">⚠ You are offline – showing the last loaded screen. Changes cannot be saved until the connection returns.</div>}
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setNavOpen(!navOpen)} aria-label="Menu">☰</button>
          <GlobalSearch />
          <div className="top-actions">
            <BranchPicker user={user} />
            <Bell errorCount={errorCount} />
            <button className="icon-btn lang-btn" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')} aria-label={t('Language')} title={t('Language')}>{lang === 'bn' ? 'EN' : 'বাং'}</button>
            <button className="icon-btn" onClick={() => setHelp(true)} aria-label={t('Keyboard shortcuts')} title={`${t('Keyboard shortcuts')} (?)`}>⌨️</button>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle dark mode">{theme === 'dark' ? '☀️' : '🌙'}</button>
            <div className="user-menu">
              <button className="user-btn" onClick={() => setMenu(!menu)}><span className="avatar">{user.name?.[0]}</span><span className="user-info"><b>{user.name}</b><small>{ROLE_LABEL[user.role]}</small></span></button>
              {menu && <div className="bell-menu right">
                <div className="as-item" onClick={() => nav('/profile')}>👤 {t('My profile')}</div>
                <div className="as-item" onClick={logout}>🚪 {t('Sign out')}</div>
              </div>}
            </div>
          </div>
        </header>
        <main className="content"><Outlet /></main>
      </div>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
    </div>
  );
}