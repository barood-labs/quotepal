/**
 * PayPal sandbox client for QuotePal.
 * Surfaces: OAuth2, Invoicing v2 (create / send / remind / get), Orders v2 pay-now (optional).
 * When PAYPAL_ENV=mock, all calls go through mock-paypal.js so judges can run offline.
 */
import { config } from './config.js';
import * as mock from './mock-paypal.js';

const useMock = () => (config.paypalEnv || 'mock').toLowerCase() === 'mock'
  || !config.paypalClientId || !config.paypalClientSecret;

let tok;

async function token() {
  if (useMock()) return 'mock-token';
  if (tok && tok.exp > Date.now()) return tok.v;
  const r = await fetch(`${config.paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('paypal auth ' + r.status + ' ' + await r.text());
  const j = await r.json();
  tok = { v: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return tok.v;
}

async function call(method, path, body) {
  if (useMock()) return mock.call(method, path, body);
  const r = await fetch(config.paypalBase + path, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`paypal ${path} ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

export function mode() {
  return useMock() ? 'mock' : 'sandbox';
}

export function toInvoicePayload(quote, merchantEmail) {
  return {
    detail: {
      invoice_number: quote.invoice_number || undefined,
      currency_code: quote.currency || 'USD',
      note: quote.note || 'Thank you for your business.',
      payment_term: { term_type: 'NET_10' },
    },
    invoicer: { email_address: merchantEmail || config.merchantEmail },
    primary_recipients: [{
      billing_info: {
        email_address: quote.customer_email,
        name: { full_name: quote.customer_name || 'Customer' },
        ...(quote.customer_phone ? { phones: [{ country_code: '1', national_number: quote.customer_phone.replace(/\D/g, '').slice(-10), phone_type: 'MOBILE' }] } : {}),
      },
    }],
    items: (quote.items || []).map(i => ({
      name: i.name,
      quantity: String(i.qty),
      unit_amount: { currency_code: quote.currency || 'USD', value: Number(i.unit_price).toFixed(2) },
      unit_of_measure: i.unit === 'hour' ? 'HOURS' : 'QUANTITY',
    })),
  };
}

export async function createInvoice(quote) {
  return call('POST', '/v2/invoicing/invoices', toInvoicePayload(quote));
}

export async function sendInvoice(invoiceIdOrHref) {
  const path = invoiceIdOrHref.startsWith('http')
    ? new URL(invoiceIdOrHref).pathname + '/send'
    : `/v2/invoicing/invoices/${invoiceIdOrHref}/send`;
  return call('POST', path, { send_to_invoicer: true, send_to_recipient: true });
}

export async function remindInvoice(invoiceId, { subject, note } = {}) {
  return call('POST', `/v2/invoicing/invoices/${invoiceId}/remind`, {
    subject: subject || 'Friendly reminder',
    note: note || 'Just a gentle nudge on the open invoice.',
  });
}

export async function getInvoice(invoiceId) {
  return call('GET', `/v2/invoicing/invoices/${invoiceId}`);
}

/** Optional pay-now: create an Orders v2 order for the quote total. */
export async function createOrder(quote) {
  const total = (quote.items || []).reduce((s, i) => s + i.qty * i.unit_price, 0).toFixed(2);
  return call('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: quote.currency || 'USD', value: total },
      description: `Quote for ${quote.customer_name || 'customer'}`,
    }],
    payment_source: {
      paypal: {
        experience_context: {
          payment_method_preference: 'IMMEDIATE_PAYMENT_REQUIRED',
          user_action: 'PAY_NOW',
          return_url: 'http://localhost:8790/?paid=1',
          cancel_url: 'http://localhost:8790/?cancel=1',
        },
      },
    },
  });
}

export { toInvoicePayload as toInvoice };
