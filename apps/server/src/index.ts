import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { db } from './db.js';
import { authenticate, seedAdmin } from './auth.js';
import { emit, logActivity } from './events.js';
import { createCard, BOARD_TEMPLATES, releaseAgent } from './services.js';
import { HttpError, id, now } from './util.js';
import boardRoutes from './routes/boards.js';
import cardRoutes from './routes/cards.js';
import agentRoutes from './routes/agents.js';
import miscRoutes from './routes/misc.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, disableRequestLogging: process.env.LOG_REQUESTS !== '1', bodyLimit: 5 * 1024 * 1024, trustProxy: true });

await app.register(cors, {
  origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
});

app.setErrorHandler((err: any, _req, reply) => {
  const status = err instanceof HttpError ? err.statusCode : err.statusCode ?? 500;
  if (status >= 500) app.log.error(err);
  reply.status(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
});

await app.register(async (api) => {
  api.addHook('onRequest', async (req) => {
    if ((req.routeOptions.config as any)?.public) return;
    if (req.method === 'OPTIONS') return;
    const auth = authenticate(req);
    if (!auth) throw new HttpError(401, 'Unauthorized');
    req.auth = auth;
  });
  await api.register(miscRoutes);
  await api.register(boardRoutes);
  await api.register(cardRoutes);
  await api.register(agentRoutes);
  api.setNotFoundHandler((_req, reply) => { reply.status(404).send({ error: 'Not found' }); });
}, { prefix: '/api' });

// ---------- static web app (PWA) ----------
if (fs.existsSync(config.webDir)) {
  await app.register(fastifyStatic, {
    root: config.webDir,
    wildcard: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('.webmanifest')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });
  app.setNotFoundHandler((req, reply) => {
    const pathname = req.url.split('?')[0];
    if (pathname.startsWith('/api') || /\.[a-z0-9]{2,8}$/i.test(pathname) || req.method !== 'GET') {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
  });
} else {
  app.log.warn(`Web app not found at ${config.webDir} — API only mode`);
}

// ---------- first run ----------
if (seedAdmin()) {
  app.log.info(`Created admin user ${config.adminEmail}`);
  if (config.adminPassword === 'changeme') app.log.warn('Default admin password in use — set ADMIN_PASSWORD!');
}
const boardCount = (db.prepare('SELECT COUNT(*) AS n FROM boards').get() as any).n;
if (boardCount === 0) {
  const admin = db.prepare(`SELECT id FROM users ORDER BY created_at LIMIT 1`).get() as any;
  const boardId = id();
  const ts = now();
  db.prepare('INSERT INTO boards (id, name, description, color, icon, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    .run(boardId, 'Agent Operations', 'Work queue for your AI agents', '#6366f1', '🤖', ts, ts);
  const ins = db.prepare('INSERT INTO columns (id, board_id, name, kind, position, wip_limit, color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  BOARD_TEMPLATES.agents.forEach((c, i) => ins.run(id(), boardId, c.name, c.kind, (i + 1) * 1024, null, c.color));
  const actor = { type: 'user' as const, id: admin.id };
  createCard(actor, {
    boardId, title: 'Welcome to Easy Kanban 👋', priority: 'medium', labels: ['getting-started'],
    description: 'This board is your agents\' work queue.\n\n1. Go to **Agents** and create an agent — copy its API key.\n2. Drop cards into **To Do**.\n3. Your agent calls `POST /api/agent/claim` (or the MCP tool `claim_next_card`) to pick up work.\n4. It logs progress, then completes → the card lands in **Review** for you.\n\nSee `docs/AGENTS.md` for full integration examples.',
    checklist: ['Create your first agent', 'Change the admin password', 'Install the app on your phone (Add to Home Screen)'],
  });
  logActivity({ type: 'system', id: null }, 'board.created', { boardId, data: { name: 'Agent Operations' } });
}

// ---------- maintenance ----------
function maintenance() {
  const offlineBefore = new Date(Date.now() - config.agentOfflineMinutes * 60_000).toISOString();
  const r = db.prepare(`UPDATE agents SET status = 'offline' WHERE status IN ('idle','error') AND (last_seen_at IS NULL OR last_seen_at < ?) AND webhook_url = ''`).run(offlineBefore);
  if (Number(r.changes) > 0) emit('agent.updated', { data: {} });
  if (config.staleRunHours > 0) {
    const staleBefore = new Date(Date.now() - config.staleRunHours * 3600_000).toISOString();
    const stale = db.prepare(`SELECT * FROM agent_runs WHERE status = 'running' AND started_at < ?`).all(staleBefore) as any[];
    for (const run of stale) {
      db.prepare(`UPDATE agent_runs SET status = 'failed', summary = 'Timed out (no completion reported)', ended_at = ? WHERE id = ?`).run(now(), run.id);
      releaseAgent(run.agent_id, run.card_id);
    }
  }
  // keep activity/notifications bounded
  db.prepare(`DELETE FROM notifications WHERE created_at < ?`).run(new Date(Date.now() - 30 * 86400_000).toISOString());
}
setInterval(maintenance, 60_000).unref();

const shutdown = async () => { await app.close(); db.close(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
