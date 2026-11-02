import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';
import { HttpError, id, now, sha256, forbidden } from './util.js';

// ---------- passwords (scrypt) ----------
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [, saltB64, hashB64] = stored.split('$');
  if (!saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- JWT (HS256) ----------
function secret(): string {
  if (config.jwtSecret) return config.jwtSecret;
  let s = getSetting('jwt_secret');
  if (!s) {
    s = crypto.randomBytes(48).toString('base64url');
    setSetting('jwt_secret', s);
  }
  return s;
}
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function signToken(userId: string): string {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({ sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + config.tokenTtlDays * 86400 });
  const sig = crypto.createHmac('sha256', secret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expected = crypto.createHmac('sha256', secret()).update(`${h}.${p}`).digest('base64url');
  const a = Buffer.from(s), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload.sub as string;
  } catch { return null; }
}

// ---------- agent API keys ----------
export function newApiKey(): { key: string; hash: string; prefix: string } {
  const key = `ek_${crypto.randomBytes(24).toString('base64url')}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 10) };
}

// ---------- request auth ----------
export interface AuthContext {
  type: 'user' | 'agent';
  id: string;
  name: string;
  role?: 'admin' | 'member';
}

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext }
}

export function authenticate(req: FastifyRequest): AuthContext | null {
  let token = '';
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) token = h.slice(7).trim();
  else if (typeof (req.query as any)?.token === 'string') token = (req.query as any).token;
  else if (typeof req.headers['x-api-key'] === 'string') token = req.headers['x-api-key'] as string;
  if (!token) return null;

  if (token.startsWith('ek_')) {
    const r = db.prepare('SELECT id, name, enabled FROM agents WHERE api_key_hash = ?').get(sha256(token)) as any;
    if (!r) return null;
    if (!r.enabled) throw new HttpError(403, 'Agent is disabled');
    // Any authenticated agent call counts as a sign of life.
    db.prepare(`UPDATE agents SET last_seen_at = ?, status = CASE WHEN status = 'offline' THEN 'idle' ELSE status END WHERE id = ?`).run(now(), r.id);
    return { type: 'agent', id: r.id, name: r.name };
  }
  const userId = verifyToken(token);
  if (!userId) return null;
  const u = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId) as any;
  if (!u) return null;
  return { type: 'user', id: u.id, name: u.name, role: u.role };
}

export function requireUser(req: FastifyRequest): AuthContext {
  if (req.auth?.type !== 'user') throw forbidden('This endpoint requires a user login');
  return req.auth;
}
export function requireAgent(req: FastifyRequest): AuthContext {
  if (req.auth?.type !== 'agent') throw forbidden('This endpoint requires an agent API key');
  return req.auth;
}

export function seedAdmin() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count > 0) return false;
  db.prepare('INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id(), config.adminEmail, config.adminName, hashPassword(config.adminPassword), 'admin', now());
  return true;
}
