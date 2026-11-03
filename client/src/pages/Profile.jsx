import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { useToast } from '../components/ui.jsx';

// Feature 15: turn two-factor login on/off with an authenticator app (Google Authenticator, Authy, Microsoft Authenticator…)
function TwoFactor() {
  const { user, setUser } = useApp();
  const toast = useToast();
  const [setup, setSetup] = useState(null); // { qr, secret }
  const [code, setCode] = useState('');
  const [off, setOff] = useState({ password: '', code: '' });
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };

  if (user.twoFactor) {
    return (
      <form className="card form-grid one" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/api/auth/2fa/disable', off); setUser({ ...user, twoFactor: false }); setOff({ password: '', code: '' }); toast('Two-factor login turned off'); }); }}>
        <h4>Two-factor login <span className="badge good">On</span></h4>
        <p className="muted small">To turn it off, confirm your password and a current code.</p>
        <div className="field"><label>Password</label><input type="password" value={off.password} onChange={(e) => setOff({ ...off, password: e.target.value })} required /></div>
        <div className="field"><label>Code from the app</label><input inputMode="numeric" maxLength={6} value={off.code} onChange={(e) => setOff({ ...off, code: e.target.value })} required /></div>
        <div><button className="btn danger" disabled={busy}>Turn off</button></div>
      </form>
    );
  }
  return (
    <div className="card form-grid one">
      <h4>Two-factor login <span className="badge warn">Off</span></h4>
      {!setup ? (
        <>
          <p className="muted small">Adds a 6-digit code from your phone to every sign-in. Recommended for administrators and accountants.</p>
          <div><button className="btn primary" disabled={busy} onClick={() => run(async () => setSetup(await api.post('/api/auth/2fa/setup')))}>Set up</button></div>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/api/auth/2fa/enable', { code }); setUser({ ...user, twoFactor: true }); setSetup(null); setCode(''); toast('Two-factor login is on'); }); }}>
          <p className="small">1. Scan this QR with your authenticator app.</p>
          <img src={setup.qr} alt="QR" width="200" height="200" />
          <p className="small muted">Cannot scan? Enter this key manually: <code>{setup.secret}</code></p>
          <p className="small">2. Type the 6-digit code it shows.</p>
          <div className="field"><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} required autoFocus /></div>
          <button className="btn primary" disabled={busy}>Turn on</button> <button type="button" className="btn" onClick={() => setSetup(null)}>Cancel</button>
          <p className="small muted">If you lose your phone, an administrator can reset your two-factor login in Users & Roles.</p>
        </form>
      )}
    </div>
  );
}

export default function Profile() {
  const { user, setUser } = useApp();
  const toast = useToast();
  const [p, setP] = useState({ name: user.name, phone: user.phone || '' });
  const [pw, setPw] = useState({ current: '', next: '', again: '' });

  const saveProfile = async (e) => {
    e.preventDefault();
    try { const r = await api.put('/api/auth/profile', p); setUser({ ...user, ...r.user }); toast('Profile updated'); } catch (err) { toast(err.message, 'err'); }
  };
  const savePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.again) return toast('New passwords do not match', 'err');
    try { await api.put('/api/auth/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', again: '' }); toast('Password changed'); } catch (err) { toast(err.message, 'err'); }
    return null;
  };
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>👤 My profile</h1><p className="muted">{user.email} · {user.role}</p></div></div>
      <form className="card form-grid one" onSubmit={saveProfile}>
        <h4>Details</h4>
        <div className="field"><label>Full name</label><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} required /></div>
        <div className="field"><label>Phone</label><input value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></div>
        <div><button className="btn primary">Save</button></div>
      </form>
      <form className="card form-grid one" onSubmit={savePw}>
        <h4>Change password</h4>
        <div className="field"><label>Current password</label><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></div>
        <div className="field"><label>New password (min 6)</label><input type="password" minLength={6} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></div>
        <div className="field"><label>Repeat new password</label><input type="password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} required /></div>
        <div><button className="btn primary">Update password</button></div>
      </form>
      <TwoFactor />
    </div>
  );
}