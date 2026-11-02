import { Link, useNavigate } from 'react-router-dom';
import { timeAgo } from '../api';
import { useAgents, useBoards, useDashboard } from '../queries';
import { AgentAvatar, Empty, Icon, PriorityBadge, Spinner, StatusPill } from '../ui';
import { describe } from '../components/CardModal';

export default function Dashboard() {
  const { data, isLoading } = useDashboard();
  const { data: agents } = useAgents();
  const { data: boards } = useBoards();
  const navigate = useNavigate();
  if (isLoading || !data) return <div className="center pad"><Spinner /></div>;
  const openCard = (boardId: string, cardId: string) => navigate(`/b/${boardId}?card=${cardId}`);
  const boardName = (id: string | null) => boards?.find((b) => b.id === id)?.name;

  return (
    <div className="page dashboard">
      <div className="stats">
        <Stat label="Agents working" value={data.agents.working} sub={`of ${data.agents.total} enabled`} tone="amber" />
        <Stat label="Need your input" value={data.cards.review + data.agents.waiting} sub={`${data.cards.review} in review`} tone="purple" />
        <Stat label="Blocked" value={data.cards.blocked} sub={`${data.cards.overdue} overdue`} tone={data.cards.blocked ? 'red' : undefined} />
        <Stat label="Done this week" value={data.cards.completed7d} sub={`$${data.costUsd7d.toFixed(2)} agent spend`} tone="green" />
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>Agents</h2><Link to="/agents" className="btn ghost sm">Manage</Link></div>
          {!agents?.length && <Empty icon="agents" title="No agents yet"><Link to="/agents" className="btn primary sm">Create your first agent</Link></Empty>}
          <div className="agent-rows">
            {agents?.map((a) => (
              <Link key={a.id} to={`/agents/${a.id}`} className="agent-row">
                <AgentAvatar agent={a} size={34} />
                <div className="grow min0">
                  <div className="row gap-xs"><b className="truncate">{a.name}</b>{!a.enabled && <span className="muted xsmall">disabled</span>}</div>
                  <div className="muted small truncate">{a.statusNote || a.description || a.model || a.runtime}</div>
                </div>
                <div className="agent-row-right">
                  <StatusPill status={a.status} />
                  <div className="muted xsmall">{a.lastSeenAt ? `seen ${timeAgo(a.lastSeenAt)}` : 'never seen'}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h2>Needs attention</h2></div>
          {!data.needsAttention.length && <div className="muted small pad-y">Nothing waiting on you. 🎉</div>}
          <div className="attention">
            {data.needsAttention.map((c) => (
              <button key={c.id} className="attn" onClick={() => openCard(c.boardId, c.id)}>
                <span className={`attn-kind ${c.blocked ? 'blocked' : 'review'}`}>
                  <Icon name={c.blocked ? 'alert' : 'check'} size={14} />
                </span>
                <div className="grow min0">
                  <div className="truncate"><span className="muted">#{c.number}</span> {c.title}</div>
                  <div className="muted xsmall truncate">{c.blocked ? c.blockedReason || 'Blocked' : 'Ready for review'} · {boardName(c.boardId)}</div>
                </div>
                {c.priority !== 'medium' && <PriorityBadge p={c.priority} compact />}
              </button>
            ))}
          </div>
        </section>

        <section className="panel span-2">
          <div className="panel-head"><h2>Recent activity</h2><Link to="/activity" className="btn ghost sm">All</Link></div>
          <ul className="feed">
            {data.recentActivity.map((a) => (
              <li key={a.id} onClick={() => a.boardId && a.cardId && openCard(a.boardId, a.cardId)} className={a.cardId ? 'clickable' : ''}>
                <span className={`feed-dot actor-${a.actor.type}`} />
                <div><b>{a.actor.name}</b> {describe(a.action, a.data)}</div>
                <span className="muted xsmall nowrap">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub: string; tone?: string }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}
