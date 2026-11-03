import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useLang } from '../i18n.jsx';

export default function Login({ needsSetup, onAuthed }) {
  const { t, lang, setLang } = useLang();
  const [form, setForm] = useState({ name: '', email: needsSetup ? '' : 'admin@medidesk.com', password: '', code: '' });
  const [need2fa, setNeed2fa] = useState(false); // Feature 15: second step
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = needsSetup ? await api.post('/api/auth/setup', form) : await api.post('/api/auth/login', { email: form.email, password: form.password, code: need2fa ? form.code : undefined });
      if (r.need2fa) { setNeed2fa(true); setBusy(false); return; }
      await onAuthed(r.token);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand"><span>🏥</span><h1>MediDesk</h1><p>Clinic Management System</p></div>
        <form onSubmit={submit}>
          <h2>{needsSetup ? 'Create the administrator account' : need2fa ? t('Two-factor login') : t('Sign in')}</h2>
          {error && <div className="alert err">{error}</div>}
          {need2fa ? (
            <div className="field"><label>6-digit code from your authenticator app</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={form.code} onChange={set('code')} required autoFocus /></div>
          ) : (
            <>
              {needsSetup && <div className="field"><label>{t('Full name')}</label><input value={form.name} onChange={set('name')} required autoFocus /></div>}
              <div className="field"><label>{t('Email')}</label><input type="email" value={form.email} onChange={set('email')} required autoFocus={!needsSetup} /></div>
              <div className="field"><label>{t('Password')}</label><input type="password" value={form.password} onChange={set('password')} required minLength={needsSetup ? 6 : 1} /></div>
            </>
          )}
          <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : needsSetup ? 'Create account' : need2fa ? t('Verify') : t('Sign in')}</button>
          {need2fa && <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => { setNeed2fa(false); setForm((f) => ({ ...f, code: '' })); }}>{t('Back')}</button>}
        </form>
        {!needsSetup && !need2fa && (
          <div className="login-links">
            <Link to="/book">📅 {t('Book an appointment')}</Link><Link to="/portal">🧑‍⚕️ {t('Patient portal')}</Link>
            <button type="button" className="linklike" onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}>{lang === 'bn' ? 'English' : 'বাংলা'}</button>
          </div>
        )}
        {!needsSetup && <p className="login-hint">Demo admin: <code>admin@medidesk.com</code> / <code>Admin@123</code><br />(after running <code>npm run seed</code>)</p>}
      </div>
    </div>
  );
}