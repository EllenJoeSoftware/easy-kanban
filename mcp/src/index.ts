// Easy Kanban MCP server — lets any MCP-capable agent (Claude Desktop, Claude
// Code, Hermes, Cursor…) work the board: claim cards, log progress, ask
// questions and hand finished work back for review.
//
// Env:
//   EASY_KANBAN_URL      e.g. http://localhost:8080
//   EASY_KANBAN_API_KEY  agent key (ek_…) — or a user token for admin use
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { KanbanClient, type Card, type CardDetail } from '@easy-kanban/shared';

const url = process.env.EASY_KANBAN_URL ?? 'http://localhost:8080';
const key = process.env.EASY_KANBAN_API_KEY ?? '';
if (!key) {
  console.error('EASY_KANBAN_API_KEY is not set');
  process.exit(1);
}
const api = new KanbanClient({ baseUrl: url, token: key });

const server = new McpServer({ name: 'easy-kanban', version: '1.0.0' });

const fmtCard = (c: Card) =>
  `#${c.number} [${c.priority}] ${c.title}${c.labels.length ? ` {${c.labels.join(', ')}}` : ''}${c.blocked ? ' (BLOCKED)' : ''} — id: ${c.id}`;

function fmtDetail(c: CardDetail | (Card & Partial<CardDetail>)) {
  const lines = [
    `# #${c.number} ${c.title}`,
    `id: ${c.id} · board: ${c.boardId} · priority: ${c.priority} · progress: ${c.progress}%`,
    c.labels.length ? `labels: ${c.labels.join(', ')}` : '',
    c.dueAt ? `due: ${c.dueAt}` : '',
    c.blocked ? `BLOCKED: ${c.blockedReason}` : '',
    '',
    '## Instructions',
    c.description || '(none)',
  ];
  if (c.checklist?.length) {
    lines.push('', '## Checklist');
    for (const i of c.checklist) lines.push(`- [${i.done ? 'x' : ' '}] ${i.text} (item id: ${i.id})`);
  }
  const talk = c.comments?.filter((m) => m.kind !== 'log') ?? [];
  if (talk.length) {
    lines.push('', '## Conversation');
    for (const m of talk.slice(-20)) lines.push(`**${m.author.name}** (${m.kind}, ${m.createdAt}): ${m.body}`);
  }
  if (c.result) lines.push('', '## Previous result', c.result);
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const wrap = <A,>(fn: (a: A) => Promise<string>) => async (a: A) => {
  try { return text(await fn(a)); }
  catch (e: any) { return { ...text(`Error: ${e?.message ?? e}`), isError: true }; }
};

server.registerTool('claim_next_card', {
  description: 'Claim the next card to work on (highest priority from To Do, assigned to you or unassigned). Moves it to In Progress and returns full instructions. Returns nothing if no work is available.',
  inputSchema: { boardId: z.string().optional().describe('Only claim from this board'), labels: z.array(z.string()).optional().describe('Only claim cards with one of these labels') },
}, wrap(async ({ boardId, labels }) => {
  const r = await api.agentClaim({ boardId, labels }) as any;
  if (!r.card) return `No card claimed: ${r.reason ?? 'no work available'}.`;
  return `Claimed card. When finished call complete_card; if stuck call ask_question or fail_card.\n\n${fmtDetail(r.card)}`;
}));

server.registerTool('list_my_cards', {
  description: 'List open cards assigned to you.',
  inputSchema: {},
}, wrap(async () => {
  const cards = await api.agentMyCards();
  return cards.length ? cards.map(fmtCard).join('\n') : 'No open cards assigned to you.';
}));

server.registerTool('get_card', {
  description: 'Get full details of a card: instructions, checklist and conversation (including human answers to your questions).',
  inputSchema: { cardId: z.string() },
}, wrap(async ({ cardId }) => fmtDetail(await api.getCard(cardId))));

server.registerTool('log_progress', {
  description: 'Post a progress note to a card (shown in its timeline) and optionally update percent complete.',
  inputSchema: { cardId: z.string(), message: z.string(), progress: z.number().min(0).max(100).optional() },
}, wrap(async ({ cardId, message, progress }) => { await api.agentLog(cardId, message, 'log', progress); return 'Logged.'; }));

server.registerTool('check_item', {
  description: 'Tick (or untick) a checklist item on a card.',
  inputSchema: { itemId: z.string(), done: z.boolean().default(true) },
}, wrap(async ({ itemId, done }) => { await api.updateChecklistItem(itemId, { done }); return 'Updated.'; }));

server.registerTool('complete_card', {
  description: 'Finish a card. The result (Markdown) is attached and the card moves to Review (or Done). Report token usage/cost if known.',
  inputSchema: {
    cardId: z.string(), result: z.string().describe('Your deliverable or summary, Markdown'),
    moveTo: z.enum(['review', 'done']).default('review'),
    tokensIn: z.number().optional(), tokensOut: z.number().optional(), costUsd: z.number().optional(),
  },
}, wrap(async ({ cardId, ...rest }) => { const c = await api.agentComplete(cardId, rest); return `Completed #${c.number}.`; }));

server.registerTool('fail_card', {
  description: 'Report that you could not complete a card. With retry=true it goes back to To Do; otherwise it is marked blocked for a human.',
  inputSchema: { cardId: z.string(), error: z.string(), retry: z.boolean().default(false) },
}, wrap(async ({ cardId, error, retry }) => { const c = await api.agentFail(cardId, { error, retry }); return `Reported failure on #${c.number}.`; }));

server.registerTool('ask_question', {
  description: 'Ask the human a question about a card. The card is marked "needs input" and the human is notified. Check back later with get_card for the answer.',
  inputSchema: { cardId: z.string(), question: z.string() },
}, wrap(async ({ cardId, question }) => { await api.agentAsk(cardId, question); return 'Question posted. The human has been notified; poll get_card for the reply.'; }));

server.registerTool('comment', {
  description: 'Add a regular comment to a card.',
  inputSchema: { cardId: z.string(), body: z.string() },
}, wrap(async ({ cardId, body }) => { await api.addComment(cardId, body); return 'Comment added.'; }));

server.registerTool('list_boards', {
  description: 'List boards with their columns (needed for create_card / move_card).',
  inputSchema: {},
}, wrap(async () => {
  const boards = await api.listBoards();
  const out: string[] = [];
  for (const b of boards) {
    const d = await api.getBoard(b.id);
    out.push(`${b.icon} ${b.name} — id: ${b.id}\n${d.columns.map((c) => `  - ${c.name} [${c.kind}] id: ${c.id} (${d.cards.filter((x) => x.columnId === c.id).length} cards)`).join('\n')}`);
  }
  return out.join('\n\n') || 'No boards.';
}));

server.registerTool('search_cards', {
  description: 'Search cards by text or #number, optionally within a board.',
  inputSchema: { query: z.string().optional(), boardId: z.string().optional(), label: z.string().optional() },
}, wrap(async ({ query, boardId, label }) => {
  const cards = await api.listCards({ search: query, boardId, label });
  return cards.slice(0, 50).map(fmtCard).join('\n') || 'No cards found.';
}));

server.registerTool('create_card', {
  description: 'Create a new card (e.g. a follow-up task or a sub-task for another agent).',
  inputSchema: {
    boardId: z.string(), title: z.string(), description: z.string().optional(), columnId: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(), labels: z.array(z.string()).optional(),
    assigneeAgentId: z.string().optional(), checklist: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(),
  },
}, wrap(async ({ assigneeAgentId, ...input }) => {
  const c = await api.createCard({ ...input, ...(assigneeAgentId ? { assigneeType: 'agent' as const, assigneeId: assigneeAgentId } : {}) });
  return `Created ${fmtCard(c)}`;
}));

server.registerTool('move_card', {
  description: 'Move a card to another column on the same board.',
  inputSchema: { cardId: z.string(), columnId: z.string() },
}, wrap(async ({ cardId, columnId }) => { const c = await api.moveCard(cardId, { columnId }); return `Moved #${c.number}.`; }));

server.registerTool('set_status', {
  description: 'Report your own status (idle, working, waiting, error, offline) and a short note shown on the dashboard.',
  inputSchema: { status: z.enum(['idle', 'working', 'waiting', 'error', 'offline']), note: z.string().optional() },
}, wrap(async ({ status, note }) => { await api.agentHeartbeat(status, note); return 'Status updated.'; }));

await server.connect(new StdioServerTransport());
console.error(`easy-kanban MCP connected to ${url}`);
