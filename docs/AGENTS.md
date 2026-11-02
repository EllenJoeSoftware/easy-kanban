# Connecting AI agents

Every agent has its own API key (`ek_…`). It sends the key as `Authorization: Bearer ek_…` (or `X-API-Key: ek_…`).

## How agents work

```
                 ┌─────────── you assign / drop a card in To Do
                 ▼
POST /api/agent/claim  ──▶ card moves to In Progress, a run starts, agent shows "working"
        │
        ├─ POST /api/agent/cards/:id/log       { message, progress? }      progress notes
        ├─ POST /api/agent/cards/:id/ask       { question }                card → "Needs input", you're notified
        │        (your reply in the card unblocks it; the agent reads it via GET /api/cards/:id)
        ├─ POST /api/agent/cards/:id/complete  { result, moveTo?, tokensIn?, tokensOut?, costUsd? }
        │        card → Review (or Done), you're notified
        └─ POST /api/agent/cards/:id/fail      { error, retry? }           blocked, or back to To Do if retry
```

**What gets claimed**, in order:
1. Cards in a column with role **todo**, not blocked, not archived, and with all dependencies finished.
2. Cards **assigned to this agent** come first. Then, if *auto-claim* is on, **unassigned** cards. When the agent has *capabilities*, an unassigned card needs one matching label.
3. Within that, highest priority first, then earliest due date, then board order.
4. Only boards the agent is allowed on are considered, and the agent never holds more than *max concurrent* cards at once.

Column **roles** (set in Board settings) tell agents what each column means: `backlog`, `todo`, `in_progress`, `review`, `done` and `custom`. You can rename columns freely, because agents only look at the role.

Agents can also use the normal card endpoints (create follow-up cards, comment, tick checklist items, move cards). Agents cannot delete cards.

## Option 1 — MCP (Claude Desktop, Claude Code, Hermes)

Download the single-file server from your board at `http://<host>:8080/downloads/easy-kanban-mcp.mjs`. It needs Node 20+.

**Claude Desktop**: edit `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "easy-kanban": {
      "command": "node",
      "args": ["C:/Users/Wycliffe/agents/easy-kanban-mcp.mjs"],
      "env": {
        "EASY_KANBAN_URL": "http://localhost:8080",
        "EASY_KANBAN_API_KEY": "ek_..."
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add easy-kanban --env EASY_KANBAN_URL=http://localhost:8080 --env EASY_KANBAN_API_KEY=ek_... -- node C:/Users/Wycliffe/agents/easy-kanban-mcp.mjs
```

**Hermes**: add the same `command` / `args` / `env` block to the MCP section of the profile that should work the board (for example your `kanban` profile).

Tools: `claim_next_card`, `list_my_cards`, `get_card`, `log_progress`, `check_item`, `complete_card`, `fail_card`, `ask_question`, `comment`, `list_boards`, `search_cards`, `create_card`, `move_card`, `set_status`.

A good standing instruction for the agent:

> You work the Easy Kanban board. Call `claim_next_card`. Follow the card's instructions and checklist, calling `log_progress` as you go. If something is unclear, call `ask_question` and stop. When finished, call `complete_card` with your deliverable in Markdown and your token usage. If there is no work, call `set_status` with `idle`.

Use a different API key for each agent, so the board shows who did what.

## Option 2 — HTTP polling worker

`examples/worker.mjs` is a dependency-free loop. Put your agent logic in `doWork()`:

```bash
EASY_KANBAN_URL=http://localhost:8080 EASY_KANBAN_API_KEY=ek_... node examples/worker.mjs
```

The same loop with curl:

```bash
KEY=ek_...
curl -s -X POST localhost:8080/api/agent/claim -H "Authorization: Bearer $KEY"
curl -s -X POST localhost:8080/api/agent/cards/$ID/log -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"message":"Halfway","progress":50}'
curl -s -X POST localhost:8080/api/agent/cards/$ID/complete -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"result":"## Done\n…","costUsd":0.04}'
```

Send `POST /api/agent/heartbeat {"status":"idle","note":"Waiting for work"}` every few minutes so the agent isn't shown as offline.

## Option 3 — Webhooks (push)

Set a **Webhook URL** on the agent. Easy Kanban will `POST` JSON to it when:

| Event | When |
|---|---|
| `card.assigned` | A card is assigned to the agent, or you press **Nudge** |
| `card.moved` | You move one of its cards |
| `card.updated` | You edit one of its cards |
| `comment.created` | You comment on one of its cards (for example, answering its question) |
| `ping` | You press **Ping** on the agent page |

Body: `{ "event", "agentId", "at", "card": {…}, … }`. Headers: `X-EasyKanban-Event` and `X-EasyKanban-Signature: sha256=<hex>`. The signature is an HMAC-SHA256 of the raw body using the agent's webhook secret. Always verify it; see `examples/webhook-receiver.mjs`.

A webhook only tells the agent that something happened. The agent still calls `/api/agent/claim` (or works the card directly) through the normal API.

## Reporting cost

Pass `tokensIn`, `tokensOut` and `costUsd` to `complete` or `fail`. The values are added to the run and appear on the dashboard and the agent page as 7-day spend.
