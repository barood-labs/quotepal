import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heuristicParse, draftReminder, invoiceTotal, parseJob } from '../server/ai.js';
import { toInvoice } from '../server/paypal.js';
import { loadPricebook } from '../server/config.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('heuristic parses explicit qty x name @ price', () => {
  const q = heuristicParse('Job for Maria Lopez maria@ex.com: 2 x faucet install @ 85, 1 x trip fee @ 40');
  assert.equal(q.items.length, 2);
  assert.equal(q.customer_name, 'Maria Lopez');
  assert.equal(q.customer_email, 'maria@ex.com');
  assert.equal(toInvoice(q, 'me@biz.com').items[0].unit_amount.value, '85.00');
});

test('heuristic matches pricebook aliases and adds trip fee', () => {
  const q = heuristicParse('Went to the house for Ana Ruiz ana@ex.com — clogged drain and faucet replacement');
  assert.ok(q.items.some(i => /drain|unclog/i.test(i.name)));
  assert.ok(q.items.some(i => /faucet/i.test(i.name)));
  assert.ok(q.items.some(i => /trip|service call/i.test(i.name)));
  assert.equal(q.customer_email, 'ana@ex.com');
});

test('invoice payload shape', () => {
  const book = loadPricebook();
  const q = {
    customer_name: 'Sam', customer_email: 'sam@ex.com', currency: book.currency,
    items: [{ name: 'Trip / service call', qty: 1, unit_price: 40 }],
  };
  const payload = toInvoice(q, 'merchant@example.com');
  assert.equal(payload.detail.currency_code, 'USD');
  assert.equal(payload.primary_recipients[0].billing_info.email_address, 'sam@ex.com');
  assert.equal(payload.items[0].quantity, '1');
});

test('reminder template + total', async () => {
  const inv = {
    id: 'abc12345zzzz',
    customer_name: 'Maria',
    currency: 'USD',
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    items: [{ name: 'Faucet', qty: 2, unit_price: 85 }],
    pay_link: 'https://example.com/pay',
  };
  assert.equal(invoiceTotal(inv), 170);
  const r = await draftReminder(inv, 'friendly');
  assert.match(r.subject, /reminder|Friendly/i);
  assert.match(r.body, /Maria/);
  assert.match(r.body, /170/);
});

test('extracts address, phone, and synonym faucet/drain from messy SMS', () => {
  const text = readFileSync(join(fixturesDir, 'messy_clog_sms.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.equal(q.customer_name, 'Ana Ruiz');
  assert.match(q.customer_email, /ana\.ruiz@gmail\.com/i);
  assert.ok(q.customer_phone);
  assert.ok(q.customer_address);
  assert.match(q.customer_address, /1420|2100|Salt Lake/i);
  assert.ok(q.items.some(i => /drain|unclog/i.test(i.name)));
  assert.ok(q.items.some(i => /faucet/i.test(i.name)));
  assert.ok(q.items.some(i => i.sku === 'trip' || /trip|service call/i.test(i.name)));
  assert.ok(typeof q.confidence === 'number' && q.confidence > 0.4);
  assert.ok(Array.isArray(q.line_flags));
});

test('word qty "three hours" maps to paint + drywall', () => {
  const text = readFileSync(join(fixturesDir, 'hours_paint_voicenote.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.equal(q.customer_name, 'Jordan Lee');
  const paint = q.items.find(i => i.sku === 'paint_hr' || /paint/i.test(i.name));
  assert.ok(paint, 'paint line expected');
  assert.equal(paint.qty, 3);
  assert.ok(q.items.some(i => /drywall|patch/i.test(i.name)));
});

test('multi qty outlets + ceiling fan', () => {
  const text = readFileSync(join(fixturesDir, 'multi_electrical.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.equal(q.customer_name, 'Sam Patel');
  const outlet = q.items.find(i => i.sku === 'outlet' || /outlet|switch/i.test(i.name));
  assert.ok(outlet);
  assert.equal(outlet.qty, 2);
  assert.ok(q.items.some(i => /ceiling fan|fan/i.test(i.name)));
  assert.ok(q.customer_address);
});

test('synonyms: toilet + garbage disposer + on-site trip', () => {
  const text = readFileSync(join(fixturesDir, 'toilet_disposal_cryptic.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.equal(q.customer_name, 'Priya Nair');
  assert.ok(q.items.some(i => /toilet/i.test(i.name)));
  assert.ok(q.items.some(i => /disposal/i.test(i.name)));
  assert.ok(q.items.some(i => /trip|service call/i.test(i.name)));
  assert.ok(q.customer_address);
});

test('needs_review true when match is weak / missing contact', () => {
  const text = readFileSync(join(fixturesDir, 'weak_guess.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.equal(q.needs_review, true);
  assert.ok(q.confidence < 0.6);
});

test('labor hours qty from "4 hrs handyman"', () => {
  const text = readFileSync(join(fixturesDir, 'labor_hours_messy.txt'), 'utf8');
  const q = heuristicParse(text);
  const labor = q.items.find(i => i.sku === 'labor_hr' || /labor|handyman/i.test(i.name));
  assert.ok(labor, 'labor line expected');
  assert.equal(labor.qty, 4);
  assert.equal(q.customer_email, 'alex.kim@work.io');
});

test('reminder tones friendly / firm / final expose A/B subject_variants', async () => {
  const inv = {
    id: 'inv99999zzzz',
    customer_name: 'Chris',
    currency: 'USD',
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    items: [{ name: 'Deep clean', qty: 1, unit_price: 220 }],
    pay_link: 'https://example.com/pay/x',
    paypal_invoice_id: 'INV-TEST-1',
  };
  for (const tone of ['friendly', 'firm', 'final']) {
    const r = await draftReminder(inv, tone);
    assert.ok(r.subject, `${tone} subject`);
    assert.ok(r.body.length > 40, `${tone} body`);
    assert.ok(Array.isArray(r.subject_variants) && r.subject_variants.length === 2, `${tone} variants`);
    assert.equal(r.subject, r.subject_variants[0]);
    assert.match(r.body, /Chris/);
    assert.doesNotMatch(r.body, /lawsuit|collections|attorney|garnish|threat/i);
  }
  const final = await draftReminder(inv, 'final');
  assert.match(final.subject, /final|last/i);
  assert.match(final.body, /final/i);
});

test('parseJob offline (no AI key) preserves HTTP shape + optional fields', async () => {
  const prev = process.env.AI_API_KEY;
  process.env.AI_API_KEY = '';
  try {
    const q = await parseJob('Went to the house for Ana Ruiz ana@ex.com — clogged drain');
    assert.ok(q.customer_name);
    assert.ok(Array.isArray(q.items));
    assert.ok('confidence' in q);
    assert.ok('source_text' in q);
    assert.ok('parse_mode' in q);
    assert.equal(q.parse_mode, 'heuristic');
    assert.ok('needs_review' in q);
    assert.ok(Array.isArray(q.line_flags));
  } finally {
    if (prev === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = prev;
  }
});

test('fixtures directory has at least 5 messy transcripts', () => {
  const files = readdirSync(fixturesDir).filter(f => f.endsWith('.txt'));
  assert.ok(files.length >= 5, `expected >=5 fixtures, got ${files.length}`);
  for (const f of files) {
    const body = readFileSync(join(fixturesDir, f), 'utf8').trim();
    assert.ok(body.length > 20, f);
  }
});

test('deep clean fixture matches deep clean sku', () => {
  const text = readFileSync(join(fixturesDir, 'deep_clean_moveout.txt'), 'utf8');
  const q = heuristicParse(text);
  assert.ok(q.items.some(i => i.sku === 'clean_deep' || /deep clean/i.test(i.name)));
  assert.equal(q.customer_name, 'Chris Wong');
});
