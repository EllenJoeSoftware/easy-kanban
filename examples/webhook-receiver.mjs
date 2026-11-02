// Example webhook receiver that verifies Easy Kanban signatures.
//   WEBHOOK_SECRET=... node examples/webhook-receiver.mjs   (listens on :9000)
import http from 'node:http';
import crypto from 'node:crypto';

const SECRET = process.env.WEBHOOK_SECRET ?? '';

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const expected = 'sha256=' + crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    const got = req.headers['x-easykanban-signature'] ?? '';
    if (got.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))) {
      res.writeHead(401).end('bad signature');
      return;
    }
    const event = JSON.parse(body);
    console.log(event.event, event.card ? `#${event.card.number} ${event.card.title}` : '');
    // e.g. on 'card.assigned' → start your agent, which then calls /api/agent/claim
    res.writeHead(200).end('ok');
  });
}).listen(9000, () => console.log('Listening on :9000'));
