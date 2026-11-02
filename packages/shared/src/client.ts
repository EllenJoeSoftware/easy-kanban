// Platform-agnostic API client. Only depends on `fetch`, so it runs in the
// browser, Node 18+, React Native / Expo and Deno without changes.
import type {
  Activity, Agent, AgentRun, AgentWithKey, Board, BoardDetail, Card, CardDetail,
  ChecklistItem, ClaimInput, Column, Comment, CommentKind, CompleteInput,
  CreateAgentInput, CreateBoardInput, CreateCardInput, CreateColumnInput,
  DashboardStats, FailInput, ID, MoveCardInput, Notification, UpdateAgentInput,
  UpdateBoardInput, UpdateCardInput, UpdateColumnInput, User, AgentStatus,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

export interface ClientOptions {
  /** e.g. "http://192.168.1.10:8080" — empty string for same-origin */
  baseUrl?: string;
  /** User JWT or agent API key (ek_...). Can be a function for refresh. */
  token?: string | (() => string | null | undefined);
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
}

export class KanbanClient {
  private baseUrl: string;
  private fetchImpl: typeof fetch;

  constructor(private opts: ClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? '').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  }

  setToken(token: string | null) {
    this.opts.token = token ?? undefined;
  }

  getToken(): string | null {
    const t = this.opts.token;
    return (typeof t === 'function' ? t() : t) ?? null;
  }

  /** URL for the realtime Server-Sent Events stream. */
  eventsUrl(): string {
    const t = this.getToken();
    return `${this.baseUrl}/api/events${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    let url = `${this.baseUrl}/api${path}`;
    if (query) {
      const qs = Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }
    const headers: Record<string, string> = {};
    const token = this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await this.fetchImpl(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    const data = text ? safeJson(text) : undefined;
    if (!res.ok) {
      if (res.status === 401) this.opts.onUnauthorized?.();
      const msg = (data && typeof data === 'object' && 'error' in data ? String((data as any).error) : res.statusText) || 'Request failed';
      throw new ApiError(res.status, msg, data);
    }
    return data as T;
  }

  // ---- auth ----
  login(email: string, password: string) {
    return this.request<{ token: string; user: User }>('POST', '/auth/login', { email, password });
  }
  me() { return this.request<{ user?: User; agent?: Agent }>('GET', '/auth/me'); }
  changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ ok: true }>('POST', '/auth/password', { currentPassword, newPassword });
  }

  // ---- boards ----
  listBoards(includeArchived = false) { return this.request<Board[]>('GET', '/boards', undefined, { archived: includeArchived ? 1 : undefined }); }
  getBoard(id: ID) { return this.request<BoardDetail>('GET', `/boards/${id}`); }
  createBoard(input: CreateBoardInput) { return this.request<BoardDetail>('POST', '/boards', input); }
  updateBoard(id: ID, input: UpdateBoardInput) { return this.request<Board>('PATCH', `/boards/${id}`, input); }
  deleteBoard(id: ID) { return this.request<{ ok: true }>('DELETE', `/boards/${id}`); }

  // ---- columns ----
  createColumn(boardId: ID, input: CreateColumnInput) { return this.request<Column>('POST', `/boards/${boardId}/columns`, input); }
  updateColumn(id: ID, input: UpdateColumnInput) { return this.request<Column>('PATCH', `/columns/${id}`, input); }
  deleteColumn(id: ID, moveCardsTo?: ID) { return this.request<{ ok: true }>('DELETE', `/columns/${id}`, undefined, { moveTo: moveCardsTo }); }
  reorderColumns(boardId: ID, columnIds: ID[]) { return this.request<Column[]>('POST', `/boards/${boardId}/columns/reorder`, { columnIds }); }

  // ---- cards ----
  listCards(q: { boardId?: ID; assigneeId?: ID; columnKind?: string; search?: string; label?: string; archived?: boolean } = {}) {
    return this.request<Card[]>('GET', '/cards', undefined, { ...q, archived: q.archived ? 1 : undefined });
  }
  getCard(id: ID) { return this.request<CardDetail>('GET', `/cards/${id}`); }
  createCard(input: CreateCardInput) { return this.request<Card>('POST', '/cards', input); }
  updateCard(id: ID, input: UpdateCardInput) { return this.request<Card>('PATCH', `/cards/${id}`, input); }
  moveCard(id: ID, input: MoveCardInput) { return this.request<Card>('POST', `/cards/${id}/move`, input); }
  deleteCard(id: ID) { return this.request<{ ok: true }>('DELETE', `/cards/${id}`); }
  addComment(cardId: ID, body: string, kind: CommentKind = 'comment') {
    return this.request<Comment>('POST', `/cards/${cardId}/comments`, { body, kind });
  }
  deleteComment(id: ID) { return this.request<{ ok: true }>('DELETE', `/comments/${id}`); }
  addChecklistItem(cardId: ID, text: string) { return this.request<ChecklistItem>('POST', `/cards/${cardId}/checklist`, { text }); }
  updateChecklistItem(id: ID, input: { text?: string; done?: boolean }) { return this.request<ChecklistItem>('PATCH', `/checklist/${id}`, input); }
  deleteChecklistItem(id: ID) { return this.request<{ ok: true }>('DELETE', `/checklist/${id}`); }

  // ---- agents (management) ----
  listAgents() { return this.request<Agent[]>('GET', '/agents'); }
  getAgent(id: ID) { return this.request<Agent>('GET', `/agents/${id}`); }
  createAgent(input: CreateAgentInput) { return this.request<AgentWithKey>('POST', '/agents', input); }
  updateAgent(id: ID, input: UpdateAgentInput) { return this.request<Agent>('PATCH', `/agents/${id}`, input); }
  deleteAgent(id: ID) { return this.request<{ ok: true }>('DELETE', `/agents/${id}`); }
  rotateAgentKey(id: ID) { return this.request<AgentWithKey>('POST', `/agents/${id}/rotate-key`); }
  agentRuns(id: ID) { return this.request<AgentRun[]>('GET', `/agents/${id}/runs`); }
  pingAgent(id: ID, cardId?: ID) { return this.request<{ ok: boolean; status?: number; error?: string }>('POST', `/agents/${id}/ping`, { cardId }); }

  // ---- agent self-service (call with an agent API key) ----
  agentHeartbeat(status?: AgentStatus, note?: string) { return this.request<Agent>('POST', '/agent/heartbeat', { status, note }); }
  agentMyCards() { return this.request<Card[]>('GET', '/agent/cards'); }
  agentClaim(input: ClaimInput = {}) { return this.request<{ card: CardDetail | null; run: AgentRun | null }>('POST', '/agent/claim', input); }
  agentLog(cardId: ID, message: string, kind: CommentKind = 'log', progress?: number) {
    return this.request<Comment>('POST', `/agent/cards/${cardId}/log`, { message, kind, progress });
  }
  agentComplete(cardId: ID, input: CompleteInput = {}) { return this.request<Card>('POST', `/agent/cards/${cardId}/complete`, input); }
  agentFail(cardId: ID, input: FailInput) { return this.request<Card>('POST', `/agent/cards/${cardId}/fail`, input); }
  agentAsk(cardId: ID, question: string) { return this.request<Card>('POST', `/agent/cards/${cardId}/ask`, { question }); }

  // ---- misc ----
  activity(q: { boardId?: ID; cardId?: ID; agentId?: ID; limit?: number; before?: string } = {}) {
    return this.request<Activity[]>('GET', '/activity', undefined, q);
  }
  dashboard() { return this.request<DashboardStats>('GET', '/dashboard'); }
  notifications(unreadOnly = false) { return this.request<Notification[]>('GET', '/notifications', undefined, { unread: unreadOnly ? 1 : undefined }); }
  markNotificationsRead(ids?: ID[]) { return this.request<{ ok: true }>('POST', '/notifications/read', { ids }); }
  labels() { return this.request<string[]>('GET', '/labels'); }
  exportAll() { return this.request<unknown>('GET', '/export'); }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
