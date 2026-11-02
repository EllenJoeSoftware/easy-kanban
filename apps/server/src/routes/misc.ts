import type { FastifyInstance } from 'fastify';
import type { DashboardStats, KanbanEvent } from '@easy-kanban/shared';
import { db } from '../db.js';
import { hashPassword, requireUser, signToken, verifyPassword } from '../auth.js';
import { bus } from '../events.js';
import { CARD_SELECT, HttpError, badRequest, str, toActivity, toAgent, toCard, toNotification, toUser } from '../util.js';

export default async function miscRoutes(app: FastifyInstance) {
  // ---------- auth ----------
  app.post('/auth/login', { config: { public: true } }, async (req) => {
    const body = (req.body ?? {}) as any;
    const email = str(body.email, 'email', { required: true })!;
    const password = String(body.password ?? '');
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    if (!u || !verifyPassword(password, u.password_hash)) {
      await new Promise((r) => setTimeout(r, 400)); // slow down brute force
      throw new HttpError(401, 'Invalid email or password');
    }
    return { token: signToken(u.id), user: toUser(u) };
  });

  app.get('/auth/me', async (req) => {
    const a = req.auth!;
    if (a.type === 'user') return { user: toUser(db.prepare('SELECT * FROM users WHERE id = ?').get(a.id)) };
    return { agent: toAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(a.id)) };
  });

  app.post('/auth/password', async (req) => {
    const auth = requireUser(req);
    const body = (req.body ?? {}) as any;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(auth.id) as any;
    if (!verifyPassword(String(body.currentPassword ?? ''), u.password_hash)) throw badRequest('Current password is incorrect');
    const np = String(body.newPassword ?? '');
    if (np.length < 8) throw badRequest('New password must be at least 8 characters');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(np), auth.id);
    return { ok: true };
  });

  // ---------- realtime (Server-Sent Events) ----------
  app.get('/events', async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': req.headers.origin ?? '*',
    });
    res.write(`retry: 3000\n\n`);
    const send = (ev: KanbanEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
    bus.on('event', send);
    req.raw.on('close', () => { clearInterval(ping); bus.off('event', send); });
  });

  // ---------- activity & notifications ----------
  app.get('/activity', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const where: string[] = [];
    const p: any[] = [];
    if (q.boardId) { where.push('board_id = ?'); p.push(q.boardId); }
    if (q.cardId) { where.push('card_id = ?'); p.push(q.cardId); }
    if (q.agentId) { where.push(`((actor_type = 'agent' AND actor_id = ?) OR json_extract(data, '$.agentId') = ?)`); p.push(q.agentId, q.agentId); }
    if (q.before) { where.push('created_at < ?'); p.push(q.before); }
    const limit = Math.min(Number(q.limit ?? 50), 500);
    return db.prepare(`SELECT * FROM activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit}`).all(...p).map(toActivity);
  });

  app.get('/notifications', async (req) => {
    const q = req.query as any;
    return db.prepare(`SELECT * FROM notifications ${q.unread ? 'WHERE read = 0' : ''} ORDER BY created_at DESC LIMIT 100`).all().map(toNotification);
  });

  app.post('/notifications/read', async (req) => {
    const ids = (req.body as any)?.ids;
    if (Array.isArray(ids) && ids.length) db.prepare(`UPDATE notifications SET read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    else db.prepare('UPDATE notifications SET read = 1').run();
    return { ok: true };
  });

  // ---------- dashboard ----------
  app.get('/dashboard', async (): Promise<DashboardStats> => {
    const since = new Date(Date.now() - 7 * 86400_000).toISOString();
    const n = (sql: string, ...p: any[]) => ((db.prepare(sql).get(...p) as any)?.n ?? 0) as number;
    const statusCounts = Object.fromEntries((db.prepare('SELECT status, COUNT(*) AS n FROM agents WHERE enabled = 1 GROUP BY status').all() as any[]).map((r) => [r.status, r.n]));
    const open = `c.archived = 0 AND col.kind != 'done' AND b.archived = 0`;
    const J = `FROM cards c JOIN columns col ON col.id = c.column_id JOIN boards b ON b.id = c.board_id`;
    const attention = db.prepare(`${CARD_SELECT} JOIN columns col ON col.id = c.column_id JOIN boards b ON b.id = c.board_id
      WHERE ${open} AND (c.blocked = 1 OR col.kind = 'review' OR (c.due_at IS NOT NULL AND c.due_at < ?))
      ORDER BY c.blocked DESC, c.updated_at DESC LIMIT 20`).all(new Date().toISOString()).map(toCard);
    return {
      agents: {
        total: n('SELECT COUNT(*) AS n FROM agents WHERE enabled = 1'),
        working: statusCounts.working ?? 0, idle: statusCounts.idle ?? 0, error: statusCounts.error ?? 0,
        offline: statusCounts.offline ?? 0, paused: statusCounts.paused ?? 0, waiting: statusCounts.waiting ?? 0,
      },
      cards: {
        open: n(`SELECT COUNT(*) AS n ${J} WHERE ${open}`),
        inProgress: n(`SELECT COUNT(*) AS n ${J} WHERE ${open} AND col.kind = 'in_progress'`),
        review: n(`SELECT COUNT(*) AS n ${J} WHERE ${open} AND col.kind = 'review'`),
        blocked: n(`SELECT COUNT(*) AS n ${J} WHERE ${open} AND c.blocked = 1`),
        overdue: n(`SELECT COUNT(*) AS n ${J} WHERE ${open} AND c.due_at IS NOT NULL AND c.due_at < ?`, new Date().toISOString()),
        completed7d: n(`SELECT COUNT(*) AS n FROM cards WHERE completed_at >= ?`, since),
      },
      costUsd7d: Math.round(((db.prepare('SELECT SUM(cost_usd) AS s FROM agent_runs WHERE started_at >= ?').get(since) as any)?.s ?? 0) * 100) / 100,
      needsAttention: attention,
      recentActivity: db.prepare('SELECT * FROM activity ORDER BY created_at DESC LIMIT 25').all().map(toActivity),
    };
  });

  // ---------- backup ----------
  app.get('/export', async (req, reply) => {
    requireUser(req);
    const dump: Record<string, unknown[]> = {};
    for (const t of ['boards', 'columns', 'cards', 'checklist_items', 'comments', 'agents', 'agent_runs', 'activity']) {
      dump[t] = db.prepare(`SELECT * FROM ${t}`).all().map((r: any) => {
        if (t === 'agents') { const { api_key_hash, webhook_secret, ...rest } = r; return rest; }
        return r;
      });
    }
    reply.header('Content-Disposition', `attachment; filename="easy-kanban-export-${new Date().toISOString().slice(0, 10)}.json"`);
    return { version: 1, exportedAt: new Date().toISOString(), ...dump };
  });

  app.get('/health', { config: { public: true } }, async () => ({ ok: true, time: new Date().toISOString() }));
}
