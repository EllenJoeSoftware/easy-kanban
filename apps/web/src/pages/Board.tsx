import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Agent, BoardDetail, Card, Column, Priority } from '@easy-kanban/shared';
import { PRIORITIES, COLUMN_KINDS } from '@easy-kanban/shared';
import { api, timeAgo, useIsMobile } from '../api';
import { useAgents, useBoard, useMoveCard, useInvalidate, showError } from '../queries';
import { AgentAvatar, Empty, Icon, Label, Modal, PriorityBadge, Spinner, PRIORITY_LABEL } from '../ui';

type Items = Record<string, string[]>;

export default function BoardPage() {
  const { boardId } = useParams();
  const { data: board, isLoading, error } = useBoard(boardId);
  const { data: agents } = useAgents();
  const isMobile = useIsMobile();
  const [filters, setFilters] = useState<{ q: string; agent: string; priority: string; label: string }>({ q: '', agent: '', priority: '', label: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [boardSettings, setBoardSettings] = useState(false);

  useEffect(() => { if (boardId) try { localStorage.setItem('ek_last_board', boardId); } catch { /* ignore */ } }, [boardId]);

  if (isLoading) return <div className="center pad"><Spinner /></div>;
  if (error || !board) return <Empty title="Board not found" />;

  const agentMap = new Map((agents ?? []).map((a) => [a.id, a]));
  const labels = [...new Set(board.cards.flatMap((c) => c.labels))].sort();
  const q = filters.q.toLowerCase();
  const visible = (c: Card) =>
    (!q || c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q) || `#${c.number}` === q) &&
    (!filters.agent || (filters.agent === '__none' ? !c.assigneeId : c.assigneeId === filters.agent)) &&
    (!filters.priority || c.priority === filters.priority) &&
    (!filters.label || c.labels.includes(filters.label));
  const activeFilters = [filters.agent, filters.priority, filters.label].filter(Boolean).length;

  return (
    <div className="board-page">
      <div className="board-toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input placeholder="Search cards or #number" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
        </div>
        <button className={`btn ghost ${activeFilters ? 'active' : ''}`} onClick={() => setShowFilters((s) => !s)}>
          <Icon name="filter" size={16} /> {isMobile ? '' : 'Filter'}{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <AgentStrip agents={agents ?? []} board={board} onPick={(id) => setFilters({ ...filters, agent: filters.agent === id ? '' : id })} active={filters.agent} />
        <button className="icon-btn" onClick={() => setBoardSettings(true)} aria-label="Board settings" title="Board settings"><Icon name="settings" /></button>
      </div>
      {showFilters && (
        <div className="filter-bar">
          <select value={filters.agent} onChange={(e) => setFilters({ ...filters, agent: e.target.value })}>
            <option value="">All assignees</option>
            <option value="__none">Unassigned</option>
            {agents?.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
          </select>
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
          <select value={filters.label} onChange={(e) => setFilters({ ...filters, label: e.target.value })}>
            <option value="">All labels</option>
            {labels.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {activeFilters > 0 && <button className="btn ghost" onClick={() => setFilters({ ...filters, agent: '', priority: '', label: '' })}>Clear</button>}
        </div>
      )}
      <BoardColumns board={board} agentMap={agentMap} visible={visible} isMobile={isMobile} filtering={!!(q || activeFilters)} />
      <BoardSettingsModal open={boardSettings} onClose={() => setBoardSettings(false)} board={board} />
    </div>
  );
}

function AgentStrip({ agents, board, onPick, active }: { agents: Agent[]; board: BoardDetail; onPick: (id: string) => void; active: string }) {
  const relevant = agents.filter((a) => a.enabled && (a.boardIds.length === 0 || a.boardIds.includes(board.id)));
  if (!relevant.length) return null;
  return (
    <div className="agent-strip">
      {relevant.slice(0, 8).map((a) => (
        <button key={a.id} className={`agent-chip ${active === a.id ? 'active' : ''}`} onClick={() => onPick(a.id)} title={`${a.name} — ${a.status}${a.statusNote ? `: ${a.statusNote}` : ''}`}>
          <AgentAvatar agent={a} size={26} showStatus />
        </button>
      ))}
    </div>
  );
}

function BoardColumns({ board, agentMap, visible, isMobile, filtering }: { board: BoardDetail; agentMap: Map<string, Agent>; visible: (c: Card) => boolean; isMobile: boolean; filtering: boolean }) {
  const move = useMoveCard(board.id);
  const cardsById = useMemo(() => new Map(board.cards.map((c) => [c.id, c])), [board.cards]);
  const serverItems = useMemo(() => {
    const it: Items = Object.fromEntries(board.columns.map((c) => [c.id, [] as string[]]));
    for (const c of [...board.cards].sort((a, b) => a.position - b.position)) it[c.columnId]?.push(c.id);
    return it;
  }, [board]);
  const [items, setItems] = useState<Items>(serverItems);
  const [activeId, setActiveId] = useState<string | null>(null);
  const startCol = useRef<string | null>(null);
  useEffect(() => { if (!activeId) setItems(serverItems); }, [serverItems, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const findCol = (id: string) => (id in items ? id : Object.keys(items).find((k) => items[k].includes(id)));

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    startCol.current = findCol(String(e.active.id)) ?? null;
  };
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = findCol(String(active.id)), to = findCol(String(over.id));
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const fromItems = prev[from].filter((x) => x !== active.id);
      const toItems = [...prev[to]];
      const overIndex = toItems.indexOf(String(over.id));
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, String(active.id));
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const id = String(active.id);
    setActiveId(null);
    if (!over) { setItems(serverItems); return; }
    const col = findCol(id);
    if (!col) return;
    let list = items[col];
    const overIdx = list.indexOf(String(over.id));
    const curIdx = list.indexOf(id);
    if (overIdx >= 0 && overIdx !== curIdx) {
      list = [...list]; list.splice(curIdx, 1); list.splice(overIdx, 0, id);
      setItems({ ...items, [col]: list });
    }
    const index = list.indexOf(id);
    const card = cardsById.get(id);
    if (card && (card.columnId !== col || serverItems[col].indexOf(id) !== index)) {
      move.mutate({ id, input: { columnId: col, index } });
    }
  };

  const [mobileCol, setMobileCol] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !isMobile) return;
    const w = el.firstElementChild?.getBoundingClientRect().width ?? el.clientWidth;
    setMobileCol(Math.round(el.scrollLeft / (w + 12)));
  };
  const goCol = (i: number) => {
    const el = scroller.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - 12, behavior: 'smooth' });
  };

  if (!board.columns.length) return <Empty title="No columns yet">Open board settings to add columns.</Empty>;
  const activeCard = activeId ? cardsById.get(activeId) : null;

  return (
    <>
      {isMobile && (
        <div className="col-tabs">
          {board.columns.map((c, i) => (
            <button key={c.id} className={`col-tab ${mobileCol === i ? 'active' : ''}`} onClick={() => goCol(i)}>
              <span className="col-dot" style={{ background: c.color || 'var(--muted)' }} />
              {c.name}<span className="col-tab-count">{items[c.id]?.length ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setItems(serverItems); }}>
        <div className="columns" ref={scroller} onScroll={onScroll}>
          {board.columns.map((col) => (
            <ColumnView key={col.id} col={col} ids={items[col.id] ?? []} cardsById={cardsById} agentMap={agentMap} visible={visible} filtering={filtering} boardId={board.id} />
          ))}
        </div>
        <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>
          {activeCard ? <CardTile card={activeCard} agent={activeCard.assigneeId ? agentMap.get(activeCard.assigneeId) : undefined} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}

function ColumnView({ col, ids, cardsById, agentMap, visible, filtering, boardId }: {
  col: Column; ids: string[]; cardsById: Map<string, Card>; agentMap: Map<string, Agent>; visible: (c: Card) => boolean; filtering: boolean; boardId: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const [adding, setAdding] = useState(false);
  const shown = ids.filter((id) => { const c = cardsById.get(id); return c && visible(c); });
  const over = col.wipLimit != null && ids.length > col.wipLimit;
  return (
    <section className={`column ${isOver ? 'is-over' : ''}`}>
      <header className="column-head">
        <span className="col-dot" style={{ background: col.color || 'var(--muted)' }} />
        <span className="column-name">{col.name}</span>
        <span className={`column-count ${over ? 'over' : ''}`}>{ids.length}{col.wipLimit ? `/${col.wipLimit}` : ''}</span>
        {col.kind !== 'custom' && <span className="kind-tag" title="Column role for agents">{col.kind.replace('_', ' ')}</span>}
        <button className="icon-btn sm" onClick={() => setAdding(true)} aria-label={`Add card to ${col.name}`}><Icon name="plus" size={16} /></button>
      </header>
      <div className="column-body" ref={setNodeRef}>
        {adding && <QuickAdd boardId={boardId} columnId={col.id} onDone={() => setAdding(false)} />}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const c = cardsById.get(id);
            if (!c || !visible(c)) return null;
            return <SortableCard key={id} card={c} agent={c.assigneeId ? agentMap.get(c.assigneeId) : undefined} />;
          })}
        </SortableContext>
        {!shown.length && !adding && (
          <button className="column-empty" onClick={() => setAdding(true)}>{filtering ? 'No matching cards' : '+ Add a card'}</button>
        )}
      </div>
    </section>
  );
}

function SortableCard({ card, agent }: { card: Card; agent?: Agent }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }} {...attributes} {...listeners}>
      <CardTile card={card} agent={agent} />
    </div>
  );
}

export function CardTile({ card, agent, overlay }: { card: Card; agent?: Agent; overlay?: boolean }) {
  const [params, setParams] = useSearchParams();
  const open = () => { if (overlay) return; params.set('card', card.id); setParams(params); };
  const overdue = card.dueAt && !card.completedAt && new Date(card.dueAt) < new Date();
  const working = agent && agent.currentCardId === card.id && agent.status === 'working';
  return (
    <article className={`card prio-edge-${card.priority} ${card.blocked ? 'is-blocked' : ''} ${overlay ? 'overlay' : ''}`} onClick={open} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') open(); }}>
      <div className="card-top">
        <span className="card-num">#{card.number}</span>
        {card.priority !== 'medium' && <PriorityBadge p={card.priority as Priority} />}
        {card.blocked && <span className="blocked-tag"><Icon name="alert" size={12} /> {card.blockedReason.startsWith('Waiting for answer') ? 'Needs input' : 'Blocked'}</span>}
      </div>
      <div className="card-title">{card.title}</div>
      {card.labels.length > 0 && <div className="card-labels">{card.labels.slice(0, 4).map((l) => <Label key={l} text={l} />)}</div>}
      {card.progress > 0 && card.progress < 100 && (
        <div className="progress"><div style={{ width: `${card.progress}%` }} /></div>
      )}
      <div className="card-meta">
        {card.checklistTotal > 0 && <span className={card.checklistDone === card.checklistTotal ? 'ok' : ''}><Icon name="checklist" size={13} /> {card.checklistDone}/{card.checklistTotal}</span>}
        {card.commentCount > 0 && <span><Icon name="comment" size={13} /> {card.commentCount}</span>}
        {card.dueAt && <span className={overdue ? 'danger' : ''}><Icon name="clock" size={13} /> {timeAgo(card.dueAt)}</span>}
        {card.dependsOn.length > 0 && <span title="Has dependencies"><Icon name="link" size={13} /> {card.dependsOn.length}</span>}
        <span className="spacer" />
        {working && <span className="working-tag"><span className="pulse" />working</span>}
        {agent && <AgentAvatar agent={agent} size={22} />}
        {card.assigneeType === 'user' && <span className="avatar avatar-user" style={{ width: 22, height: 22, fontSize: 10 }}>Me</span>}
      </div>
    </article>
  );
}

function QuickAdd({ boardId, columnId, onDone }: { boardId: string; columnId: string; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const inv = useInvalidate();
  const submit = async () => {
    const t = title.trim();
    if (!t) return onDone();
    try {
      await api.createCard({ boardId, columnId, title: t });
      setTitle('');
      inv(['board', boardId]);
    } catch (e) { showError(e); }
  };
  return (
    <div className="quick-add">
      <textarea autoFocus rows={2} placeholder="Card title — Enter to add, Esc to cancel" value={title} onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onDone();
        }} />
      <div className="row gap">
        <button className="btn primary sm" onClick={submit}>Add</button>
        <button className="btn ghost sm" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

function BoardSettingsModal({ open, onClose, board }: { open: boolean; onClose: () => void; board: BoardDetail }) {
  const inv = useInvalidate();
  const navigate = useNavigate();
  const [name, setName] = useState(board.name);
  const [icon, setIcon] = useState(board.icon);
  const [color, setColor] = useState(board.color);
  const [description, setDescription] = useState(board.description);
  useEffect(() => { setName(board.name); setIcon(board.icon); setColor(board.color); setDescription(board.description); }, [board, open]);
  const refresh = () => inv(['board', board.id], ['boards']);

  const saveBoard = async () => {
    try { await api.updateBoard(board.id, { name, icon, color, description }); refresh(); onClose(); } catch (e) { showError(e); }
  };
  const updateCol = async (id: string, input: Parameters<typeof api.updateColumn>[1]) => {
    try { await api.updateColumn(id, input); refresh(); } catch (e) { showError(e); }
  };
  const moveCol = async (idx: number, dir: -1 | 1) => {
    const ids = board.columns.map((c) => c.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try { await api.reorderColumns(board.id, ids); refresh(); } catch (e) { showError(e); }
  };
  const deleteCol = async (col: Column) => {
    const count = board.cards.filter((c) => c.columnId === col.id).length;
    const other = board.columns.find((c) => c.id !== col.id);
    if (!confirm(count ? `Delete "${col.name}"? Its ${count} card(s) will move to "${other?.name}".` : `Delete "${col.name}"?`)) return;
    try { await api.deleteColumn(col.id, count ? other?.id : undefined); refresh(); } catch (e) { showError(e); }
  };
  const addCol = async () => {
    try { await api.createColumn(board.id, { name: 'New column', kind: 'custom' }); refresh(); } catch (e) { showError(e); }
  };
  const archive = async () => {
    if (!confirm('Archive this board? You can restore it from Settings.')) return;
    await api.updateBoard(board.id, { archived: true }); inv(['boards']); navigate('/');
  };
  const del = async () => {
    if (prompt(`Type the board name to permanently delete it and all ${board.cards.length} cards:`) !== board.name) return;
    await api.deleteBoard(board.id); inv(['boards']); navigate('/');
  };

  return (
    <Modal open={open} onClose={onClose} title="Board settings" wide footer={<>
      <button className="btn danger ghost" onClick={del}><Icon name="trash" size={16} /> Delete</button>
      <button className="btn ghost" onClick={archive}><Icon name="archive" size={16} /> Archive</button>
      <span className="spacer" />
      <button className="btn primary" onClick={saveBoard}>Save</button>
    </>}>
      <div className="grid-2">
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="row gap">
          <label className="field" style={{ width: 80 }}><span>Icon</span><input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} /></label>
          <label className="field" style={{ width: 80 }}><span>Colour</span><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        </div>
      </div>
      <label className="field"><span>Description</span><input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <h3 className="section-title">Columns</h3>
      <p className="muted small">The <b>role</b> tells agents how to treat a column: they claim from <b>todo</b>, work in <b>in progress</b>, and hand back to <b>review</b>.</p>
      <div className="col-editor">
        {board.columns.map((c, i) => (
          <div key={c.id} className="col-edit-row">
            <input type="color" value={c.color || '#64748b'} onChange={(e) => updateCol(c.id, { color: e.target.value })} aria-label="Colour" />
            <input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && updateCol(c.id, { name: e.target.value })} aria-label="Column name" />
            <select value={c.kind} onChange={(e) => updateCol(c.id, { kind: e.target.value as Column['kind'] })} aria-label="Role">
              {COLUMN_KINDS.map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
            </select>
            <input type="number" min={0} placeholder="WIP" defaultValue={c.wipLimit ?? ''} className="wip" aria-label="WIP limit"
              onBlur={(e) => updateCol(c.id, { wipLimit: e.target.value ? Number(e.target.value) : null })} />
            <button className="icon-btn sm" onClick={() => moveCol(i, -1)} disabled={i === 0} aria-label="Move left">↑</button>
            <button className="icon-btn sm" onClick={() => moveCol(i, 1)} disabled={i === board.columns.length - 1} aria-label="Move right">↓</button>
            <button className="icon-btn sm danger" onClick={() => deleteCol(c)} aria-label="Delete column"><Icon name="trash" size={15} /></button>
          </div>
        ))}
      </div>
      <button className="btn ghost" onClick={addCol}><Icon name="plus" size={16} /> Add column</button>
    </Modal>
  );
}
