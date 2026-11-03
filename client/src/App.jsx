import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, getToken, setToken } from './api.js';
import { ToastProvider, Spinner } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ModulePage from './pages/ModulePage.jsx';
import PatientProfile from './pages/PatientProfile.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Profile from './pages/Profile.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import QueueBoard from './pages/QueueBoard.jsx';
import BedMap from './pages/BedMap.jsx';
import PrintView from './pages/PrintView.jsx';
import Finance from './pages/Finance.jsx';
import DoctorDashboard from './pages/DoctorDashboard.jsx';
import FollowUps from './pages/FollowUps.jsx';
import AdminTools from './pages/AdminTools.jsx';
import PatientCard from './pages/PatientCard.jsx';
import PublicBooking from './pages/PublicBooking.jsx';
import Portal from './pages/Portal.jsx';
import PayResult from './pages/PayResult.jsx';

// pages patients use without a staff login
const PUBLIC_PATHS = ['/book', '/portal', '/pay-result'];

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

const DEFAULT_SETTINGS = { clinicName: 'MediDesk Clinic', currency: '৳', tagline: '', address: '', phone: '', email: '', invoiceFooter: '' };

export default function App() {
  const [status, setStatus] = useState('loading'); // loading | anon | ready
  const [needsSetup, setNeedsSetup] = useState(false);
  const [user, setUser] = useState(null);
  const [modules, setModules] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const loc = useLocation();
  const isPublic = PUBLIC_PATHS.some((p) => loc.pathname === p || loc.pathname.startsWith(`${p}/`));
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('medidesk_theme') || 'light'; } catch { return 'light'; } });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('medidesk_theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const boot = useCallback(async () => {
    if (!getToken()) {
      try { const s = await api.get('/api/auth/setup-status'); setNeedsSetup(s.needsSetup); } catch { /* server down */ }
      setStatus('anon');
      return;
    }
    try {
      const [meta, st] = await Promise.all([api.get('/api/meta'), api.get('/api/x/settings')]);
      setUser(meta.user); setModules(meta.modules); setSettings({ ...DEFAULT_SETTINGS, ...st });
      setStatus('ready');
    } catch {
      setToken(null);
      setStatus('anon');
    }
  }, []);

  useEffect(() => { boot(); }, [boot]);
  useEffect(() => {
    const out = () => { setUser(null); setStatus('anon'); };
    window.addEventListener('medidesk:logout', out);
    return () => window.removeEventListener('medidesk:logout', out);
  }, []);

  const value = useMemo(() => ({
    user, modules, byKey: Object.fromEntries(modules.map((m) => [m.key, m])), settings, setSettings, theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    login: async (token) => { setToken(token); setStatus('loading'); await boot(); },
    logout: () => { setToken(null); setUser(null); setStatus('anon'); },
    setUser,
    has: (key) => modules.some((m) => m.key === key),
  }), [user, modules, settings, theme, boot]);

  if (isPublic) {
    return (
      <ToastProvider>
        <Routes>
          <Route path="/book" element={<PublicBooking />} />
          <Route path="/portal" element={<Portal />} />
          <Route path="/pay-result" element={<PayResult />} />
        </Routes>
      </ToastProvider>
    );
  }
  if (status === 'loading') return <div className="boot"><Spinner /></div>;

  return (
    <ToastProvider>
      {status === 'anon' ? (
        <Login needsSetup={needsSetup} onAuthed={async (token) => { setToken(token); setStatus('loading'); await boot(); }} />
      ) : (
        <AppCtx.Provider value={value}>
          <Routes>
            <Route path="/print/:key/:id" element={<PrintView />} />
            <Route path="/card/:id" element={<PatientCard />} />
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="m/:key" element={<ModulePage />} />
              <Route path="patient/:id" element={<PatientProfile />} />
              <Route path="calendar" element={<CalendarPage />} />
              <Route path="queue-board" element={<QueueBoard />} />
              <Route path="bed-map" element={<BedMap />} />
              <Route path="reports" element={<Reports />} />
              <Route path="finance" element={<Finance />} />
              <Route path="doctor" element={<DoctorDashboard />} />
              <Route path="follow-ups" element={<FollowUps />} />
              <Route path="admin-tools" element={<AdminTools />} />
              <Route path="settings" element={<Settings />} />
              <Route path="profile" element={<Profile />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </AppCtx.Provider>
      )}
    </ToastProvider>
  );
}