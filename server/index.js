import express from 'express';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, loadPricebook } from './config.js';
import { parseJob, draftReminder, invoiceTotal, formatPricebook } from './ai.js';
import * as paypal from './paypal.js';
import * as store from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(__dirname, '..', 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    name: 'quotepal',
    paypal_mode: paypal.mode(),
    ai: Boolean(config.aiApiKey),
    deadline_note: 'PayPal AI Hackathon submit by Nov 12, 2026 12:00pm PST',
  });
});

app.get('/api/pricebook', (_req, res) => res.json(loadPricebook()));

app.get('/api/quotes', (_req, res) => res.json(store.listQuotes()));
app.get('/api/quotes/:id', (req, res) => {
  const q = store.getQuote(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  res.json(q);
});

/** AI (or heuristic) parse of messy job text → draft quote. */
app.post('/api/parse', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const parsed = await parseJob(text, req.body?.priceList);
    const quote = store.newQuote({ ...parsed, status: 'draft' });
    res.json(quote);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Edit / confirm a draft quote before invoicing. */
app.patch('/api/quotes/:id', (req, res) => {
  const q = store.getQuote(req.params.id);
  if (!q) return res.status(404).json({ error: 'not found' });
  const allowed = ['customer_name', 'customer_email', 'customer_phone', 'customer_address', 'items', 'note', 'currency', 'status', 'needs_review'];
  for (const k of allowed) if (req.body[k] !== undefined) q[k] = req.body[k];
  q.updated_at = new Date().toISOString();
  res.json(store.saveQuote(q));
});

/** Create + send PayPal invoice from a confirmed quote. */
app.post('/api/quotes/:id/invoice', async (req, res) => {
  try {
    const q = store.getQuote(req.params.id);
    if (!q) return res.status(404).json({ error: 'not found' });
    if (!q.customer_email) return res.status(400).json({ error: 'customer_email required' });
    if (!q.items?.length) return res.status(400).json({ error: 'items required' });

    const created = await paypal.createInvoice(q);
    const paypalId = created.id;
    const sendResult = await paypal.sendInvoice(created.href || paypalId);
    const payLink = sendResult.pay_link
      || (created.links || []).find(l => l.rel === 'payer-view')?.href
      || `https://www.sandbox.paypal.com/invoice/p/#${paypalId}`;

    q.status = 'invoiced';
    store.saveQuote(q);

    const inv = store.newInvoice({
      quote_id: q.id,
      paypal_invoice_id: paypalId,
      paypal_href: created.href,
      pay_link: payLink,
      status: 'SENT',
      customer_name: q.customer_name,
      customer_email: q.customer_email,
      currency: q.currency,
      items: q.items,
      total: invoiceTotal(q),
      note: q.note,
    });
    res.json({ invoice: inv, paypal: { created, sendResult }, mode: paypal.mode() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/invoices', (_req, res) => res.json(store.listInvoices()));
app.get('/api/invoices/:id', async (req, res) => {
  const inv = store.getInvoice(req.params.id);
  if (!inv) return res.status(404).json({ error: 'not found' });
  try {
    if (inv.paypal_invoice_id) {
      const live = await paypal.getInvoice(inv.paypal_invoice_id);
      inv.status = live.status || inv.status;
      store.saveInvoice(inv);
    }
  } catch { /* keep cached */ }
  res.json(inv);
});

/** AI-drafted reminder + PayPal Invoicing remind call. */
app.post('/api/invoices/:id/remind', async (req, res) => {
  try {
    const inv = store.getInvoice(req.params.id);
    if (!inv) return res.status(404).json({ error: 'not found' });
    const tone = req.body?.tone || 'friendly';
    const draft = await draftReminder(inv, tone);
    if (inv.paypal_invoice_id) {
      await paypal.remindInvoice(inv.paypal_invoice_id, { subject: draft.subject, note: draft.body.slice(0, 2000) });
    }
    inv.reminder_count = (inv.reminder_count || 0) + 1;
    inv.last_reminded_at = new Date().toISOString();
    store.saveInvoice(inv);
    const log = store.addReminder({ invoice_id: inv.id, ...draft, tone });
    res.json({ invoice: inv, reminder: draft, log });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Optional Orders v2 pay-now link for a quote. */
app.post('/api/quotes/:id/paynow', async (req, res) => {
  try {
    const q = store.getQuote(req.params.id);
    if (!q) return res.status(404).json({ error: 'not found' });
    const order = await paypal.createOrder(q);
    const link = (order.links || []).find(l => l.rel === 'payer-action')?.href;
    res.json({ order, pay_link: link, mode: paypal.mode() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/meta', (_req, res) => {
  res.json({
    product: 'QuotePal',
    tagline: 'Talk the job, get paid.',
    audience: 'Solo tradespeople (plumbers, cleaners, handymen)',
    paypal: ['Invoicing v2 create/send/remind', 'Orders v2 pay-now'],
    ai: ['job→quote parse', 'late-payment reminder copy'],
    distinct_from_wasl: 'Wasl = bilingual creator escrow (Orders AUTHORIZE + Payouts + Whisper/OCR). QuotePal = trades quotes + invoices + reminders.',
    pricebook_preview: formatPricebook().split('\n').slice(0, 4),
  });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`QuotePal on http://localhost:${config.port}  paypal=${paypal.mode()}  ai=${config.aiApiKey ? 'on' : 'heuristic'}`);
});
