import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations: string[] = [
  // 1 — initial schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at TEXT NOT NULL
  );
  CREATE TABLE boards (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6366f1',
    icon TEXT NOT NULL DEFAULT '📋',
    position REAL NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE columns (
    id TEXT PRIMARY KEY,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',
    position REAL NOT NULL DEFAULT 0,
    wip_limit INTEGER,
    color TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_columns_board ON columns(board_id);
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '🤖',
    color TEXT NOT NULL DEFAULT '#22c55e',
    runtime TEXT NOT NULL DEFAULT 'custom',
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'offline',
    status_note TEXT NOT NULL DEFAULT '',
    capabilities TEXT NOT NULL DEFAULT '[]',
    board_ids TEXT NOT NULL DEFAULT '[]',
    auto_claim INTEGER NOT NULL DEFAULT 1,
    max_concurrent INTEGER NOT NULL DEFAULT 1,
    webhook_url TEXT NOT NULL DEFAULT '',
    webhook_secret TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    api_key_hash TEXT NOT NULL,
    api_key_prefix TEXT NOT NULL,
    last_seen_at TEXT,
    current_card_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX idx_agents_key ON agents(api_key_hash);
  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    number INTEGER NOT NULL,
    board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium',
    labels TEXT NOT NULL DEFAULT '[]',
    due_at TEXT,
    position REAL NOT NULL DEFAULT 0,
    assignee_type TEXT,
    assignee_id TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    blocked INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT NOT NULL DEFAULT '',
    result TEXT NOT NULL DEFAULT '',
    depends_on TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0,
    created_by_type TEXT NOT NULL DEFAULT 'user',
    created_by_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_cards_board ON cards(board_id, column_id, position);
  CREATE INDEX idx_cards_assignee ON cards(assignee_type, assignee_id);
  CREATE TABLE checklist_items (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_checklist_card ON checklist_items(card_id);
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL,
    author_id TEXT,
    body TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'comment',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_comments_card ON comments(card_id, created_at);
  CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',
    summary TEXT NOT NULL DEFAULT '',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );
  CREATE INDEX idx_runs_agent ON agent_runs(agent_id, started_at);
  CREATE INDEX idx_runs_card ON agent_runs(card_id);
  CREATE TABLE activity (
    id TEXT PRIMARY KEY,
    board_id TEXT,
    card_id TEXT,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_activity_board ON activity(board_id, created_at);
  CREATE INDEX idx_activity_card ON activity(card_id, created_at);
  CREATE INDEX idx_activity_actor ON activity(actor_type, actor_id, created_at);
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    board_id TEXT,
    card_id TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_notifications_created ON notifications(created_at);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < migrations.length; i++) {
    tx(() => {
      db.exec(migrations[i]);
      db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)').run(i + 1, new Date().toISOString());
    });
  }
}

let txDepth = 0;
/** Run fn inside a transaction (nesting-safe). */
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export function getSetting(key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

migrate();
