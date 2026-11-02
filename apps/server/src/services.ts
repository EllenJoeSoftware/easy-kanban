// Core domain operations shared by human-facing and agent-facing routes.
import type { Card, ColumnKind, CreateCardInput, Priority } from '@easy-kanban/shared';
import { PRIORITIES } from '@easy-kanban/shared';
import { db, tx } from './db.js';
import type { AuthContext } from './auth.js';
import { emit, logActivity, notify, webhookForCard } from './events.js';
import {
  badRequest, getCardRow, id, notFound, now, oneOf, str, strArr, num, toColumn, toRun, actorName,
} from './util.js';

type Actor = Pick<AuthContext, 'type' | 'id'>;

export const BOARD_TEMPLATES: Record<string, { name: string; kind: ColumnKind; color: string; wip?: number }[]> = {
  agents: [
    { name: 'Backlog', kind: 'backlog', color: '#64748b' },
    { name: 'To Do', kind: 'todo', color: '#3b82f6' },
    { name: 'In Progress', kind: 'in_progress', color: '#f59e0b' },
    { name: 'Review', kind: 'review', color: '#a855f7' },
    { name: 'Done', kind: 'done', color: '#22c55e' },
  ],
  simple: [
    { name: 'To Do', kind: 'todo', color: '#3b82f6' },
    { name: 'Doing', kind: 'in_progress', color: '#f59e0b' },
    { name: 'Done', kind: 'done', color: '#22c55e' },
  ],
  empty: [],
};

export function getColumn(columnId: string) {
  const r = db.prepare('SELECT * FROM columns WHERE id = ?').get(columnId);
  if (!r) throw notFound('Column not found');
  return toColumn(r);
}

export function firstColumnOfKind(boardId: string, kinds: ColumnKind[]) {
  for (const k of kinds) {
    const r = db.prepare('SELECT * FROM columns WHERE board_id = ? AND kind = ? ORDER BY position LIMIT 1').get(boardId, k);
    if (r) return toColumn(r);
  }
  return null;
}

export function requireCard(cardId: string): Card {
  const c = getCardRow(cardId);
  if (!c) throw notFound('Card not found');
  return c;
}

function assertAssignee(type: unknown, assigneeId: unknown) {
  if (type === null || type === undefined) return;
  if (type === 'agent') {
    if (!db.prepare('SELECT 1 FROM agents WHERE id = ?').get(assigneeId as string)) throw badRequest('Assignee agent not found');
  } else if (type === 'user') {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(assigneeId as string)) throw badRequest('Assignee user not found');
  } else throw badRequest('assigneeType must be agent, user or null');
}

/** Position for inserting at `index` in a column (excluding `excludeId`). */
function positionAt(columnId: string, index: number | undefined, excludeId?: string): number {
  const rows = db.prepare('SELECT id, position FROM cards WHERE column_id = ? AND archived = 0 AND id != ? ORDER BY position')
    .all(columnId, excludeId ?? '') as { id: string; position: number }[];
  if (index === undefined || index >= rows.length) return rows.length ? rows[rows.length - 1].position + 1024 : 1024;
  if (index <= 0) return rows.length ? rows[0].position - 1024 : 1024;
  const before = rows[index - 1].position, after = rows[index].position;
  if (after - before < 1e-6) {
    // Renormalise the column and retry.
    const upd = db.prepare('UPDATE cards SET position = ? WHERE id = ?');
    rows.forEach((r, i) => upd.run((i + 1) * 1024, r.id));
    return (index) * 1024 + 512;
  }
  return (before + after) / 2;
}

/** Apply column-kind side effects (timestamps / progress) when a card lands in a column. */
function columnSideEffects(kind: ColumnKind, card: Card): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  if (kind === 'in_progress' && !card.startedAt) s.started_at = now();
  if (kind === 'done') { if (!card.completedAt) s.completed_at = now(); s.progress = 100; }
  if (kind !== 'done' && card.completedAt) s.completed_at = null;
  return s;
}

function updateCardRaw(cardId: string, fields: Record<string, unknown>) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  fields.updated_at = now();
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE cards SET ${sets} WHERE id = ?`).run(...(Object.values(fields) as any[]), cardId);
}

export function createCard(actor: Actor, input: CreateCardInput): Card {
  const title = str(input.title, 'title', { required: true, max: 300 })!;
  const board = db.prepare('SELECT id FROM boards WHERE id = ?').get(input.boardId ?? '');
  if (!board) throw badRequest('boardId is invalid');
  let columnId = input.columnId;
  if (columnId) {
    const col = getColumn(columnId);
    if (col.boardId !== input.boardId) throw badRequest('Column does not belong to board');
  } else {
    const col = firstColumnOfKind(input.boardId, ['todo', 'backlog', 'custom', 'in_progress', 'review', 'done']);
    if (!col) throw badRequest('Board has no columns');
    columnId = col.id;
  }
  assertAssignee(input.assigneeType ?? null, input.assigneeId);
  const priority = oneOf(input.priority, PRIORITIES, 'priority') ?? 'medium';
  const labels = strArr(input.labels, 'labels') ?? [];
  const dependsOn = strArr(input.dependsOn, 'dependsOn') ?? [];
  const checklist = strArr(input.checklist, 'checklist') ?? [];
  const cardId = id();
  return tx(() => {
    const number = ((db.prepare('SELECT MAX(number) AS n FROM cards').get() as any).n ?? 0) + 1;
    const ts = now();
    db.prepare(`INSERT INTO cards (id, number, board_id, column_id, title, description, priority, labels, due_at, position,
      assignee_type, assignee_id, depends_on, created_by_type, created_by_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      cardId, number, input.boardId, columnId!, title, str(input.description, 'description', { max: 100_000 }) ?? '',
      priority, JSON.stringify(labels), input.dueAt ?? null, positionAt(columnId!, undefined),
      input.assigneeType ?? null, input.assigneeType ? input.assigneeId ?? null : null, JSON.stringify(dependsOn),
      actor.type, actor.id, ts, ts,
    );
    const ins = db.prepare('INSERT INTO checklist_items (id, card_id, text, done, position) VALUES (?, ?, ?, 0, ?)');
    checklist.forEach((t, i) => ins.run(id(), cardId, t, (i + 1) * 1024));
    const col = getColumn(columnId!);
    const fx = columnSideEffects(col.kind, getCardRow(cardId)!);
    if (Object.keys(fx).length) updateCardRaw(cardId, fx);
    logActivity(actor, 'card.created', { boardId: input.boardId, cardId, data: { title, column: col.name } });
    const card = getCardRow(cardId)!;
    emit('card.created', { boardId: card.boardId, cardId, data: card });
    if (card.assigneeType === 'agent') queueMicrotask(() => webhookForCard(cardId, 'card.assigned'));
    return card;
  });
}

export function updateCard(actor: Actor, cardId: string, input: Record<string, unknown>): Card {
  const card = requireCard(cardId);
  const f: Record<string, unknown> = {};
  const changes: Record<string, unknown> = {};
  if ('title' in input) f.title = str(input.title, 'title', { required: true, max: 300 });
  if ('description' in input) f.description = str(input.description, 'description', { max: 100_000 }) ?? '';
  if ('priority' in input) f.priority = oneOf(input.priority, PRIORITIES, 'priority') as Priority;
  if ('labels' in input) f.labels = JSON.stringify(strArr(input.labels, 'labels') ?? []);
  if ('dueAt' in input) f.due_at = input.dueAt ? String(input.dueAt) : null;
  if ('progress' in input) f.progress = Math.round(num(input.progress, 'progress', { min: 0, max: 100 }) ?? 0);
  if ('blocked' in input) f.blocked = input.blocked ? 1 : 0;
  if ('blockedReason' in input) f.blocked_reason = str(input.blockedReason, 'blockedReason', { max: 2000 }) ?? '';
  if ('result' in input) f.result = str(input.result, 'result', { max: 200_000 }) ?? '';
  if ('dependsOn' in input) f.depends_on = JSON.stringify((strArr(input.dependsOn, 'dependsOn') ?? []).filter((d) => d !== cardId));
  if ('archived' in input) f.archived = input.archived ? 1 : 0;
  let reassignedToAgent = false;
  if ('assigneeType' in input || 'assigneeId' in input) {
    const type = (input.assigneeType ?? null) as Card['assigneeType'];
    const aid = type ? (input.assigneeId as string) ?? null : null;
    assertAssignee(type, aid);
    f.assignee_type = type;
    f.assignee_id = aid;
    if (type !== card.assigneeType || aid !== card.assigneeId) {
      changes.assignee = type ? actorName(type, aid) : null;
      reassignedToAgent = type === 'agent';
    }
  }
  if (f.blocked === 0) f.blocked_reason = '';
  for (const k of ['title', 'priority', 'progress', 'blocked', 'archived', 'due_at'] as const) if (k in f) changes[k] = f[k];
  updateCardRaw(cardId, f);
  const updated = getCardRow(cardId)!;
  if (Object.keys(f).length) {
    logActivity(actor, 'card.updated', { boardId: card.boardId, cardId, data: changes });
    emit('card.updated', { boardId: card.boardId, cardId, data: updated });
    if (reassignedToAgent) webhookForCard(cardId, 'card.assigned');
    else if (actor.type === 'user' && updated.assigneeType === 'agent') webhookForCard(cardId, 'card.updated', { changes });
  }
  return updated;
}

export function moveCard(actor: Actor, cardId: string, columnId: string, index?: number): Card {
  const card = requireCard(cardId);
  const col = getColumn(columnId);
  if (col.boardId !== card.boardId) throw badRequest('Cannot move a card to another board column');
  return tx(() => {
    const from = getColumn(card.columnId);
    const fx = columnSideEffects(col.kind, card);
    updateCardRaw(cardId, { column_id: columnId, position: positionAt(columnId, index, cardId), ...fx });
    const moved = getCardRow(cardId)!;
    if (from.id !== col.id) {
      logActivity(actor, 'card.moved', { boardId: card.boardId, cardId, data: { from: from.name, to: col.name, title: card.title } });
      if (actor.type === 'user') webhookForCard(cardId, 'card.moved', { from: from.name, to: col.name, toKind: col.kind });
      // Close any running run if a human moves the card to done / back to todo
      if (col.kind === 'done' || col.kind === 'todo' || col.kind === 'backlog') {
        const r = db.prepare(`SELECT * FROM agent_runs WHERE card_id = ? AND status = 'running'`).all(cardId) as any[];
        for (const run of r) {
          db.prepare(`UPDATE agent_runs SET status = ?, ended_at = ? WHERE id = ?`).run(col.kind === 'done' ? 'succeeded' : 'cancelled', now(), run.id);
          releaseAgent(run.agent_id, cardId);
        }
      }
    }
    emit('card.moved', { boardId: card.boardId, cardId, data: moved });
    return moved;
  });
}

export function addComment(actor: Actor, cardId: string, body: string, kind: string = 'comment') {
  const card = requireCard(cardId);
  const text = str(body, 'body', { required: true, max: 200_000 })!;
  const k = oneOf(kind, ['comment', 'log', 'result', 'error', 'question', 'system'] as const, 'kind') ?? 'comment';
  const cid = id();
  db.prepare('INSERT INTO comments (id, card_id, author_type, author_id, body, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(cid, cardId, actor.type, actor.id, text, k, now());
  db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), cardId);
  if (k !== 'log') logActivity(actor, 'comment.created', { boardId: card.boardId, cardId, data: { kind: k, excerpt: text.slice(0, 140) } });
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(cid);
  emit('comment.created', { boardId: card.boardId, cardId, data: comment });
  if (actor.type === 'user' && card.assigneeType === 'agent') {
    // A human reply unblocks an agent that was waiting on a question.
    if (card.blocked && card.blockedReason.startsWith('Waiting for answer')) {
      updateCardRaw(cardId, { blocked: 0, blocked_reason: '' });
      db.prepare(`UPDATE agents SET status = 'working', status_note = '' WHERE id = ? AND status = 'waiting'`).run(card.assigneeId);
      emit('agent.updated', { data: { id: card.assigneeId } });
      emit('card.updated', { boardId: card.boardId, cardId, data: getCardRow(cardId) });
    }
    webhookForCard(cardId, 'comment.created', { comment: { body: text, kind: k, author: actorName('user', actor.id) } });
  }
  return comment;
}

/** Clear an agent's current card and set it idle if it has nothing else running. */
export function releaseAgent(agentId: string, cardId: string) {
  const running = db.prepare(`SELECT card_id FROM agent_runs WHERE agent_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`).get(agentId) as any;
  db.prepare(`UPDATE agents SET current_card_id = ?, status = CASE WHEN ? IS NULL AND status IN ('working','waiting') THEN 'idle' ELSE status END, updated_at = ? WHERE id = ?`)
    .run(running?.card_id ?? null, running?.card_id ?? null, now(), agentId);
  emit('agent.updated', { data: { id: agentId, cardId } });
}

const PRIORITY_ORDER = `CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

/** Atomically pick the next card for an agent and move it to In Progress. */
export function claimNext(agentId: string, opts: { boardId?: string; labels?: string[] }) {
  return tx(() => {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) throw notFound('Agent not found');
    if (agent.status === 'paused') return { card: null, run: null, reason: 'Agent is paused' };
    const running = (db.prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ? AND status = 'running'`).get(agentId) as any).n;
    if (running >= agent.max_concurrent) return { card: null, run: null, reason: `Already at max concurrency (${agent.max_concurrent})` };

    const boardIds: string[] = JSON.parse(agent.board_ids || '[]');
    const caps: string[] = JSON.parse(agent.capabilities || '[]');
    const params: any[] = [];
    let where = `c.archived = 0 AND c.blocked = 0 AND col.kind = 'todo' AND b.archived = 0`;
    if (opts.boardId) { where += ' AND c.board_id = ?'; params.push(opts.boardId); }
    else if (boardIds.length) { where += ` AND c.board_id IN (${boardIds.map(() => '?').join(',')})`; params.push(...boardIds); }
    where += agent.auto_claim
      ? ` AND ((c.assignee_type = 'agent' AND c.assignee_id = ?) OR c.assignee_type IS NULL)`
      : ` AND (c.assignee_type = 'agent' AND c.assignee_id = ?)`;
    params.push(agentId, agentId);
    const rows = db.prepare(`SELECT c.*, col.kind AS col_kind FROM cards c JOIN columns col ON col.id = c.column_id JOIN boards b ON b.id = c.board_id
      WHERE ${where}
      ORDER BY (COALESCE(c.assignee_id, '') = ?) DESC, ${PRIORITY_ORDER}, COALESCE(c.due_at, '9999') ASC, c.position ASC LIMIT 50`).all(...params) as any[];

    const pick = rows.find((r) => {
      const labels: string[] = JSON.parse(r.labels || '[]');
      if (opts.labels?.length && !labels.some((l) => opts.labels!.includes(l))) return false;
      // Unassigned cards: if the agent declares capabilities, the card needs a matching label.
      if (!r.assignee_id && caps.length && !labels.some((l) => caps.includes(l))) return false;
      const deps: string[] = JSON.parse(r.depends_on || '[]');
      if (deps.length) {
        const open = db.prepare(`SELECT COUNT(*) AS n FROM cards WHERE id IN (${deps.map(() => '?').join(',')}) AND completed_at IS NULL AND archived = 0`).get(...deps) as any;
        if (open.n > 0) return false;
      }
      return true;
    });
    if (!pick) return { card: null, run: null, reason: 'No work available' };

    const inProg = firstColumnOfKind(pick.board_id, ['in_progress']);
    const ts = now();
    const fields: Record<string, unknown> = { assignee_type: 'agent', assignee_id: agentId, started_at: pick.started_at ?? ts };
    if (inProg) { fields.column_id = inProg.id; fields.position = positionAt(inProg.id, undefined, pick.id); }
    updateCardRaw(pick.id, fields);
    const runId = id();
    db.prepare('INSERT INTO agent_runs (id, agent_id, card_id, status, started_at) VALUES (?, ?, ?, ?, ?)').run(runId, agentId, pick.id, 'running', ts);
    db.prepare(`UPDATE agents SET status = 'working', status_note = ?, current_card_id = ?, last_seen_at = ?, updated_at = ? WHERE id = ?`)
      .run(`#${pick.number} ${pick.title}`.slice(0, 200), pick.id, ts, ts, agentId);
    logActivity({ type: 'agent', id: agentId }, 'card.claimed', { boardId: pick.board_id, cardId: pick.id, data: { title: pick.title } });
    const card = getCardRow(pick.id)!;
    emit('card.moved', { boardId: card.boardId, cardId: card.id, data: card });
    emit('agent.updated', { data: { id: agentId } });
    return { card, run: toRun(db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId)), reason: null };
  });
}

function closeRun(agentId: string, cardId: string, status: 'succeeded' | 'failed', summary: string, usage: { tokensIn?: number; tokensOut?: number; costUsd?: number }) {
  let run = db.prepare(`SELECT * FROM agent_runs WHERE agent_id = ? AND card_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`).get(agentId, cardId) as any;
  if (!run) {
    // Agent worked on the card without claiming — record a run anyway.
    const rid = id();
    db.prepare('INSERT INTO agent_runs (id, agent_id, card_id, status, started_at) VALUES (?, ?, ?, ?, ?)').run(rid, agentId, cardId, 'running', now());
    run = { id: rid };
  }
  db.prepare('UPDATE agent_runs SET status = ?, summary = ?, tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, cost_usd = cost_usd + ?, ended_at = ? WHERE id = ?')
    .run(status, summary.slice(0, 2000), Math.round(usage.tokensIn ?? 0), Math.round(usage.tokensOut ?? 0), usage.costUsd ?? 0, now(), run.id);
}

export function agentComplete(agentId: string, cardId: string, input: { result?: string; moveTo?: 'review' | 'done'; tokensIn?: number; tokensOut?: number; costUsd?: number }) {
  const card = requireCard(cardId);
  return tx(() => {
    const result = str(input.result, 'result', { max: 200_000 }) ?? '';
    const target = firstColumnOfKind(card.boardId, input.moveTo === 'done' ? ['done'] : ['review', 'done']);
    closeRun(agentId, cardId, 'succeeded', result, input);
    const f: Record<string, unknown> = { result: result || card.result, progress: 100, blocked: 0, blocked_reason: '' };
    updateCardRaw(cardId, f);
    if (result) addComment({ type: 'agent', id: agentId }, cardId, result, 'result');
    if (target && target.id !== card.columnId) moveCard({ type: 'agent', id: agentId }, cardId, target.id);
    releaseAgent(agentId, cardId);
    const aid = logActivity({ type: 'agent', id: agentId }, 'card.completed', { boardId: card.boardId, cardId, data: { title: card.title, to: target?.name } });
    notify(aid, `${actorName('agent', agentId)} finished #${card.number}`, target?.kind === 'review' ? `"${card.title}" is ready for review` : `"${card.title}" is done`, { boardId: card.boardId, cardId });
    const updated = getCardRow(cardId)!;
    emit('card.updated', { boardId: card.boardId, cardId, data: updated });
    return updated;
  });
}

export function agentFail(agentId: string, cardId: string, input: { error?: string; retry?: boolean; tokensIn?: number; tokensOut?: number; costUsd?: number }) {
  const card = requireCard(cardId);
  const error = str(input.error, 'error', { required: true, max: 20_000 })!;
  return tx(() => {
    closeRun(agentId, cardId, 'failed', error, input);
    addComment({ type: 'agent', id: agentId }, cardId, error, 'error');
    if (input.retry) {
      const todo = firstColumnOfKind(card.boardId, ['todo']);
      if (todo) moveCard({ type: 'agent', id: agentId }, cardId, todo.id, 0);
    } else {
      updateCardRaw(cardId, { blocked: 1, blocked_reason: error.slice(0, 500) });
    }
    releaseAgent(agentId, cardId);
    if (!input.retry) db.prepare(`UPDATE agents SET status = 'error', status_note = ? WHERE id = ?`).run(error.slice(0, 200), agentId);
    const aid = logActivity({ type: 'agent', id: agentId }, 'card.failed', { boardId: card.boardId, cardId, data: { title: card.title, error: error.slice(0, 300), retry: !!input.retry } });
    notify(aid, `${actorName('agent', agentId)} failed on #${card.number}`, error.slice(0, 200), { boardId: card.boardId, cardId });
    const updated = getCardRow(cardId)!;
    emit('card.updated', { boardId: card.boardId, cardId, data: updated });
    emit('agent.updated', { data: { id: agentId } });
    return updated;
  });
}

export function agentAsk(agentId: string, cardId: string, question: string) {
  const card = requireCard(cardId);
  const q = str(question, 'question', { required: true, max: 20_000 })!;
  return tx(() => {
    addComment({ type: 'agent', id: agentId }, cardId, q, 'question');
    updateCardRaw(cardId, { blocked: 1, blocked_reason: `Waiting for answer: ${q.slice(0, 200)}` });
    db.prepare(`UPDATE agents SET status = 'waiting', status_note = ? WHERE id = ?`).run(`Question on #${card.number}`, agentId);
    const aid = logActivity({ type: 'agent', id: agentId }, 'card.question', { boardId: card.boardId, cardId, data: { title: card.title, question: q.slice(0, 300) } });
    notify(aid, `${actorName('agent', agentId)} has a question on #${card.number}`, q.slice(0, 200), { boardId: card.boardId, cardId });
    const updated = getCardRow(cardId)!;
    emit('card.updated', { boardId: card.boardId, cardId, data: updated });
    emit('agent.updated', { data: { id: agentId } });
    return updated;
  });
}
