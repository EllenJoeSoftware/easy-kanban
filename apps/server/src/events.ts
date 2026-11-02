import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { KanbanEvent } from '@easy-kanban/shared';
import { db } from './db.js';
import type { AuthContext } from './auth.js';
import { getCardRow, id, now, toActivity, toNotification } from './util.js';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emit(type: KanbanEvent['type'], payload: Omit<KanbanEvent, 'type' | 'at'> = {}) {
  const ev: KanbanEvent = { type, at: now(), ...payload };
  bus.emit('event', ev);
}

type ActorLike = Pick<AuthContext, 'type' | 'id'> | { type: 'system'; id: null };

/** Record an activity entry. Returns its id. */
export function logActivity(actor: ActorLike, action: string, opts: { boardId?: string | null; cardId?: string | null; data?: Record<string, unknown> } = {}) {
  const aid = id();
  db.prepare('INSERT INTO activity (id, board_id, card_id, actor_type, actor_id, action, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(aid, opts.boardId ?? null, opts.cardId ?? null, actor.type, actor.id, action, JSON.stringify(opts.data ?? {}), now());
  return aid;
}

/** Create a user-facing notification (bell icon / push in future). */
export function notify(activityId: string, title: string, body: string, opts: { boardId?: string | null; cardId?: string | null } = {}) {
  const nid = id();
  db.prepare('INSERT INTO notifications (id, activity_id, title, body, board_id, card_id, read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)')
    .run(nid, activityId, title, body, opts.boardId ?? null, opts.cardId ?? null, now());
  const n = toNotification(db.prepare('SELECT * FROM notifications WHERE id = ?').get(nid));
  emit('notification', { boardId: opts.boardId, cardId: opts.cardId, data: n });
}

export function getActivity(aid: string) {
  return toActivity(db.prepare('SELECT * FROM activity WHERE id = ?').get(aid));
}

// ---------- outbound webhooks to agents ----------
export type WebhookEvent = 'card.assigned' | 'card.updated' | 'card.moved' | 'comment.created' | 'ping';

/** POST an event to an agent's webhook (if configured). Fire-and-forget with
 *  one retry; failures are written to the activity log. */
export async function sendWebhook(agentId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<{ ok: boolean; status?: number; error?: string }> {
  const a = db.prepare('SELECT id, webhook_url, webhook_secret, enabled FROM agents WHERE id = ?').get(agentId) as any;
  if (!a || !a.webhook_url || !a.enabled) return { ok: false, error: 'No webhook configured' };
  const body = JSON.stringify({ event, agentId, at: now(), ...data });
  const sig = crypto.createHmac('sha256', a.webhook_secret).update(body).digest('hex');
  let lastErr = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(a.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EasyKanban-Event': event, 'X-EasyKanban-Signature': `sha256=${sig}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true, status: res.status };
      lastErr = `HTTP ${res.status}`;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  logActivity({ type: 'system', id: null }, 'webhook.failed', { data: { agentId, event, error: lastErr } });
  return { ok: false, error: lastErr };
}

/** Notify the assigned agent (if any) about a card event. */
export function webhookForCard(cardId: string, event: WebhookEvent, extra: Record<string, unknown> = {}) {
  const card = getCardRow(cardId);
  if (!card || card.assigneeType !== 'agent' || !card.assigneeId) return;
  void sendWebhook(card.assigneeId, event, { card, ...extra });
}
