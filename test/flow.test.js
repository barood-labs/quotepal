import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8799;

async function waitReady(url, ms = 8000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('server not ready');
}

test('end-to-end mock: parse → invoice → remind', async (t) => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), PAYPAL_ENV: 'mock', AI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill('SIGTERM'); });
  await waitReady(`http://127.0.0.1:${PORT}/api/health`);

  const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then(r => r.json());
  assert.equal(health.paypal_mode, 'mock');

  const quote = await fetch(`http://127.0.0.1:${PORT}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Job for Maria Lopez maria@ex.com: 2 x faucet install @ 85, 1 x trip fee @ 40',
    }),
  }).then(r => r.json());
  assert.ok(quote.id);
  assert.equal(quote.items.length, 2);

  const invRes = await fetch(`http://127.0.0.1:${PORT}/api/quotes/${quote.id}/invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).then(r => r.json());
  assert.ok(invRes.invoice?.paypal_invoice_id);
  assert.equal(invRes.invoice.status, 'SENT');
  assert.ok(invRes.invoice.pay_link);

  const rem = await fetch(`http://127.0.0.1:${PORT}/api/invoices/${invRes.invoice.id}/remind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tone: 'friendly' }),
  }).then(r => r.json());
  assert.equal(rem.invoice.reminder_count, 1);
  assert.ok(rem.reminder.body.length > 20);
});
