import { useEffect, useMemo, useState } from 'react';
import type { CardDetail, Comment, Priority } from '@easy-kanban/shared';
import { PRIORITIES } from '@easy-kanban/shared';
import { api, timeAgo, toast } from '../api';
import { useAgents, useBoard, useCard, useInvalidate, useMoveCard, useUpdateCard, showError } from '../queries';
import { AgentAvatar, Icon, Label, Markdown, Modal, PRIORITY_LABEL, Spinner, UserAvatar, StatusPill } from '../ui';

export default function CardModal({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const { data: card, isLoading, error } = useCard(cardId);
  return (
    <Modal open onClose={onClose} wide title={card ? <span className="muted">#{card.number}</span> : ''}>
      {isLoading && <div className="center pad"><Spinner /></div>}
      {error && <div className="pad">Card not found.</div>}
      {card && <CardBody card={card} onClose={onClose} />}
    </Modal>
  );
}

function CardBody({ card, onClose }: { card: CardDetail; onClose: () => void }) {
  const { data: board } = useBoard(card.boardId);
  const { data: agents } = useAgents();
  const update = useUpdateCard(card.boardId);
  const move = useMoveCard(card.boardId);
  const inv = useInvalidate();
  const [title, setTitle] = useState(card.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState(card.description);
  const [tab, setTab] = useState<'timeline' | 'runs' | 'history'>('timeline');
  useEffect(() => { setTitle(card.title); }, [card.title]);
  useEffect(() => { if (!editingDesc) setDesc(card.description); }, [card.description, editingDesc]);

  const set = (input: Parameters<typeof api.updateCard>[1]) => update.mutate({ id: card.id, input });
  const refresh = () => inv(['card', card.id], ['board', card.boardId]);
  const agent = card.assigneeType === 'agent' ? agents?.find((a) => a.id === card.assigneeId) : undefined;
  const column = board?.columns.find((c) => c.id === card.columnId);
  const assigneeValue = card.assigneeType ? `${card.assigneeType}:${card.assigneeId}` : '';

  return (
    <div className="cd-wrap">
        <textarea className="cd-title" value={title} rows={1} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== card.title && set({ title: title.trim() })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />

        {card.blocked && (
          <div className="banner warn">
            <Icon name="alert" size={16} />
            <div className="grow">{card.blockedReason || 'Blocked'}</div>
            <button className="btn sm" onClick={() => set({ blocked: false })}>Unblock</button>
          </div>
        )}

    <div className="card-detail">
      <div className="cd-main">
        <div className="cd-section">
          <div className="cd-section-head">
            <h4>Description</h4>
            {!editingDesc && <button className="btn ghost sm" onClick={() => setEditingDesc(true)}><Icon name="edit" size={14} /> Edit</button>}
          </div>
          {editingDesc ? (
            <>
              <textarea className="desc-input" rows={8} value={desc} onChange={(e) => setDesc(e.target.value)} autoFocus placeholder="Markdown supported. Give the agent clear instructions, context and the definition of done." />
              <div className="row gap">
                <button className="btn primary sm" onClick={() => { set({ description: desc }); setEditingDesc(false); }}>Save</button>
                <button className="btn ghost sm" onClick={() => { setDesc(card.description); setEditingDesc(false); }}>Cancel</button>
              </div>
            </>
          ) : card.description ? <Markdown text={card.description} /> : (
            <button className="placeholder" onClick={() => setEditingDesc(true)}>Add instructions for the agent…</button>
          )}
        </div>

        {card.result && (
          <div className="cd-section result">
            <div className="cd-section-head"><h4>Result</h4></div>
            <Markdown text={card.result} />
          </div>
        )}

        <Checklist card={card} onChange={refresh} />

        <div className="cd-section">
          <div className="tabs">
            <button className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>Timeline <span className="tab-count">{card.comments.length}</span></button>
            <button className={tab === 'runs' ? 'active' : ''} onClick={() => setTab('runs')}>Agent runs <span className="tab-count">{card.runs.length}</span></button>
            <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>History</button>
          </div>
          {tab === 'timeline' && <Timeline card={card} onChange={refresh} />}
          {tab === 'runs' && <Runs card={card} />}
          {tab === 'history' && (
            <ul className="history">
              {card.activity.map((a) => (
                <li key={a.id}><b>{a.actor.name}</b> {describe(a.action, a.data)} <span className="muted">· {timeAgo(a.createdAt)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <aside className="cd-side">
        <Field label="Status" half>
          <select value={card.columnId} onChange={(e) => move.mutate({ id: card.id, input: { columnId: e.target.value } })}>
            {board?.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Assignee" half>
          <select value={assigneeValue} onChange={(e) => {
            const v = e.target.value;
            if (!v) return set({ assigneeType: null, assigneeId: null });
            const [t, id] = v.split(':');
            set({ assigneeType: t as 'agent' | 'user', assigneeId: id });
          }}>
            <option value="">Unassigned</option>
            <optgroup label="Agents">
              {agents?.map((a) => <option key={a.id} value={`agent:${a.id}`}>{a.avatar} {a.name}{a.enabled ? '' : ' (disabled)'}</option>)}
            </optgroup>
            <MeOption />
          </select>
          {agent && (
            <div className="assignee-status">
              <AgentAvatar agent={agent} size={20} /><StatusPill status={agent.status} />
              {agent.webhookUrl && (
                <button className="btn ghost xs" title="Send this card to the agent's webhook now" onClick={async () => {
                  const r = await api.pingAgent(agent.id, card.id);
                  toast(r.ok ? 'Agent notified' : 'Webhook failed', r.error);
                }}><Icon name="zap" size={13} /> Nudge</button>
              )}
            </div>
          )}
        </Field>
        <Field label="Priority">
          <div className="seg">
            {PRIORITIES.map((p) => (
              <button key={p} className={`seg-btn prio-${p} ${card.priority === p ? 'active' : ''}`} onClick={() => set({ priority: p as Priority })}>{PRIORITY_LABEL[p]}</button>
            ))}
          </div>
        </Field>
        <Field label="Labels"><LabelEditor labels={card.labels} onChange={(labels) => set({ labels })} /></Field>
        <Field label="Due" half>
          <input type="datetime-local" value={card.dueAt ? toLocalInput(card.dueAt) : ''} onChange={(e) => set({ dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
        </Field>
        <Field label={`Progress · ${card.progress}%`} half>
          <input type="range" min={0} max={100} step={5} defaultValue={card.progress} key={card.progress} onMouseUp={(e) => set({ progress: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => set({ progress: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => set({ progress: Number((e.target as HTMLInputElement).value) })} />
        </Field>
        <Field label="Depends on">
          <Dependencies card={card} onChange={(dependsOn) => set({ dependsOn })} />
        </Field>
        {!card.blocked && (
          <button className="btn ghost sm block" onClick={() => { const r = prompt('Why is this blocked?'); if (r !== null) set({ blocked: true, blockedReason: r }); }}>
            <Icon name="alert" size={14} /> Mark blocked
          </button>
        )}
        <div className="cd-meta">
          <div>Column role: <b>{column?.kind.replace('_', ' ')}</b></div>
          <div>Created by {card.createdBy.name} · {timeAgo(card.createdAt)}</div>
          {card.startedAt && <div>Started {timeAgo(card.startedAt)}</div>}
          {card.completedAt && <div>Completed {timeAgo(card.completedAt)}</div>}
          <div>Updated {timeAgo(card.updatedAt)}</div>
        </div>
        <div className="row gap wrap">
          <button className="btn ghost sm" onClick={() => { set({ archived: !card.archived }); if (!card.archived) onClose(); }}>
            <Icon name="archive" size={14} /> {card.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button className="btn ghost sm danger" onClick={async () => {
            if (!confirm(`Delete card #${card.number}? This cannot be undone.`)) return;
            try { await api.deleteCard(card.id); inv(['board', card.boardId]); onClose(); } catch (e) { showError(e); }
          }}><Icon name="trash" size={14} /> Delete</button>
          <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/b/${card.boardId}?card=${card.id}`); toast('Link copied'); }}>
            <Icon name="link" size={14} /> Copy link
          </button>
        </div>
      </aside>
    </div>
    </div>
  );
}

function MeOption() {
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { api.me().then((r) => r.user && setMe(r.user)).catch(() => {}); }, []);
  if (!me) return null;
  return <optgroup label="People"><option value={`user:${me.id}`}>👤 {me.name} (me)</option></optgroup>;
}

function Field({ label, children, half }: { label: string; children: React.ReactNode; half?: boolean }) {
  return <div className={`side-field ${half ? 'half' : ''}`}><div className="side-label">{label}</div>{children}</div>;
}

function LabelEditor({ labels, onChange }: { labels: string[]; onChange: (l: string[]) => void }) {
  const [v, setV] = useState('');
  const add = () => {
    const parts = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange([...new Set([...labels, ...parts])]);
    setV('');
  };
  return (
    <div className="label-editor">
      {labels.map((l) => <Label key={l} text={l} onRemove={() => onChange(labels.filter((x) => x !== l))} />)}
      <input placeholder="+ label" value={v} onChange={(e) => setV(e.target.value)} onBlur={add}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } }} />
    </div>
  );
}

function Dependencies({ card, onChange }: { card: CardDetail; onChange: (ids: string[]) => void }) {
  const { data: board } = useBoard(card.boardId);
  const others = board?.cards.filter((c) => c.id !== card.id) ?? [];
  const byId = new Map(others.map((c) => [c.id, c]));
  return (
    <div className="deps">
      {card.dependsOn.map((id) => {
        const c = byId.get(id);
        return (
          <div key={id} className={`dep ${c?.completedAt ? 'done' : ''}`}>
            <span>{c ? `#${c.number} ${c.title}` : 'Missing card'}</span>
            <button className="label-x" onClick={() => onChange(card.dependsOn.filter((d) => d !== id))} aria-label="Remove dependency">×</button>
          </div>
        );
      })}
      <select value="" onChange={(e) => e.target.value && onChange([...card.dependsOn, e.target.value])}>
        <option value="">+ Add dependency</option>
        {others.filter((c) => !card.dependsOn.includes(c.id)).map((c) => <option key={c.id} value={c.id}>#{c.number} {c.title}</option>)}
      </select>
      {card.dependsOn.length > 0 && <div className="muted xsmall">Agents won't claim this until dependencies are done.</div>}
    </div>
  );
}

function Checklist({ card, onChange }: { card: CardDetail; onChange: () => void }) {
  const [text, setText] = useState('');
  const done = card.checklist.filter((i) => i.done).length;
  const add = async () => {
    if (!text.trim()) return;
    try { await api.addChecklistItem(card.id, text.trim()); setText(''); onChange(); } catch (e) { showError(e); }
  };
  return (
    <div className="cd-section">
      <div className="cd-section-head">
        <h4>Checklist</h4>
        {card.checklist.length > 0 && <span className="muted small">{done}/{card.checklist.length}</span>}
      </div>
      {card.checklist.length > 0 && <div className="progress thin"><div style={{ width: `${(done / card.checklist.length) * 100}%` }} /></div>}
      <ul className="checklist">
        {card.checklist.map((i) => (
          <li key={i.id} className={i.done ? 'done' : ''}>
            <label>
              <input type="checkbox" checked={i.done} onChange={async () => { await api.updateChecklistItem(i.id, { done: !i.done }); onChange(); }} />
              <span>{i.text}</span>
            </label>
            <button className="icon-btn xs" onClick={async () => { await api.deleteChecklistItem(i.id); onChange(); }} aria-label="Delete item"><Icon name="x" size={14} /></button>
          </li>
        ))}
      </ul>
      <div className="row gap">
        <input className="grow" placeholder="Add an item" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn sm" onClick={add}>Add</button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<Comment['kind'], string> = { comment: '', log: 'log', result: 'result', error: 'error', question: 'question', system: 'system' };

function Timeline({ card, onChange }: { card: CardDetail; onChange: () => void }) {
  const { data: agents } = useAgents();
  const [body, setBody] = useState('');
  const [showLogs, setShowLogs] = useState(true);
  const agentMap = useMemo(() => new Map((agents ?? []).map((a) => [a.id, a])), [agents]);
  const waiting = card.blocked && card.blockedReason.startsWith('Waiting for answer');
  const post = async () => {
    if (!body.trim()) return;
    try { await api.addComment(card.id, body.trim()); setBody(''); onChange(); } catch (e) { showError(e); }
  };
  const items = card.comments.filter((c) => showLogs || c.kind !== 'log');
  return (
    <div className="timeline">
      <div className="row between">
        <label className="muted small row gap-xs"><input type="checkbox" checked={showLogs} onChange={(e) => setShowLogs(e.target.checked)} /> Show agent logs</label>
      </div>
      {items.length === 0 && <div className="muted small pad-y">No comments yet.</div>}
      {items.map((c) => {
        const ag = c.author.type === 'agent' ? agentMap.get(c.author.id ?? '') : undefined;
        return (
          <div key={c.id} className={`tl-item kind-${c.kind}`}>
            <div className="tl-avatar">{ag ? <AgentAvatar agent={ag} size={26} /> : <UserAvatar name={c.author.name} size={26} />}</div>
            <div className="tl-body">
              <div className="tl-head">
                <b>{c.author.name}</b>
                {KIND_LABEL[c.kind] && <span className={`kind-badge kb-${c.kind}`}>{KIND_LABEL[c.kind]}</span>}
                <span className="muted">{timeAgo(c.createdAt)}</span>
              </div>
              {c.kind === 'log' ? <div className="log-line">{c.body}</div> : <Markdown text={c.body} />}
            </div>
          </div>
        );
      })}
      <div className="comment-box">
        <textarea rows={2} placeholder={waiting ? 'Answer the agent — this will unblock it…' : 'Write a comment or instruction (Markdown)…'} value={body}
          onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post(); }} />
        <button className="btn primary" onClick={post} disabled={!body.trim()}>{waiting ? 'Answer' : 'Comment'}</button>
      </div>
    </div>
  );
}

function Runs({ card }: { card: CardDetail }) {
  const { data: agents } = useAgents();
  if (!card.runs.length) return <div className="muted small pad-y">No agent runs yet. A run starts when an agent claims this card.</div>;
  return (
    <table className="table">
      <thead><tr><th>Agent</th><th>Status</th><th>Started</th><th>Duration</th><th>Tokens</th><th>Cost</th></tr></thead>
      <tbody>
        {card.runs.map((r) => {
          const a = agents?.find((x) => x.id === r.agentId);
          const dur = r.endedAt ? Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null;
          return (
            <tr key={r.id} title={r.summary}>
              <td>{a ? `${a.avatar} ${a.name}` : '—'}</td>
              <td><span className={`run run-${r.status}`}>{r.status}</span></td>
              <td>{timeAgo(r.startedAt)}</td>
              <td>{dur === null ? '…' : dur < 60 ? `${dur}s` : `${Math.round(dur / 60)}m`}</td>
              <td>{(r.tokensIn + r.tokensOut).toLocaleString()}</td>
              <td>${r.costUsd.toFixed(3)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function describe(action: string, data: Record<string, unknown>): string {
  const d = data as any;
  switch (action) {
    case 'card.created': return `created "${d.title}" in ${d.column}`;
    case 'card.moved': return `moved "${d.title ?? 'card'}" from ${d.from} → ${d.to}`;
    case 'card.updated': return `updated ${Object.keys(d).join(', ') || 'card'}${d.assignee ? ` (assigned to ${d.assignee})` : ''}`;
    case 'card.claimed': return `claimed "${d.title}"`;
    case 'card.completed': return `completed "${d.title}"${d.to ? ` → ${d.to}` : ''}`;
    case 'card.failed': return `failed on "${d.title}": ${d.error}${d.retry ? ' (will retry)' : ''}`;
    case 'card.question': return `asked: "${d.question}"`;
    case 'card.deleted': return `deleted #${d.number} "${d.title}"`;
    case 'comment.created': return d.kind === 'comment' ? `commented: "${d.excerpt}"` : `posted ${d.kind}: "${d.excerpt}"`;
    case 'checklist.done': return `checked off "${d.text}"`;
    case 'board.created': return `created board ${d.name}`;
    case 'board.updated': return 'updated the board';
    case 'board.deleted': return `deleted board ${d.name}`;
    case 'column.created': return `added column ${d.name}`;
    case 'column.deleted': return `removed column ${d.name}`;
    case 'agent.created': return `created agent ${d.name}`;
    case 'agent.updated': return 'updated an agent';
    case 'agent.deleted': return `deleted agent ${d.name}`;
    case 'agent.key_rotated': return 'rotated an agent API key';
    case 'webhook.failed': return `webhook failed (${d.event}): ${d.error}`;
    default: return action;
  }
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}
