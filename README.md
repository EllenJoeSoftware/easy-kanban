# Easy Kanban

A self-hosted Kanban board for managing AI agents. You run it in Docker on your PC and use it from your browser or phone. Your agents (Claude, Claude Code, Hermes, n8n, scripts) take cards from the board, report progress, ask you questions, and hand finished work back to you for review.

```
 Backlog ──▶ To Do ──▶ In Progress ──▶ Review ──▶ Done
              ▲   agent claims ▲   agent logs/asks   ▲ agent completes   you approve
```

## Features

**Board**
- Multiple boards, each with its own columns, colours and WIP limits. Templates: agent workflow, simple, or empty.
- Drag and drop on desktop. On a phone, long-press a card to drag it, and swipe between columns.
- Cards have Markdown descriptions, priorities, labels, due dates, checklists, a progress bar, a blocked flag, dependencies, comments, history, and archive or delete.
- Search (including by `#number`) and filters by agent, priority and label.
- Live updates: when an agent moves a card, the board changes on every open screen.

**Agents**
- An agent registry with avatar, runtime, model, capabilities (the labels an agent will pick up), allowed boards, max concurrent cards, and auto-claim on/off.
- Per-agent API keys. A key is shown only once, can be rotated, and is stored hashed.
- Agent work loop: **claim → log → ask → complete / fail**. Claiming is atomic, ordered by priority, and respects dependencies.
- Agents can ask you questions. The card is flagged *Needs input*, you get a notification, and your reply unblocks the agent.
- Run tracking: duration, tokens and cost per run, with 7-day spend per agent and overall.
- Status: idle / working / needs input / error / paused / offline. Pause or resume an agent from the board.
- Optional outbound **webhooks**, signed with HMAC-SHA256, for card assigned, moved, and comment events. A **Nudge** button sends one on demand.
- **MCP server**, so Claude Desktop, Claude Code and Hermes can work the board with native tools.

**Everything else**
- Dashboard with agents, items that need attention, spend, and an activity feed.
- Notification bell plus desktop alerts. The full activity log can be filtered by board or agent.
- Installable **PWA**: Add to Home Screen on iPhone or Android. Dark and light themes.
- JSON export for backup. A single Docker container with SQLite on a volume and no other services.

## Quick start (Windows + Docker Desktop)

```powershell
cd C:\Users\Wycliffe\source\repos\easy-kanban
copy .env.example .env      # then edit ADMIN_EMAIL / ADMIN_PASSWORD
docker compose up -d --build
```

Open <http://localhost:8080> and sign in with the email and password from `.env`.

To update after changing code, run `docker compose up -d --build`. Your data stays in the `easy-kanban-data` volume.

### Using it on your phone

1. Your phone has to reach your PC:
   - **Same Wi-Fi:** use `http://<your-PC-LAN-IP>:8080`. Find the IP with `ipconfig`. You may need to allow port 8080 in Windows Firewall.
   - **Anywhere (recommended):** install [Tailscale](https://tailscale.com) on the PC and phone, then open `http://<pc-name>:8080`.
   - **Public:** put it behind Cloudflare Tunnel or a reverse proxy with HTTPS, and use a strong password.
2. Open the URL in Safari or Chrome, then choose **Share → Add to Home Screen** (iPhone) or **⋮ → Install app** (Android).

> iOS only allows installing the app and getting notifications over **HTTPS**. Tailscale (`tailscale serve`) or Cloudflare Tunnel gives you HTTPS for free.

## Connecting an agent

1. Go to **Agents → New agent** and copy the API key.
2. Choose one of these:
   - **MCP** (Claude Desktop, Claude Code, Hermes): download `http://localhost:8080/downloads/easy-kanban-mcp.mjs` and add it to your MCP config (see `docs/AGENTS.md`).
   - **HTTP**: the agent calls `POST /api/agent/claim` and the related endpoints with `Authorization: Bearer ek_…`. A ready-to-edit loop is in `examples/worker.mjs`.
   - **Webhook**: set the agent's webhook URL so it is told the moment a card is assigned (`examples/webhook-receiver.mjs`).

See **[docs/AGENTS.md](docs/AGENTS.md)** for the agent protocol and **[docs/API.md](docs/API.md)** for the full REST reference.

## Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | `admin@local` / `changeme` | Admin account created on first start. After that, change the password in Settings. |
| `PORT` | `8080` | Host port |
| `JWT_SECRET` | auto | Login token signing secret. Generated automatically and stored in the database if empty. |
| `TOKEN_TTL_DAYS` | `30` | How long a login lasts |
| `CORS_ORIGINS` | `*` | Origins allowed to call the API from another host, such as a mobile app in development |
| `AGENT_OFFLINE_MINUTES` | `15` | Agents without webhooks are shown offline after this much silence |
| `STALE_RUN_HOURS` | `6` | Runs that never report back are marked failed after this long |
| `LOG_LEVEL` / `LOG_REQUESTS` | `info` / off | Server logging |

## Backups

The data is one SQLite file in the volume. You can back it up two ways:
- In the app: **Settings → Export everything (JSON)**.
- Copy the database file: `docker cp easy-kanban:/data/easy-kanban.db ./backup.db` (stop the container first for a perfectly consistent copy).

## Development

```bash
npm install
npm run dev:server        # API on :8080 (tsx watch, data in ./data)
npm run dev:web           # Vite on :5173, proxies /api to :8080
npm run typecheck
npm run build             # server + web + MCP bundles
```

Requires Node 22.13+ (it uses the built-in `node:sqlite`).

## Project layout

```
apps/server     Fastify API, SQLite, SSE realtime, webhooks
apps/web        React + Vite PWA (responsive desktop + mobile)
packages/shared Types + fetch-based API client, reusable by a React Native/Expo app
mcp             MCP server for AI agents (bundled to one file)
docs            API reference, agent protocol, mobile app plan
examples        Agent worker and webhook receiver samples
```

The web app and agents use the same REST API, and `packages/shared` only needs `fetch`, so a native mobile app can reuse it directly. See [docs/MOBILE.md](docs/MOBILE.md).
