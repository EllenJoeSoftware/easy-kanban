import { useState } from 'react';
import { api, setToken } from '../api';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api.login(email, password);
      setToken(r.token);
      location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <div className="brand-mark lg">EK</div>
          <div>
            <div className="brand-name">Easy Kanban</div>
            <div className="brand-sub">Mission control for your AI agents</div>
          </div>
        </div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small center">Credentials come from <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code> in your <code>.env</code>.</p>
      </form>
    </div>
  );
}
