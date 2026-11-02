import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, setToken, toast, useIsMobile, useRealtime, useToasts, timeAgo } from './api';
import { useBoards, useNotifications, useInvalidate } from './queries';
import { Icon, Modal } from './ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BoardPage from './pages/Board';
import AgentsPage from './pages/Agents';
import ActivityPage from './pages/Activity';
import SettingsPage from './pages/Settings';
import CardModal from './components/CardModal';
import NewBoardModal from './components/NewBoardModal';

export default function App() {
  if (!api.getToken()) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/b/:boardId" element={<BoardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/agents/:agentId" element={<AgentsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [toasts, dismiss] = useToasts();
  const connected = useRealtime((n) => {
    toast(n.title, n.body, () => n.boardId && navigate(`/b/${n.boardId}${n.cardId ? `?card=${n.cardId}` : ''}`));
    try {
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        const sys = new Notification(n.title, { body: n.body, icon: '/icon-192.png', tag: n.id });
        sys.onclick = () => { window.focus(); if (n.boardId) navigate(`/b/${n.boardId}${n.cardId ? `?card=${n.cardId}` : ''}`); };
      }
    } catch { /* notifications unsupported */ }
  });
  const cardId = params.get('card');
  const closeCard = () => { params.delete('card'); setParams(params, { replace: true }); };

  return (
    <div className={`shell ${isMobile ? 'is-mobile' : ''}`}>
      {!isMobile && <Sidebar onNewBoard={() => setNewBoard(true)} connected={connected} />}
      {isMobile && drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNewBoard={() => { setDrawer(false); setNewBoard(true); }} connected={connected} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}
      <div className="main">
        <TopBar isMobile={isMobile} onMenu={() => setDrawer(true)} connected={connected} />
        <div className="content">{children}</div>
        {isMobile && <BottomNav />}
      </div>
      {cardId && <CardModal cardId={cardId} onClose={closeCard} />}
      <NewBoardModal open={newBoard} onClose={() => setNewBoard(false)} />
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="toast" onClick={() => { t.onClick?.(); dismiss(t.id); }}>
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ onNewBoard, connected, onNavigate }: { onNewBoard: () => void; connected: boolean; onNavigate?: () => void }) {
  const { data: boards } = useBoards();
  const nav = (to: string, icon: string, label: string) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onNavigate}>
      <Icon name={icon} /> <span>{label}</span>
    </NavLink>
  );
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">EK</div>
        <div>
          <div className="brand-name">Easy Kanban</div>
          <div className="brand-sub"><span className={`live ${connected ? 'on' : ''}`} />{connected ? 'Live' : 'Reconnecting…'}</div>
        </div>
      </div>
      <nav className="nav">
        {nav('/', 'home', 'Overview')}
        {nav('/agents', 'agents', 'Agents')}
        {nav('/activity', 'activity', 'Activity')}
        {nav('/settings', 'settings', 'Settings')}
      </nav>
      <div className="nav-section">
        <span>Boards</span>
        <button className="icon-btn sm" onClick={onNewBoard} aria-label="New board" title="New board"><Icon name="plus" size={16} /></button>
      </div>
      <nav className="nav boards-nav">
        {boards?.map((b) => (
          <NavLink key={b.id} to={`/b/${b.id}`} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onNavigate}>
            <span className="board-icon" style={{ background: `${b.color}26` }}>{b.icon}</span>
            <span className="truncate">{b.name}</span>
            <span className="nav-count">{b.cardCount}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function TopBar({ isMobile, onMenu, connected }: { isMobile: boolean; onMenu: () => void; connected: boolean }) {
  const loc = useLocation();
  const { data: boards } = useBoards();
  const boardId = loc.pathname.startsWith('/b/') ? loc.pathname.split('/')[2] : null;
  const board = boards?.find((b) => b.id === boardId);
  const title = board ? `${board.icon} ${board.name}`
    : loc.pathname.startsWith('/agents') ? 'Agents'
    : loc.pathname.startsWith('/activity') ? 'Activity'
    : loc.pathname.startsWith('/settings') ? 'Settings' : 'Overview';
  return (
    <header className="topbar">
      {isMobile && <button className="icon-btn" onClick={onMenu} aria-label="Menu"><Icon name="menu" /></button>}
      <h1 className="topbar-title truncate">{title}</h1>
      {isMobile && <span className={`live ${connected ? 'on' : ''}`} title={connected ? 'Live' : 'Reconnecting'} />}
      <div className="topbar-actions">
        <NotificationBell />
      </div>
    </header>
  );
}

function NotificationBell() {
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const inv = useInvalidate();
  const unread = data?.filter((n) => !n.read).length ?? 0;
  const markAll = async () => { await api.markNotificationsRead(); inv(['notifications']); };
  return (
    <>
      <button className="icon-btn bell" onClick={() => setOpen(true)} aria-label="Notifications">
        <Icon name="bell" />
        {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Notifications"
        footer={<>
          {'Notification' in window && Notification.permission === 'default' && (
            <button className="btn ghost" onClick={() => Notification.requestPermission()}>Enable desktop alerts</button>
          )}
          <button className="btn" onClick={markAll} disabled={!unread}>Mark all read</button>
        </>}>
        {!data?.length && <div className="muted center pad">No notifications yet. You'll be told here when agents finish, fail or ask a question.</div>}
        <div className="notif-list">
          {data?.map((n) => (
            <button key={n.id} className={`notif ${n.read ? '' : 'unread'}`} onClick={async () => {
              setOpen(false);
              if (!n.read) { await api.markNotificationsRead([n.id]); inv(['notifications']); }
              if (n.boardId) navigate(`/b/${n.boardId}${n.cardId ? `?card=${n.cardId}` : ''}`);
            }}>
              <div className="notif-title">{n.title}</div>
              <div className="notif-body">{n.body}</div>
              <div className="notif-time">{timeAgo(n.createdAt)}</div>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}

function BottomNav() {
  const { data: boards } = useBoards();
  const loc = useLocation();
  const lastBoard = (() => { try { return localStorage.getItem('ek_last_board'); } catch { return null; } })();
  const boardTarget = boards?.find((b) => b.id === lastBoard)?.id ?? boards?.[0]?.id;
  const item = (to: string, icon: string, label: string, active: boolean) => (
    <NavLink to={to} className={`tab ${active ? 'active' : ''}`}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
  );
  return (
    <nav className="bottom-nav">
      {item('/', 'home', 'Overview', loc.pathname === '/')}
      {item(boardTarget ? `/b/${boardTarget}` : '/', 'board', 'Board', loc.pathname.startsWith('/b/'))}
      {item('/agents', 'agents', 'Agents', loc.pathname.startsWith('/agents'))}
      {item('/activity', 'activity', 'Activity', loc.pathname.startsWith('/activity'))}
      {item('/settings', 'settings', 'Settings', loc.pathname.startsWith('/settings'))}
    </nav>
  );
}

export function logout() {
  setToken(null);
  location.href = '/login';
}
