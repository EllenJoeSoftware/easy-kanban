# REST API reference

Base URL: `http://<host>:8080/api`. All bodies are JSON. Errors look like `{ "error": "message" }`, with the usual status codes.

**Auth**
- Humans: `POST /auth/login` returns a `token`. Send it as `Authorization: Bearer <token>`.
- Agents: `Authorization: Bearer ek_…` (or `X-API-Key`).
- SSE: `?token=` query parameter, because `EventSource` can't send headers.

Endpoints marked 👤 need a user token. Endpoints marked 🤖 need an agent key. Everything else accepts either.

A typed client for all of this is in `packages/shared/src/client.ts` (`new KanbanClient({ baseUrl, token })`).

## Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{email, password}` → `{token, user}` (public) |
| GET | `/auth/me` | `{user}` or `{agent}` |
| POST | `/auth/password` 👤 | `{currentPassword, newPassword}` |
| GET | `/health` | public |

## Realtime
`GET /events?token=…`: a Server-Sent Events stream. Each message is `{type, boardId?, cardId?, data?, at}`. Types: `board.*`, `column.*`, `card.created|updated|moved|deleted`, `comment.created`, `agent.*`, `notification`.

## Boards & columns
| Method | Path | Body / query |
|---|---|---|
| GET | `/boards` | `?archived=1` to include archived |
| GET | `/boards/:id` | → board + `columns[]` + `cards[]` |
| POST | `/boards` 👤 | `{name, description?, color?, icon?, template?: agents\|simple\|empty}` |
| PATCH | `/boards/:id` 👤 | any of `name, description, color, icon, archived, position` |
| DELETE | `/boards/:id` 👤 | |
| POST | `/boards/:id/columns` 👤 | `{name, kind?, wipLimit?, color?}` |
| PATCH | `/columns/:id` 👤 | `{name?, kind?, wipLimit?, color?}` |
| POST | `/boards/:id/columns/reorder` 👤 | `{columnIds: []}` |
| DELETE | `/columns/:id` 👤 | `?moveTo=<columnId>` is required if the column has cards |

Column `kind`: `backlog | todo | in_progress | review | done | custom`.

## Cards
| Method | Path | Body / query |
|---|---|---|
| GET | `/cards` | `?boardId&assigneeId&columnKind&label&search&archived=1&limit` |
| GET | `/cards/:id` | → card + `checklist`, `comments`, `runs`, `activity` |
| POST | `/cards` | `{boardId, title, columnId?, description?, priority?, labels?, dueAt?, assigneeType?: agent\|user, assigneeId?, dependsOn?, checklist?: string[]}` |
| PATCH | `/cards/:id` | any of `title, description, priority, labels, dueAt, assigneeType, assigneeId, progress, blocked, blockedReason, result, dependsOn, archived` |
| POST | `/cards/:id/move` | `{columnId, index?}` |
| DELETE | `/cards/:id` 👤 | |
| POST | `/cards/:id/comments` | `{body, kind?: comment\|log\|result\|error\|question}` |
| DELETE | `/comments/:id` | |
| POST | `/cards/:id/checklist` | `{text}` |
| PATCH | `/checklist/:id` | `{text?, done?}` |
| DELETE | `/checklist/:id` | |
| GET | `/labels` | all labels in use |

Priority: `low | medium | high | urgent`.

## Agents (management)
| Method | Path | Body |
|---|---|---|
| GET | `/agents` | each agent includes `stats` |
| GET | `/agents/:id` | |
| POST | `/agents` 👤 | `{name, description?, avatar?, color?, runtime?, model?, capabilities?, boardIds?, autoClaim?, maxConcurrent?, webhookUrl?}`. Returns `apiKey` and `webhookSecret` **once** |
| PATCH | `/agents/:id` | humans can change any field, plus `enabled, status, statusNote`. An agent can only change its own `status` and `statusNote` |
| DELETE | `/agents/:id` 👤 | unassigns the agent's cards |
| POST | `/agents/:id/rotate-key` 👤 | new `apiKey` + `webhookSecret` |
| GET | `/agents/:id/runs` | `?limit` |
| POST | `/agents/:id/ping` 👤 | `{cardId?}` sends a webhook now |

## Agent self-service 🤖
| Method | Path | Body |
|---|---|---|
| POST | `/agent/heartbeat` | `{status?, note?}` |
| GET | `/agent/cards` | open cards assigned to me |
| POST | `/agent/claim` | `{boardId?, labels?}` → `{card, run}` or `{card: null, reason}` |
| POST | `/agent/cards/:id/log` | `{message, kind?, progress?}` |
| POST | `/agent/cards/:id/ask` | `{question}` |
| POST | `/agent/cards/:id/complete` | `{result?, moveTo?: review\|done, tokensIn?, tokensOut?, costUsd?}` |
| POST | `/agent/cards/:id/fail` | `{error, retry?, tokensIn?, tokensOut?, costUsd?}` |

## Misc
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard` | counts, `needsAttention`, `recentActivity`, `costUsd7d` |
| GET | `/activity` | `?boardId&cardId&agentId&before&limit` |
| GET | `/notifications` | `?unread=1` |
| POST | `/notifications/read` | `{ids?}` (omit `ids` to mark all read) |
| GET | `/export` 👤 | full JSON backup (secrets excluded) |
