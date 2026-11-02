import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, toast } from '../api';
import { useMe, useInvalidate, showError } from '../queries';
import { Icon } from '../ui';
import { logout } from '../App';

type BIPEvent = Event & { prompt: () => Promise<void> };

export default function SettingsPage() {
  const { data: me } = useMe();
  const inv = useInvalidate();
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('ek_theme') ?? 'system'; } catch { return 'system'; } });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [installEvt, setInstallEvt] = useState<BIPEvent | null>(null);
  const { data: archived } = useQuery({ queryKey: ['boards', 'archived'], queryFn: async () => (await api.listBoards(true)).filter((b) => b.archived) });

  useEffect(() => {
    const h = (e: Event) => { e.preventDefault(); setInstallEvt(e as BIPEvent); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  const applyTheme = (t: string) => {
    setTheme(t);
    try { t === 'system' ? localStorage.removeItem('ek_theme') : localStorage.setItem('ek_theme', t); } catch { /* ignore */ }
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  };
  const changePw = async () => {
    try { await api.changePassword(pw.current, pw.next); setPw({ current: '', next: '' }); toast('Password changed'); } catch (e) { showError(e); }
  };
  const exportData = async () => {
    const data = await api.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `easy-kanban-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const standalone = window.matchMedia('(display-mode: standalone)').matches;

  return (
    <div className="page settings">
      <section className="panel">
        <h2>Account</h2>
        <p className="muted small">Signed in as <b>{me?.user?.name}</b> ({me?.user?.email})</p>
        <div className="grid-2">
          <label className="field"><span>Current password</span><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
          <label className="field"><span>New password (8+ chars)</span><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
        </div>
        <div className="row gap">
          <button className="btn" onClick={changePw} disabled={!pw.current || pw.next.length < 8}>Change password</button>
          <span className="spacer" />
          <button className="btn ghost" onClick={logout}><Icon name="logout" size={16} /> Sign out</button>
        </div>
      </section>

      <section className="panel">
        <h2>Appearance</h2>
        <div className="seg">
          {['system', 'dark', 'light'].map((t) => <button key={t} className={`seg-btn ${theme === t ? 'active' : ''}`} onClick={() => applyTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </section>

      <section className="panel">
        <h2>Install on your phone</h2>
        {standalone ? <p className="muted small">You're using the installed app. ✓</p> : (
          <>
            <p className="muted small">Easy Kanban is a Progressive Web App. On <b>Android/Chrome</b>: menu → <i>Install app</i>. On <b>iPhone/Safari</b>: Share → <i>Add to Home Screen</i>. Your phone must be able to reach this server (same Wi‑Fi, Tailscale, or a public domain).</p>
            {installEvt && <button className="btn primary" onClick={() => installEvt.prompt()}><Icon name="download" size={16} /> Install now</button>}
          </>
        )}
        {'Notification' in window && (
          <div className="row gap mt">
            <span className="muted small">Desktop alerts: <b>{Notification.permission}</b></span>
            {Notification.permission === 'default' && <button className="btn sm" onClick={() => Notification.requestPermission()}>Enable</button>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Archived boards</h2>
        {!archived?.length && <p className="muted small">None.</p>}
        {archived?.map((b) => (
          <div key={b.id} className="row gap pad-y">
            <span>{b.icon} {b.name}</span><span className="spacer" />
            <button className="btn sm" onClick={async () => { await api.updateBoard(b.id, { archived: false }); inv(['boards']); }}>Restore</button>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Data & API</h2>
        <p className="muted small">API base: <code>{location.origin}/api</code> · Agents authenticate with <code>Authorization: Bearer ek_…</code>. Full reference in <code>docs/API.md</code>.</p>
        <button className="btn" onClick={exportData}><Icon name="download" size={16} /> Export everything (JSON)</button>
      </section>
    </div>
  );
}
