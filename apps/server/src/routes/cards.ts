import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { emit, logActivity } from '../events.js';
import { addComment, createCard, getColumn, moveCard, requireCard, updateCard } from '../services.js';
import {
  CARD_SELECT, badRequest, forbidden, id, notFound, now, num, str, toActivity, toCard, toChecklist, toComment, toRun,
} from '../util.js';

export default async function cardRoutes(app: FastifyInstance) {
  app.get('/cards', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const params: any[] = [];
    if (!q.archived) where.push('c.archived = 0');
    if (q.boardId) { where.push('c.board_id = ?'); params.push(q.boardId); }
    if (q.assigneeId) { where.push('c.assignee_id = ?'); params.push(q.assigneeId); }
    if (q.columnKind) { where.push('c.column_id IN (SELECT id FROM columns WHERE kind = ?)'); params.push(q.columnKind); }
    if (q.label) { where.push('EXISTS (SELECT 1 FROM json_each(c.labels) WHERE value = ?)'); params.push(q.label); }
    if (q.search) {
      const s = q.search.trim();
      if (/^#?\d+$/.test(s)) { where.push('c.number = ?'); params.push(Number(s.replace('#', ''))); }
      else { where.push('(c.title LIKE ? OR c.description LIKE ?)'); params.push(`%${s}%`, `%${s}%`); }
    }
    const limit = Math.min(Number(q.limit ?? 500), 1000);
    return db.prepare(`${CARD_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.updated_at DESC LIMIT ${limit}`)
      .all(...params).map(toCard);
  });

  app.get('/cards/:id', async (req) => {
    const card = requireCard((req.params as any).id);
    return {
      ...card,
      checklist: db.prepare('SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position').all(card.id).map(toChecklist),
      comments: db.prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at').all(card.id).map(toComment),
      runs: db.prepare('SELECT * FROM agent_runs WHERE card_id = ? ORDER BY started_at DESC').all(card.id).map(toRun),
      activity: db.prepare('SELECT * FROM activity WHERE card_id = ? ORDER BY created_at DESC LIMIT 100').all(card.id).map(toActivity),
    };
  });

  app.post('/cards', async (req) => createCard(req.auth!, (req.body ?? {}) as any));

  app.patch('/cards/:id', async (req) => updateCard(req.auth!, (req.params as any).id, (req.body ?? {}) as any));

  app.post('/cards/:id/move', async (req) => {
    const body = (req.body ?? {}) as any;
    if (!body.columnId) throw badRequest('columnId is required');
    return moveCard(req.auth!, (req.params as any).id, body.columnId, body.index === undefined ? undefined : num(body.index, 'index', { min: 0 }));
  });

  app.delete('/cards/:id', async (req) => {
    if (req.auth!.type !== 'user') throw forbidden('Agents cannot delete cards — archive instead');
    const card = requireCard((req.params as any).id);
    db.prepare('DELETE FROM cards WHERE id = ?').run(card.id);
    logActivity(req.auth!, 'card.deleted', { boardId: card.boardId, data: { title: card.title, number: card.number } });
    emit('card.deleted', { boardId: card.boardId, cardId: card.id });
    return { ok: true };
  });

  // ---------- comments ----------
  app.post('/cards/:id/comments', async (req) => {
    const body = (req.body ?? {}) as any;
    return toComment(addComment(req.auth!, (req.params as any).id, body.body, body.kind));
  });

  app.delete('/comments/:id', async (req) => {
    const r = db.prepare('SELECT * FROM comments WHERE id = ?').get((req.params as any).id) as any;
    if (!r) throw notFound('Comment not found');
    if (req.auth!.type !== 'user' && !(r.author_type === 'agent' && r.author_id === req.auth!.id)) throw forbidden();
    db.prepare('DELETE FROM comments WHERE id = ?').run(r.id);
    const card = requireCard(r.card_id);
    emit('card.updated', { boardId: card.boardId, cardId: card.id, data: card });
    return { ok: true };
  });

  // ---------- checklist ----------
  app.post('/cards/:id/checklist', async (req) => {
    const card = requireCard((req.params as any).id);
    const text = str((req.body as any)?.text, 'text', { required: true, max: 500 })!;
    const pos = ((db.prepare('SELECT MAX(position) AS p FROM checklist_items WHERE card_id = ?').get(card.id) as any).p ?? 0) + 1024;
    const cid = id();
    db.prepare('INSERT INTO checklist_items (id, card_id, text, done, position) VALUES (?, ?, ?, 0, ?)').run(cid, card.id, text, pos);
    db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(now(), card.id);
    emit('card.updated', { boardId: card.boardId, cardId: card.id, data: requireCard(card.id) });
    return toChecklist(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(cid));
  });

  app.patch('/checklist/:id', async (req) => {
    const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get((req.params as any).id) as any;
    if (!item) throw notFound('Checklist item not found');
    const body = (req.body ?? {}) as any;
    if ('text' in body) db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(str(body.text, 'text', { required: true, max: 500 })!, item.id);
    if ('done' in body) db.prepare('UPDATE checklist_items SET done = ? WHERE id = ?').run(body.done ? 1 : 0, item.id);
    const card = requireCard(item.card_id);
    if ('done' in body && body.done) logActivity(req.auth!, 'checklist.done', { boardId: card.boardId, cardId: card.id, data: { text: item.text } });
    emit('card.updated', { boardId: card.boardId, cardId: card.id, data: card });
    return toChecklist(db.prepare('SELECT * FROM checklist_items WHERE id = ?').get(item.id));
  });

  app.delete('/checklist/:id', async (req) => {
    const item = db.prepare('SELECT * FROM checklist_items WHERE id = ?').get((req.params as any).id) as any;
    if (!item) throw notFound('Checklist item not found');
    db.prepare('DELETE FROM checklist_items WHERE id = ?').run(item.id);
    const card = requireCard(item.card_id);
    emit('card.updated', { boardId: card.boardId, cardId: card.id, data: card });
    return { ok: true };
  });

  app.get('/labels', async () => {
    const rows = db.prepare(`SELECT DISTINCT j.value AS label FROM cards c, json_each(c.labels) j WHERE c.archived = 0 ORDER BY 1`).all() as any[];
    return rows.map((r) => r.label);
  });

  // Validate column exists helper endpoint (used by clients for quick checks)
  app.get('/columns/:id', async (req) => getColumn((req.params as any).id));
}
