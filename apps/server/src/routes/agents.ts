import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Agent, AgentStats } from '@easy-kanban/shared';
import { AGENT_STATUSES } from '@easy-kanban/shared';
import { db } from '../db.js';
import { newApiKey, requireAgent, requireUser } from '../auth.js';
import { emit, logActivity, sendWebhook } from '../events.js';
import { addComment, agentAsk, agentComplete, agentFail, claimNext, requireCard, updateCard } from '../services.js';
import {
  CARD_SELECT, badRequest, clearNameCache, forbidden, getCardRow, id, notFound, now, num, oneOf, str, strArr,
  toAgent, toCard, toComment, toRun,
} from '../util.js';

function agentStats(agentId: string): AgentStats {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const q = (sql: string, ...p: any[]) => (db.prepare(sql).get(...p) as any) ?? {};
  return {
    assigned: q(`SELECT COUNT(*) AS n FROM cards c JOIN columns col ON col.id = c.column_id WHERE c.assignee_type='agent' AND c.assignee_id = ? AND c.archived = 0 AND col.kind != 'done'`, agentId).n ?? 0,
    inProgress: q(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ? AND status = 'running'`, agentId).n ?? 0,
    completed7d: q(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ? AND status = 'succeeded' AND ended_at >= ?`, agentId, since).n ?? 0,
    failed7d: q(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ? AND status = 'failed' AND ended_at >= ?`, agentId, since).n ?? 0,
    totalRuns: q(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ?`, agentId).n ?? 0,
    costUsd7d: Math.round((q(`SELECT SUM(cost_usd) AS s FROM agent_runs WHERE agent_id = ? AND started_at >= ?`, agentId, since).s ?? 0) * 10000) / 10000,
  };
}

function getAgent(agentId: string, withStats = true): Agent {
  const r = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!r) throw notFound('Agent not found');
  const a = toAgent(r);
  return withStats ? { ...a, stats: agentStats(a.id) } : a;
}

function agentFields(body: any, partial: boolean) {
  const f: Record<string, unknown> = {};
  if (!partial || 'name' in body) f.name = str(body.name, 'name', { required: true, max: 80 });
  if ('description' in body) f.description = str(body.description, 'description', { max: 4000 }) ?? '';
  if ('avatar' in body) f.avatar = str(body.avatar, 'avatar', { max: 16 }) || '🤖';
  if ('color' in body) f.color = str(body.color, 'color', { max: 20 }) || '#22c55e';
  if ('runtime' in body) f.runtime = str(body.runtime, 'runtime', { max: 40 }) || 'custom';
  if ('model' in body) f.model = str(body.model, 'model', { max: 120 }) ?? '';
  if ('capabilities' in body) f.capabilities = JSON.stringify(strArr(body.capabilities, 'capabilities') ?? []);
  if ('boardIds' in body) f.board_ids = JSON.stringify(strArr(body.boardIds, 'boardIds') ?? []);
  if ('autoClaim' in body) f.auto_claim = body.autoClaim ? 1 : 0;
  if ('maxConcurrent' in body) f.max_concurrent = Math.round(num(body.maxConcurrent, 'maxConcurrent', { min: 1, max: 50 })!);
  if ('webhookUrl' in body) {
    const u = str(body.webhookUrl, 'webhookUrl', { max: 1000 }) ?? '';
    if (u && !/^https?:\/\//i.test(u)) throw badRequest('webhookUrl must start with http:// or https://');
    f.webhook_url = u;
  }
  if ('enabled' in body) f.enabled = body.enabled ? 1 : 0;
  if ('status' in body) f.status = oneOf(body.status, AGENT_STATUSES, 'status');
  if ('statusNote' in body) f.status_note = str(body.statusNote, 'statusNote', { max: 500 }) ?? '';
  return f;
}

export default async function agentRoutes(app: FastifyInstance) {
  // ======== Management (human) ========
  app.get('/agents', async () =>
    (db.prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE').all()).map((r) => {
      const a = toAgent(r);
      return { ...a, stats: agentStats(a.id) };
    }));

  app.get('/agents/:id', async (req) => getAgent((req.params as any).id));

  app.post('/agents', async (req) => {
    const auth = requireUser(req);
    const f = agentFields(req.body ?? {}, false);
    const { key, hash, prefix } = newApiKey();
    const secret = crypto.randomBytes(24).toString('base64url');
    const aid = id();
    const ts = now();
    const cols = { id: aid, api_key_hash: hash, api_key_prefix: prefix, webhook_secret: secret, created_at: ts, updated_at: ts, ...f };
    db.prepare(`INSERT INTO agents (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).run(...(Object.values(cols) as any[]));
    logActivity(auth, 'agent.created', { data: { agentId: aid, name: f.name } });
    const agent = getAgent(aid);
    emit('agent.created', { data: agent });
    return { ...agent, apiKey: key, webhookSecret: secret };
  });

  app.patch('/agents/:id', async (req) => {
    const agentId = (req.params as any).id;
    // Agents may update their own status fields; humans may update anything.
    if (req.auth!.type === 'agent' && req.auth!.id !== agentId) throw forbidden();
    getAgent(agentId, false);
    const body = (req.body ?? {}) as any;
    if (req.auth!.type === 'agent') for (const k of Object.keys(body)) if (!['status', 'statusNote'].includes(k)) delete body[k];
    const f = agentFields(body, true);
    if (!Object.keys(f).length) throw badRequest('Nothing to update');
    f.updated_at = now();
    db.prepare(`UPDATE agents SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(f) as any[]), agentId);
    clearNameCache();
    if (req.auth!.type === 'user') logActivity(req.auth!, 'agent.updated', { data: { agentId, fields: Object.keys(f).filter((k) => k !== 'updated_at') } });
    const agent = getAgent(agentId);
    emit('agent.updated', { data: agent });
    return agent;
  });

  app.delete('/agents/:id', async (req) => {
    const auth = requireUser(req);
    const a = getAgent((req.params as any).id, false);
    db.prepare(`UPDATE cards SET assignee_type = NULL, assignee_id = NULL WHERE assignee_type = 'agent' AND assignee_id = ?`).run(a.id);
    db.prepare('DELETE FROM agents WHERE id = ?').run(a.id);
    logActivity(auth, 'agent.deleted', { data: { name: a.name } });
    emit('agent.deleted', { data: { id: a.id } });
    return { ok: true };
  });

  app.post('/agents/:id/rotate-key', async (req) => {
    const auth = requireUser(req);
    const a = getAgent((req.params as any).id, false);
    const { key, hash, prefix } = newApiKey();
    const secret = crypto.randomBytes(24).toString('base64url');
    db.prepare('UPDATE agents SET api_key_hash = ?, api_key_prefix = ?, webhook_secret = ?, updated_at = ? WHERE id = ?').run(hash, prefix, secret, now(), a.id);
    logActivity(auth, 'agent.key_rotated', { data: { agentId: a.id } });
    return { ...getAgent(a.id), apiKey: key, webhookSecret: secret };
  });

  app.get('/agents/:id/runs', async (req) => {
    const q = req.query as any;
    const limit = Math.min(Number(q.limit ?? 50), 500);
    return db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC LIMIT ?').all((req.params as any).id, limit).map(toRun);
  });

  /** Send a test/wake-up webhook to the agent, optionally about a card. */
  app.post('/agents/:id/ping', async (req) => {
    requireUser(req);
    const a = getAgent((req.params as any).id, false);
    const cardId = (req.body as any)?.cardId;
    const card = cardId ? getCardRow(cardId) : null;
    return sendWebhook(a.id, card ? 'card.assigned' : 'ping', card ? { card } : { message: 'Ping from Easy Kanban' });
  });

  // ======== Agent self-service (agent API key) ========
  app.post('/agent/heartbeat', async (req) => {
    const auth = requireAgent(req);
    const body = (req.body ?? {}) as any;
    const f: Record<string, unknown> = { last_seen_at: now(), updated_at: now() };
    if (body.status) f.status = oneOf(body.status, AGENT_STATUSES, 'status');
    if ('note' in body) f.status_note = str(body.note, 'note', { max: 500 }) ?? '';
    db.prepare(`UPDATE agents SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(Object.values(f) as any[]), auth.id);
    const agent = getAgent(auth.id);
    emit('agent.updated', { data: agent });
    return agent;
  });

  app.get('/agent/cards', async (req) => {
    const auth = requireAgent(req);
    return db.prepare(`${CARD_SELECT} JOIN columns col ON col.id = c.column_id
      WHERE c.assignee_type = 'agent' AND c.assignee_id = ? AND c.archived = 0 AND col.kind != 'done' ORDER BY c.updated_at DESC`).all(auth.id).map(toCard);
  });

  app.post('/agent/claim', async (req) => {
    const auth = requireAgent(req);
    const body = (req.body ?? {}) as any;
    const r = claimNext(auth.id, { boardId: body.boardId, labels: strArr(body.labels, 'labels') });
    if (!r.card) return { card: null, run: null, reason: r.reason };
    const card = r.card;
    return {
      card: {
        ...card,
        checklist: db.prepare('SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position').all(card.id),
        comments: db.prepare('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at').all(card.id).map(toComment),
        runs: [], activity: [],
      },
      run: r.run,
    };
  });

  const ensureMine = (agentId: string, cardId: string) => {
    const c = requireCard(cardId);
    if (c.assigneeType === 'agent' && c.assigneeId && c.assigneeId !== agentId) throw forbidden('Card is assigned to another agent');
    return c;
  };

  app.post('/agent/cards/:id/log', async (req) => {
    const auth = requireAgent(req);
    const cardId = (req.params as any).id;
    ensureMine(auth.id, cardId);
    const body = (req.body ?? {}) as any;
    const c = addComment(auth, cardId, body.message ?? body.body, body.kind ?? 'log');
    if (body.progress !== undefined) updateCard(auth, cardId, { progress: body.progress });
    db.prepare('UPDATE agents SET last_seen_at = ? WHERE id = ?').run(now(), auth.id);
    return toComment(c);
  });

  app.post('/agent/cards/:id/complete', async (req) => {
    const auth = requireAgent(req);
    ensureMine(auth.id, (req.params as any).id);
    return agentComplete(auth.id, (req.params as any).id, (req.body ?? {}) as any);
  });

  app.post('/agent/cards/:id/fail', async (req) => {
    const auth = requireAgent(req);
    ensureMine(auth.id, (req.params as any).id);
    return agentFail(auth.id, (req.params as any).id, (req.body ?? {}) as any);
  });

  app.post('/agent/cards/:id/ask', async (req) => {
    const auth = requireAgent(req);
    ensureMine(auth.id, (req.params as any).id);
    return agentAsk(auth.id, (req.params as any).id, (req.body as any)?.question);
  });
}
