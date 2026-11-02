import crypto from 'node:crypto';
import type {
  Actor, Agent, AgentRun, Activity, Board, Card, ChecklistItem, Column, Comment, Notification, User,
} from '@easy-kanban/shared';
import { db } from './db.js';

export const id = () => crypto.randomBytes(9).toString('base64url');
export const now = () => new Date().toISOString();

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

const j = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

// ---------- actor name resolution (cached per request burst) ----------
const nameCache = new Map<string, { name: string; at: number }>();
export function actorName(type: string, actorId: string | null): string {
  if (type === 'system' || !actorId) return 'System';
  const key = `${type}:${actorId}`;
  const c = nameCache.get(key);
  if (c && Date.now() - c.at < 10_000) return c.name;
  const table = type === 'agent' ? 'agents' : 'users';
  const r = db.prepare(`SELECT name FROM ${table} WHERE id = ?`).get(actorId) as { name: string } | undefined;
  const name = r?.name ?? (type === 'agent' ? 'Deleted agent' : 'Deleted user');
  nameCache.set(key, { name, at: Date.now() });
  return name;
}
export function clearNameCache() { nameCache.clear(); }
export const mkActor = (type: string, actorId: string | null): Actor => ({ type: type as Actor['type'], id: actorId, name: actorName(type, actorId) });

// ---------- row mappers ----------
export const toUser = (r: any): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at });

export const toBoard = (r: any): Board => ({
  id: r.id, name: r.name, description: r.description, color: r.color, icon: r.icon,
  position: r.position, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
  ...(r.card_count !== undefined ? { cardCount: r.card_count } : {}),
});

export const toColumn = (r: any): Column => ({
  id: r.id, boardId: r.board_id, name: r.name, kind: r.kind, position: r.position,
  wipLimit: r.wip_limit ?? null, color: r.color,
});

export const toCard = (r: any): Card => ({
  id: r.id, number: r.number, boardId: r.board_id, columnId: r.column_id, title: r.title,
  description: r.description, priority: r.priority, labels: j(r.labels, []), dueAt: r.due_at,
  position: r.position, assigneeType: r.assignee_type ?? null, assigneeId: r.assignee_id ?? null,
  progress: r.progress, blocked: !!r.blocked, blockedReason: r.blocked_reason, result: r.result,
  dependsOn: j(r.depends_on, []), archived: !!r.archived,
  createdBy: mkActor(r.created_by_type, r.created_by_id),
  startedAt: r.started_at, completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at,
  checklistTotal: r.checklist_total ?? 0, checklistDone: r.checklist_done ?? 0, commentCount: r.comment_count ?? 0,
});

export const CARD_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id) AS checklist_total,
    (SELECT COUNT(*) FROM checklist_items ci WHERE ci.card_id = c.id AND ci.done = 1) AS checklist_done,
    (SELECT COUNT(*) FROM comments cm WHERE cm.card_id = c.id) AS comment_count
  FROM cards c`;

export function getCardRow(cardId: string): Card | null {
  const r = db.prepare(`${CARD_SELECT} WHERE c.id = ?`).get(cardId);
  return r ? toCard(r) : null;
}

export const toChecklist = (r: any): ChecklistItem => ({ id: r.id, cardId: r.card_id, text: r.text, done: !!r.done, position: r.position });

export const toComment = (r: any): Comment => ({
  id: r.id, cardId: r.card_id, author: mkActor(r.author_type, r.author_id), body: r.body, kind: r.kind, createdAt: r.created_at,
});

export const toAgent = (r: any): Agent => ({
  id: r.id, name: r.name, description: r.description, avatar: r.avatar, color: r.color, runtime: r.runtime,
  model: r.model, status: r.status, statusNote: r.status_note, capabilities: j(r.capabilities, []),
  boardIds: j(r.board_ids, []), autoClaim: !!r.auto_claim, maxConcurrent: r.max_concurrent,
  webhookUrl: r.webhook_url, enabled: !!r.enabled, apiKeyPrefix: r.api_key_prefix, lastSeenAt: r.last_seen_at,
  currentCardId: r.current_card_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const toRun = (r: any): AgentRun => ({
  id: r.id, agentId: r.agent_id, cardId: r.card_id, status: r.status, summary: r.summary, tokensIn: r.tokens_in,
  tokensOut: r.tokens_out, costUsd: r.cost_usd, startedAt: r.started_at, endedAt: r.ended_at,
});

export const toActivity = (r: any): Activity => ({
  id: r.id, boardId: r.board_id, cardId: r.card_id, actor: mkActor(r.actor_type, r.actor_id), action: r.action,
  data: j(r.data, {}), createdAt: r.created_at,
});

export const toNotification = (r: any): Notification => ({
  id: r.id, activityId: r.activity_id, title: r.title, body: r.body, boardId: r.board_id, cardId: r.card_id,
  read: !!r.read, createdAt: r.created_at,
});

// ---------- small validators ----------
export function str(v: unknown, field: string, { max = 10_000, required = false } = {}): string | undefined {
  if (v === undefined || v === null) {
    if (required) throw badRequest(`${field} is required`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`${field} must be a string`);
  const s = v.trim();
  if (required && !s) throw badRequest(`${field} is required`);
  if (s.length > max) throw badRequest(`${field} is too long (max ${max})`);
  return s;
}
export function strArr(v: unknown, field: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${field} must be an array of strings`);
  return [...new Set(v.map((x: string) => x.trim()).filter(Boolean))];
}
export function oneOf<T extends string>(v: unknown, allowed: readonly T[], field: string): T | undefined {
  if (v === undefined || v === null) return undefined;
  if (!allowed.includes(v as T)) throw badRequest(`${field} must be one of ${allowed.join(', ')}`);
  return v as T;
}
export function num(v: unknown, field: string, { min = -Infinity, max = Infinity } = {}): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${field} must be a number between ${min} and ${max}`);
  return n;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
