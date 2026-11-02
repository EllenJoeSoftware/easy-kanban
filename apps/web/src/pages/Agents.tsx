import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Agent, AgentWithKey, CreateAgentInput } from '@easy-kanban/shared';
import { api, timeAgo, toast } from '../api';
import { useAgents, useBoards, useInvalidate, showError } from '../queries';
import { AgentAvatar, Empty, Icon, Label, Modal, Spinner, StatusPill, copy } from '../ui';
import { describe } from '../components/CardModal';

const RUNTIMES = ['claude', 'claude-code', 'hermes', 'openai', 'gemini', 'ollama', 'n8n', 'custom'];
const AVATARS = ['🤖', '🔎', '✍️', '🧠', '📰', '🐔', '💼', '🛠️', '📊', '📣', '🧾', '🕵️'];

export default function AgentsPage() {
  const { agentId } = useParams();
  const { data: agents, isLoading } = useAgents();
  const [form, setForm] = useState<Agent | 'new' | null>(null);
  const [revealed, setRevealed] = useState<AgentWithKey | null>(null);
  if (isLoading) return <div className="center pad"><Spinner /></div>;
  const agent = agents?.find((a) => a.id === agentId);

  return (
    <div className="page">
      {agent ? (
        <AgentDetail agent={agent} onEdit={() => setForm(agent)} onKey={setRevealed} />
      ) : (
        <>
          <div className="page-head">
            <div>
              <h2>Your agents</h2>
              <p className="muted small">Each agent gets an API key. Agents claim cards from <b>To Do</b>, log progress, ask you questions and hand work back for review.</p>
            </div>
            <button className="btn primary" onClick={() => setForm('new')}><Icon name="plus" size={16} /> New agent</button>
          </div>
          {!agents?.length && (
            <Empty icon="agents" title="No agents yet">
              Create an agent for each worker — e.g. a Claude researcher, a Hermes messaging agent or an n8n workflow.
            </Empty>
          )}
          <div className="agent-grid">
            {agents?.map((a) => (
              <Link key={a.id} to={`/agents/${a.id}`} className={`agent-card ${a.enabled ? '' : 'disabled'}`} style={{ ['--agent' as any]: a.color }}>
                <div className="row gap">
                  <AgentAvatar agent={a} size={42} />
                  <div className="grow min0">
                    <div className="agent-name truncate">{a.name}</div>
                    <div className="muted xsmall truncate">{[a.runtime, a.model].filter(Boolean).join(' · ')}</div>
                  </div>
                  <StatusPill status={a.status} />
                </div>
                <div className="agent-note muted small">{a.statusNote || a.description || 'No description'}</div>
                {a.capabilities.length > 0 && <div className="card-labels">{a.capabilities.map((c) => <Label key={c} text={c} />)}</div>}
                <div className="agent-stats">
                  <div><b>{a.stats?.inProgress ?? 0}</b><span>active</span></div>
                  <div><b>{a.stats?.assigned ?? 0}</b><span>assigned</span></div>
                  <div><b>{a.stats?.completed7d ?? 0}</b><span>done 7d</span></div>
                  <div><b>${(a.stats?.costUsd7d ?? 0).toFixed(2)}</b><span>cost 7d</span></div>
                </div>
                <div className="muted xsmall">{a.lastSeenAt ? `Last seen ${timeAgo(a.lastSeenAt)}` : 'Never connected'}</div>
              </Link>
            ))}
          </div>
        </>
      )}
      {form && <AgentForm agent={form === 'new' ? null : form} onClose={() => setForm(null)} onCreated={setRevealed} />}
      {revealed && <KeyReveal agent={revealed} onClose={() => setRevealed(null)} />}
    </div>
  );
}

function AgentDetail({ agent, onEdit, onKey }: { agent: Agent; onEdit: () => void; onKey: (a: AgentWithKey) => void }) {
  const inv = useInvalidate();
  const navigate = useNavigate();
  const { data: runs } = useQuery({ queryKey: ['runs', agent.id, agent.updatedAt], queryFn: () => api.agentRuns(agent.id) });
  const { data: cards } = useQuery({ queryKey: ['cards', 'agent', agent.id], queryFn: () => api.listCards({ assigneeId: agent.id }) });
  const { data: activity } = useQuery({ queryKey: ['activity', 'agent', agent.id], queryFn: () => api.activity({ agentId: agent.id, limit: 30 }) });
  const upd = async (input: Parameters<typeof api.updateAgent>[1]) => {
    try { await api.updateAgent(agent.id, input); inv(['agents']); } catch (e) { showError(e); }
  };
  const open = cards?.filter((c) => !c.completedAt) ?? [];
  return (
    <>
      <Link to="/agents" className="back"><Icon name="chevronLeft" size={16} /> All agents</Link>
      <div className="agent-hero" style={{ ['--agent' as any]: agent.color }}>
        <AgentAvatar agent={agent} size={64} />
        <div className="grow min0">
          <h2 className="row gap-xs">{agent.name} {!agent.enabled && <span className="muted small">(disabled)</span>}</h2>
          <div className="muted small">{[agent.runtime, agent.model].filter(Boolean).join(' · ')} · key <code>{agent.apiKeyPrefix}…</code></div>
          <div className="row gap-xs wrap mt"><StatusPill status={agent.status} />{agent.statusNote && <span className="muted small">{agent.statusNote}</span>}</div>
        </div>
        <div className="row gap wrap hero-actions">
          {agent.status === 'paused'
            ? <button className="btn" onClick={() => upd({ status: 'idle' })}><Icon name="play" size={15} /> Resume</button>
            : <button className="btn" onClick={() => upd({ status: 'paused' })}><Icon name="pause" size={15} /> Pause</button>}
          {agent.status === 'error' && <button className="btn" onClick={() => upd({ status: 'idle', statusNote: '' })}>Clear error</button>}
          {agent.webhookUrl && <button className="btn" onClick={async () => { const r = await api.pingAgent(agent.id); toast(r.ok ? 'Webhook OK' : 'Webhook failed', r.error ?? `HTTP ${r.status}`); }}><Icon name="zap" size={15} /> Ping</button>}
          <button className="btn" onClick={onEdit}><Icon name="edit" size={15} /> Edit</button>
        </div>
      </div>
      {agent.description && <p className="agent-desc">{agent.description}</p>}

      <div className="stats">
        <div className="stat"><div className="stat-label">Active runs</div><div className="stat-value">{agent.stats?.inProgress ?? 0}</div><div className="stat-sub">max {agent.maxConcurrent}</div></div>
        <div className="stat"><div className="stat-label">Open cards</div><div className="stat-value">{agent.stats?.assigned ?? 0}</div><div className="stat-sub">assigned</div></div>
        <div className="stat tone-green"><div className="stat-label">Completed 7d</div><div className="stat-value">{agent.stats?.completed7d ?? 0}</div><div className="stat-sub">{agent.stats?.failed7d ?? 0} failed</div></div>
        <div className="stat"><div className="stat-label">Spend 7d</div><div className="stat-value">${(agent.stats?.costUsd7d ?? 0).toFixed(2)}</div><div className="stat-sub">{agent.stats?.totalRuns ?? 0} runs total</div></div>
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h2>Open cards</h2></div>
          {!open.length && <div className="muted small pad-y">No open cards assigned.</div>}
          <div className="attention">
            {open.map((c) => (
              <button key={c.id} className="attn" onClick={() => navigate(`/b/${c.boardId}?card=${c.id}`)}>
                <span className={`attn-kind ${c.blocked ? 'blocked' : c.id === agent.currentCardId ? 'working' : 'review'}`}><Icon name={c.blocked ? 'alert' : c.id === agent.currentCardId ? 'zap' : 'board'} size={14} /></span>
                <div className="grow min0"><div className="truncate"><span className="muted">#{c.number}</span> {c.title}</div>
                  <div className="muted xsmall">{c.progress}% · updated {timeAgo(c.updatedAt)}</div></div>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Settings</h2></div>
          <dl className="kv">
            <dt>Auto-claim</dt><dd>{agent.autoClaim ? 'Yes — also picks unassigned cards' : 'No — only cards assigned to it'}</dd>
            <dt>Capabilities</dt><dd>{agent.capabilities.length ? agent.capabilities.map((c) => <Label key={c} text={c} />) : <span className="muted">any (no label filter)</span>}</dd>
            <dt>Boards</dt><dd>{agent.boardIds.length ? `${agent.boardIds.length} board(s)` : 'All boards'}</dd>
            <dt>Webhook</dt><dd className="truncate">{agent.webhookUrl || <span className="muted">none (agent polls)</span>}</dd>
          </dl>
          <div className="row gap wrap">
            <button className="btn ghost sm" onClick={async () => {
              if (!confirm('Rotate the API key? The old key stops working immediately.')) return;
              try { onKey(await api.rotateAgentKey(agent.id)); inv(['agents']); } catch (e) { showError(e); }
            }}><Icon name="key" size={14} /> Rotate key</button>
            <button className="btn ghost sm" onClick={() => upd({ enabled: !agent.enabled })}>{agent.enabled ? 'Disable' : 'Enable'}</button>
            <button className="btn ghost sm danger" onClick={async () => {
              if (!confirm(`Delete ${agent.name}? Its cards will be unassigned.`)) return;
              await api.deleteAgent(agent.id); inv(['agents']); navigate('/agents');
            }}><Icon name="trash" size={14} /> Delete</button>
          </div>
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Runs</h2></div>
          {!runs?.length ? <div className="muted small pad-y">No runs yet.</div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Card</th><th>Status</th><th>Started</th><th>Tokens</th><th>Cost</th><th>Summary</th></tr></thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td><CardLink id={r.cardId} /></td>
                      <td><span className={`run run-${r.status}`}>{r.status}</span></td>
                      <td className="nowrap">{timeAgo(r.startedAt)}</td>
                      <td>{(r.tokensIn + r.tokensOut).toLocaleString()}</td>
                      <td>${r.costUsd.toFixed(3)}</td>
                      <td className="truncate max-w">{r.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel span-2">
          <div className="panel-head"><h2>Activity</h2></div>
          <ul className="feed">
            {activity?.map((a) => (
              <li key={a.id}><span className={`feed-dot actor-${a.actor.type}`} /><div><b>{a.actor.name}</b> {describe(a.action, a.data)}</div><span className="muted xsmall nowrap">{timeAgo(a.createdAt)}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function CardLink({ id }: { id: string }) {
  const { data } = useQuery({ queryKey: ['card', id], queryFn: () => api.getCard(id), staleTime: 60_000, retry: false });
  if (!data) return <span className="muted">—</span>;
  return <Link to={`/b/${data.boardId}?card=${id}`} className="truncate">#{data.number} {data.title}</Link>;
}

function AgentForm({ agent, onClose, onCreated }: { agent: Agent | null; onClose: () => void; onCreated: (a: AgentWithKey) => void }) {
  const { data: boards } = useBoards();
  const inv = useInvalidate();
  const [f, setF] = useState<Required<CreateAgentInput>>({
    name: '', description: '', avatar: '🤖', color: '#22c55e', runtime: 'claude', model: '', capabilities: [], boardIds: [], autoClaim: true, maxConcurrent: 1, webhookUrl: '',
  });
  const [caps, setCaps] = useState('');
  useEffect(() => {
    if (agent) {
      setF({ name: agent.name, description: agent.description, avatar: agent.avatar, color: agent.color, runtime: agent.runtime, model: agent.model,
        capabilities: agent.capabilities, boardIds: agent.boardIds, autoClaim: agent.autoClaim, maxConcurrent: agent.maxConcurrent, webhookUrl: agent.webhookUrl });
      setCaps(agent.capabilities.join(', '));
    }
  }, [agent]);
  const set = <K extends keyof CreateAgentInput>(k: K, v: CreateAgentInput[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const input = { ...f, capabilities: caps.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) };
    try {
      if (agent) await api.updateAgent(agent.id, input);
      else onCreated(await api.createAgent(input));
      inv(['agents']);
      onClose();
    } catch (e) { showError(e); }
  };
  return (
    <Modal open onClose={onClose} title={agent ? `Edit ${agent.name}` : 'New agent'} wide footer={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" onClick={save} disabled={!f.name.trim()}>{agent ? 'Save' : 'Create agent'}</button>
    </>}>
      <div className="grid-2">
        <label className="field"><span>Name</span><input autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. News Researcher" /></label>
        <div className="row gap">
          <label className="field grow"><span>Runtime</span>
            <select value={f.runtime} onChange={(e) => set('runtime', e.target.value)}>{RUNTIMES.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <label className="field" style={{ width: 70 }}><span>Colour</span><input type="color" value={f.color} onChange={(e) => set('color', e.target.value)} /></label>
        </div>
      </div>
      <div className="field"><span>Avatar</span>
        <div className="icon-pick">{AVATARS.map((i) => <button key={i} className={i === f.avatar ? 'active' : ''} onClick={() => set('avatar', i)}>{i}</button>)}</div>
      </div>
      <label className="field"><span>Model</span><input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="e.g. claude-opus-5-5, gpt-5, llama3" /></label>
      <label className="field"><span>Description / role</span><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What this agent does" /></label>
      <label className="field"><span>Capabilities (labels it can pick up, comma separated)</span>
        <input value={caps} onChange={(e) => setCaps(e.target.value)} placeholder="research, writing, code — leave empty for any" />
      </label>
      <div className="grid-2">
        <label className="field check"><input type="checkbox" checked={f.autoClaim} onChange={(e) => set('autoClaim', e.target.checked)} />
          <span>Auto-claim unassigned cards<small className="muted"> — otherwise only cards you assign</small></span></label>
        <label className="field"><span>Max concurrent cards</span><input type="number" min={1} max={50} value={f.maxConcurrent} onChange={(e) => set('maxConcurrent', Number(e.target.value))} /></label>
      </div>
      <div className="field"><span>Boards it works on</span>
        <div className="chip-pick">
          {boards?.map((b) => {
            const on = f.boardIds.includes(b.id);
            return <button key={b.id} className={on ? 'active' : ''} onClick={() => set('boardIds', on ? f.boardIds.filter((x) => x !== b.id) : [...f.boardIds, b.id])}>{b.icon} {b.name}</button>;
          })}
        </div>
        <small className="muted">{f.boardIds.length ? '' : 'None selected = all boards'}</small>
      </div>
      <label className="field"><span>Webhook URL (optional — we POST here when a card is assigned or you comment)</span>
        <input value={f.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://your-agent.example.com/hooks/kanban" />
      </label>
    </Modal>
  );
}

function KeyReveal({ agent, onClose }: { agent: AgentWithKey; onClose: () => void }) {
  const base = location.origin;
  const curl = `curl -X POST ${base}/api/agent/claim \\\n  -H "Authorization: Bearer ${agent.apiKey}"`;
  const mcp = JSON.stringify({ mcpServers: { 'easy-kanban': { command: 'node', args: ['C:/path/to/easy-kanban-mcp.mjs'], env: { EASY_KANBAN_URL: base, EASY_KANBAN_API_KEY: agent.apiKey } } } }, null, 2);
  const Copyable = ({ label, value, pre }: { label: string; value: string; pre?: boolean }) => (
    <div className="field">
      <span>{label}</span>
      <div className="copy-box">
        {pre ? <pre>{value}</pre> : <code>{value}</code>}
        <button className="icon-btn sm" onClick={() => { copy(value); toast('Copied'); }} aria-label={`Copy ${label}`}><Icon name="copy" size={15} /></button>
      </div>
    </div>
  );
  return (
    <Modal open onClose={onClose} title={`${agent.avatar} ${agent.name} — credentials`} wide footer={<button className="btn primary" onClick={onClose}>I've saved it</button>}>
      <div className="banner warn"><Icon name="key" size={16} /><div>This key is shown <b>once</b>. Store it in your agent's config or secrets manager.</div></div>
      <Copyable label="API key" value={agent.apiKey} />
      <Copyable label="Webhook signing secret (HMAC-SHA256 of the body, header X-EasyKanban-Signature)" value={agent.webhookSecret} />
      <Copyable label="Try it — claim the next card" value={curl} pre />
      <Copyable label="MCP config (Claude Desktop / Claude Code / Hermes)" value={mcp} pre />
      <p className="muted small">Download the MCP server file from <a className="md" href="/downloads/easy-kanban-mcp.mjs" download><code>{base}/downloads/easy-kanban-mcp.mjs</code></a> (one file, needs Node 20+), then point <code>args</code> at it.</p>
    </Modal>
  );
}
