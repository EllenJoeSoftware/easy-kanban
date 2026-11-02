// Shared domain types — used by the server, the web app, the MCP server
// and any future mobile (Expo / React Native) client.

export type ID = string;

export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];

/** Semantic meaning of a column. Agents use this to know where to pick up
 *  work (`todo`), where to put work in flight (`in_progress`), and where to
 *  hand it back for a human (`review`). */
export type ColumnKind = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'custom';
export const COLUMN_KINDS: ColumnKind[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'custom'];

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'error' | 'offline' | 'paused';
export const AGENT_STATUSES: AgentStatus[] = ['idle', 'working', 'waiting', 'error', 'offline', 'paused'];

export type ActorType = 'user' | 'agent' | 'system';

export interface Actor {
  type: ActorType;
  id: ID | null;
  name: string;
}

export interface User {
  id: ID;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export interface Board {
  id: ID;
  name: string;
  description: string;
  color: string;
  icon: string;
  position: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Present on list endpoints */
  cardCount?: number;
}

export interface Column {
  id: ID;
  boardId: ID;
  name: string;
  kind: ColumnKind;
  position: number;
  wipLimit: number | null;
  color: string;
}

export interface ChecklistItem {
  id: ID;
  cardId: ID;
  text: string;
  done: boolean;
  position: number;
}

export interface Card {
  id: ID;
  /** Human friendly sequential number, e.g. 42 → "#42" */
  number: number;
  boardId: ID;
  columnId: ID;
  title: string;
  description: string;
  priority: Priority;
  labels: string[];
  dueAt: string | null;
  position: number;
  assigneeType: 'agent' | 'user' | null;
  assigneeId: ID | null;
  progress: number;
  blocked: boolean;
  blockedReason: string;
  result: string;
  dependsOn: ID[];
  archived: boolean;
  createdBy: Actor;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  checklistTotal: number;
  checklistDone: number;
  commentCount: number;
}

export interface CardDetail extends Card {
  checklist: ChecklistItem[];
  comments: Comment[];
  runs: AgentRun[];
  activity: Activity[];
}

export type CommentKind = 'comment' | 'log' | 'result' | 'error' | 'question' | 'system';

export interface Comment {
  id: ID;
  cardId: ID;
  author: Actor;
  body: string;
  kind: CommentKind;
  createdAt: string;
}

export interface Agent {
  id: ID;
  name: string;
  description: string;
  avatar: string;
  color: string;
  /** e.g. claude, hermes, openai, ollama, custom */
  runtime: string;
  model: string;
  status: AgentStatus;
  statusNote: string;
  capabilities: string[];
  /** Board IDs this agent may auto-claim from. Empty = all boards. */
  boardIds: ID[];
  autoClaim: boolean;
  maxConcurrent: number;
  webhookUrl: string;
  enabled: boolean;
  apiKeyPrefix: string;
  lastSeenAt: string | null;
  currentCardId: ID | null;
  createdAt: string;
  updatedAt: string;
  stats?: AgentStats;
}

export interface AgentStats {
  assigned: number;
  inProgress: number;
  completed7d: number;
  failed7d: number;
  totalRuns: number;
  costUsd7d: number;
}

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentRun {
  id: ID;
  agentId: ID;
  cardId: ID;
  status: RunStatus;
  summary: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  startedAt: string;
  endedAt: string | null;
}

export interface Activity {
  id: ID;
  boardId: ID | null;
  cardId: ID | null;
  actor: Actor;
  action: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface BoardDetail extends Board {
  columns: Column[];
  cards: Card[];
}

export interface Notification {
  id: ID;
  activityId: ID;
  title: string;
  body: string;
  boardId: ID | null;
  cardId: ID | null;
  read: boolean;
  createdAt: string;
}

export interface DashboardStats {
  agents: { total: number; working: number; idle: number; error: number; offline: number; paused: number; waiting: number };
  cards: { open: number; inProgress: number; review: number; blocked: number; overdue: number; completed7d: number };
  costUsd7d: number;
  needsAttention: Card[];
  recentActivity: Activity[];
}

// ---------- Request payloads ----------

export interface CreateBoardInput {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  /** 'agents' (default) | 'simple' | 'empty' */
  template?: 'agents' | 'simple' | 'empty';
}

export type UpdateBoardInput = Partial<Pick<Board, 'name' | 'description' | 'color' | 'icon' | 'archived' | 'position'>>;

export interface CreateColumnInput {
  name: string;
  kind?: ColumnKind;
  wipLimit?: number | null;
  color?: string;
  position?: number;
}
export type UpdateColumnInput = Partial<CreateColumnInput>;

export interface CreateCardInput {
  boardId: ID;
  columnId?: ID;
  title: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  dueAt?: string | null;
  assigneeType?: 'agent' | 'user' | null;
  assigneeId?: ID | null;
  dependsOn?: ID[];
  checklist?: string[];
}

export type UpdateCardInput = Partial<
  Pick<
    Card,
    | 'title'
    | 'description'
    | 'priority'
    | 'labels'
    | 'dueAt'
    | 'assigneeType'
    | 'assigneeId'
    | 'progress'
    | 'blocked'
    | 'blockedReason'
    | 'result'
    | 'dependsOn'
    | 'archived'
  >
>;

export interface MoveCardInput {
  columnId: ID;
  /** Index within the destination column (0 = top). Omit to append. */
  index?: number;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  avatar?: string;
  color?: string;
  runtime?: string;
  model?: string;
  capabilities?: string[];
  boardIds?: ID[];
  autoClaim?: boolean;
  maxConcurrent?: number;
  webhookUrl?: string;
}
export type UpdateAgentInput = Partial<CreateAgentInput & { enabled: boolean; status: AgentStatus; statusNote: string }>;

export interface AgentWithKey extends Agent {
  /** Only returned when the agent is created or its key rotated. */
  apiKey: string;
  webhookSecret: string;
}

export interface ClaimInput {
  boardId?: ID;
  /** Only claim cards with at least one of these labels */
  labels?: string[];
}

export interface CompleteInput {
  result?: string;
  /** Column kind to move to. Default 'review'. Use 'done' to skip review. */
  moveTo?: 'review' | 'done';
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

export interface FailInput {
  error: string;
  /** If true the card is put back in To Do for another attempt. */
  retry?: boolean;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

/** Server-sent event envelope */
export interface KanbanEvent {
  type:
    | 'board.created' | 'board.updated' | 'board.deleted'
    | 'column.created' | 'column.updated' | 'column.deleted'
    | 'card.created' | 'card.updated' | 'card.moved' | 'card.deleted'
    | 'comment.created'
    | 'agent.created' | 'agent.updated' | 'agent.deleted'
    | 'notification';
  boardId?: ID | null;
  cardId?: ID | null;
  data?: unknown;
  at: string;
}
