import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

function empty() {
  return { quotes: [], invoices: [], reminders: [] };
}

function read() {
  if (!existsSync(config.storePath)) return empty();
  try { return { ...empty(), ...JSON.parse(readFileSync(config.storePath, 'utf8')) }; }
  catch { return empty(); }
}

function write(data) {
  mkdirSync(dirname(config.storePath), { recursive: true });
  writeFileSync(config.storePath, JSON.stringify(data, null, 2));
}

export function listQuotes() { return read().quotes; }
export function getQuote(id) { return read().quotes.find(q => q.id === id); }
export function saveQuote(quote) {
  const data = read();
  const i = data.quotes.findIndex(q => q.id === quote.id);
  if (i >= 0) data.quotes[i] = quote; else data.quotes.unshift(quote);
  write(data);
  return quote;
}
export function newQuote(partial) {
  const q = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: 'draft',
    currency: 'USD',
    customer_name: '',
    customer_email: '',
    customer_phone: '',
    items: [],
    note: '',
    source_text: '',
    parse_mode: 'heuristic',
    ...partial,
  };
  return saveQuote(q);
}

export function listInvoices() { return read().invoices; }
export function getInvoice(id) { return read().invoices.find(i => i.id === id); }
export function saveInvoice(inv) {
  const data = read();
  const i = data.invoices.findIndex(x => x.id === inv.id);
  if (i >= 0) data.invoices[i] = inv; else data.invoices.unshift(inv);
  write(data);
  return inv;
}
export function newInvoice(partial) {
  const inv = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    status: 'DRAFT',
    paypal_invoice_id: null,
    paypal_href: null,
    pay_link: null,
    quote_id: null,
    reminder_count: 0,
    last_reminded_at: null,
    ...partial,
  };
  return saveInvoice(inv);
}

export function addReminder(entry) {
  const data = read();
  data.reminders.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
  write(data);
  return data.reminders[0];
}
export function listReminders() { return read().reminders; }
