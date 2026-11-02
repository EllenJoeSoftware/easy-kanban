// Minimal Easy Kanban agent worker — no dependencies, Node 18+.
//   EASY_KANBAN_URL=http://localhost:8080 EASY_KANBAN_API_KEY=ek_... node examples/worker.mjs
// Replace doWork() with your agent (Claude API call, script, n8n webhook, ...).

const BASE = (process.env.EASY_KANBAN_URL ?? 'http://localhost:8080') + '/api';
const KEY = process.env.EASY_KANBAN_API_KEY;
const POLL_MS = Number(process.env.POLL_MS ?? 30_000);
if (!KEY) throw new Error('Set EASY_KANBAN_API_KEY');

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${data.error ?? res.status}`);
  return data;
}

/** Your agent logic. Return { result, tokensIn?, tokensOut?, costUsd? }.
 *  Throw to fail the card. Call log() to post progress. Return { question } to ask the human. */
async function doWork(card, log) {
  await log(`Starting on "${card.title}"`, 10);
  // e.g. call the Claude API with card.description as the prompt ...
  await new Promise((r) => setTimeout(r, 2000));
  await log('Draft ready', 80);
  return { result: `## Result for #${card.number}\n\n(Replace this with real output.)`, costUsd: 0 };
}

async function tick() {
  const { card, reason } = await api('POST', '/agent/claim', {});
  if (!card) {
    await api('POST', '/agent/heartbeat', { status: 'idle', note: reason ?? 'Waiting for work' });
    return false;
  }
  console.log(`Claimed #${card.number} ${card.title}`);
  const log = (message, progress) => api('POST', `/agent/cards/${card.id}/log`, { message, progress });
  try {
    const out = await doWork(card, log);
    if (out?.question) {
      await api('POST', `/agent/cards/${card.id}/ask`, { question: out.question });
    } else {
      await api('POST', `/agent/cards/${card.id}/complete`, out ?? {});
      console.log(`Completed #${card.number}`);
    }
  } catch (e) {
    await api('POST', `/agent/cards/${card.id}/fail`, { error: String(e?.message ?? e), retry: false });
    console.error(`Failed #${card.number}:`, e);
  }
  return true;
}

for (;;) {
  try {
    const worked = await tick();
    if (worked) continue; // immediately look for more work
  } catch (e) {
    console.error(e.message);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
