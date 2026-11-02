import type { FastifyInstance } from 'fastify';
import { COLUMN_KINDS } from '@easy-kanban/shared';
import { db, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { emit, logActivity } from '../events.js';
import { BOARD_TEMPLATES, getColumn } from '../services.js';
import { CARD_SELECT, badRequest, id, notFound, now, num, oneOf, str, toBoard, toCard, toColumn } from '../util.js';

function boardDetail(boardId: string) {
  const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  if (!b) throw notFound('Board not found');
  const columns = db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(boardId).map(toColumn);
  const cards = db.prepare(`${CARD_SELECT} WHERE c.board_id = ? AND c.archived = 0 ORDER BY c.position`).all(boardId).map(toCard);
  return { ...toBoard(b), columns, cards };
}

export default async function boardRoutes(app: FastifyInstance) {
  app.get('/boards', async (req) => {
    const q = req.query as { archived?: string };
    const rows = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM cards c WHERE c.board_id = b.id AND c.archived = 0) AS card_count
      FROM boards b ${q.archived ? '' : 'WHERE b.archived = 0'} ORDER BY b.position, b.created_at`).all();
    return rows.map(toBoard);
  });

  app.get('/boards/:id', async (req) => boardDetail((req.params as any).id));

  app.post('/boards', async (req) => {
    const auth = requireUser(req);
    const body = (req.body ?? {}) as any;
    const name = str(body.name, 'name', { required: true, max: 120 })!;
    const template = oneOf(body.template, ['agents', 'simple', 'empty'] as const, 'template') ?? 'agents';
    const boardId = id();
    tx(() => {
      const ts = now();
      const pos = ((db.prepare('SELECT MAX(position) AS p FROM boards').get() as any).p ?? 0) + 1;
      db.prepare('INSERT INTO boards (id, name, description, color, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(boardId, name, str(body.description, 'description', { max: 2000 }) ?? '', str(body.color, 'color', { max: 20 }) || '#6366f1',
          str(body.icon, 'icon', { max: 8 }) || '📋', pos, ts, ts);
      const ins = db.prepare('INSERT INTO columns (id, board_id, name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?, ?, ?)');
      BOARD_TEMPLATES[template].forEach((c, i) => ins.run(id(), boardId, c.name, c.kind, (i + 1) * 1024, c.wip ?? null, c.color));
      logActivity(auth, 'board.created', { boardId, data: { name } });
    });
    const detail = boardDetail(boardId);
    emit('board.created', { boardId, data: detail });
    return detail;
  });

  app.patch('/boards/:id', async (req) => {
    const auth = requireUser(req);
    const boardId = (req.params as any).id;
    const body = (req.body ?? {}) as any;
    if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) throw notFound('Board not found');
    const f: Record<string, unknown> = {};
    if ('name' in body) f.name = str(body.name, 'name', { required: true, max: 120 });
    if ('description' in body) f.description = str(body.description, 'description', { max: 2000 }) ?? '';
    if ('color' in body) f.color = str(body.color, 'color', { max: 20 });
    if ('icon' in body) f.icon = str(body.icon, 'icon', { max: 8 });
    if ('archived' in body) f.archived = body.archived ? 1 : 0;
    if ('position' in body) f.position = num(body.position, 'position');
    if (!Object.keys(f).length) throw badRequest('Nothing to update');
    f.updated_at = now();
    db.prepare(`UPDATE boards SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(f) as any[]), boardId);
    logActivity(auth, 'board.updated', { boardId, data: f });
    const b = toBoard(db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId));
    emit('board.updated', { boardId, data: b });
    return b;
  });

  app.delete('/boards/:id', async (req) => {
    const auth = requireUser(req);
    const boardId = (req.params as any).id;
    const b = db.prepare('SELECT name FROM boards WHERE id = ?').get(boardId) as any;
    if (!b) throw notFound('Board not found');
    db.prepare('DELETE FROM boards WHERE id = ?').run(boardId);
    logActivity(auth, 'board.deleted', { data: { name: b.name } });
    emit('board.deleted', { boardId });
    return { ok: true };
  });

  // ---------- columns ----------
  app.post('/boards/:id/columns', async (req) => {
    const auth = requireUser(req);
    const boardId = (req.params as any).id;
    if (!db.prepare('SELECT 1 FROM boards WHERE id = ?').get(boardId)) throw notFound('Board not found');
    const body = (req.body ?? {}) as any;
    const cid = id();
    const pos = body.position ?? (((db.prepare('SELECT MAX(position) AS p FROM columns WHERE board_id = ?').get(boardId) as any).p ?? 0) + 1024);
    db.prepare('INSERT INTO columns (id, board_id, name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      cid, boardId, str(body.name, 'name', { required: true, max: 80 })!, oneOf(body.kind, COLUMN_KINDS, 'kind') ?? 'custom',
      pos, body.wipLimit ? num(body.wipLimit, 'wipLimit', { min: 1, max: 999 })! : null, str(body.color, 'color', { max: 20 }) ?? '',
    );
    const col = getColumn(cid);
    logActivity(auth, 'column.created', { boardId, data: { name: col.name } });
    emit('column.created', { boardId, data: col });
    return col;
  });

  app.patch('/columns/:id', async (req) => {
    requireUser(req);
    const col = getColumn((req.params as any).id);
    const body = (req.body ?? {}) as any;
    const f: Record<string, unknown> = {};
    if ('name' in body) f.name = str(body.name, 'name', { required: true, max: 80 });
    if ('kind' in body) f.kind = oneOf(body.kind, COLUMN_KINDS, 'kind');
    if ('wipLimit' in body) f.wip_limit = body.wipLimit ? num(body.wipLimit, 'wipLimit', { min: 1, max: 999 }) : null;
    if ('color' in body) f.color = str(body.color, 'color', { max: 20 }) ?? '';
    if ('position' in body) f.position = num(body.position, 'position');
    if (!Object.keys(f).length) throw badRequest('Nothing to update');
    db.prepare(`UPDATE columns SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(f) as any[]), col.id);
    const updated = getColumn(col.id);
    emit('column.updated', { boardId: col.boardId, data: updated });
    return updated;
  });

  app.post('/boards/:id/columns/reorder', async (req) => {
    requireUser(req);
    const boardId = (req.params as any).id;
    const ids = (req.body as any)?.columnIds;
    if (!Array.isArray(ids)) throw badRequest('columnIds must be an array');
    tx(() => {
      const upd = db.prepare('UPDATE columns SET position = ? WHERE id = ? AND board_id = ?');
      ids.forEach((cid: string, i: number) => upd.run((i + 1) * 1024, cid, boardId));
    });
    const cols = db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position').all(boardId).map(toColumn);
    emit('column.updated', { boardId, data: cols });
    return cols;
  });

  app.delete('/columns/:id', async (req) => {
    const auth = requireUser(req);
    const col = getColumn((req.params as any).id);
    const moveTo = (req.query as any).moveTo as string | undefined;
    tx(() => {
      const count = (db.prepare('SELECT COUNT(*) AS n FROM cards WHERE column_id = ?').get(col.id) as any).n;
      if (count > 0) {
        if (!moveTo) throw badRequest(`Column has ${count} card(s). Pass ?moveTo=<columnId> to move them first.`);
        const dest = getColumn(moveTo);
        if (dest.boardId !== col.boardId || dest.id === col.id) throw badRequest('Invalid moveTo column');
        db.prepare('UPDATE cards SET column_id = ?, updated_at = ? WHERE column_id = ?').run(dest.id, now(), col.id);
      }
      db.prepare('DELETE FROM columns WHERE id = ?').run(col.id);
    });
    logActivity(auth, 'column.deleted', { boardId: col.boardId, data: { name: col.name } });
    emit('column.deleted', { boardId: col.boardId, data: { id: col.id } });
    return { ok: true };
  });
}
