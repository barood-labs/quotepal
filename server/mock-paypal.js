/**
 * Offline PayPal Invoicing v2 + Orders v2 simulator.
 * Mirrors the shapes QuotePal needs so judges can click through without sandbox creds.
 */
import { randomUUID } from 'node:crypto';

const invoices = new Map();
const orders = new Map();

export function call(method, path, body) {
  // CREATE invoice
  if (method === 'POST' && path === '/v2/invoicing/invoices') {
    const id = 'INV2-' + randomUUID().slice(0, 8).toUpperCase();
    const href = `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}`;
    const total = (body.items || []).reduce((s, i) => s + Number(i.quantity) * Number(i.unit_amount.value), 0);
    const inv = {
      id,
      status: 'DRAFT',
      detail: body.detail,
      invoicer: body.invoicer,
      primary_recipients: body.primary_recipients,
      items: body.items,
      amount: { currency_code: body.detail?.currency_code || 'USD', value: total.toFixed(2) },
      links: [
        { rel: 'self', href, method: 'GET' },
        { rel: 'send', href: href + '/send', method: 'POST' },
        { rel: 'replace', href, method: 'PUT' },
      ],
      href,
    };
    invoices.set(id, inv);
    return { ...inv, href };
  }

  // SEND
  const send = path.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/send$/);
  if (method === 'POST' && send) {
    const inv = invoices.get(send[1]);
    if (!inv) throw new Error('mock invoice not found');
    inv.status = 'SENT';
    inv.pay_link = `https://www.sandbox.paypal.com/invoice/p/#${inv.id}`;
    inv.links = (inv.links || []).concat([{ rel: 'payer-view', href: inv.pay_link, method: 'GET' }]);
    return { href: inv.href, pay_link: inv.pay_link, status: inv.status };
  }

  // REMIND
  const rem = path.match(/^\/v2\/invoicing\/invoices\/([^/]+)\/remind$/);
  if (method === 'POST' && rem) {
    const inv = invoices.get(rem[1]);
    if (!inv) throw new Error('mock invoice not found');
    inv.reminder_count = (inv.reminder_count || 0) + 1;
    inv.last_reminded_at = new Date().toISOString();
    return { ok: true, reminder_count: inv.reminder_count, subject: body?.subject };
  }

  // GET
  const get = path.match(/^\/v2\/invoicing\/invoices\/([^/]+)$/);
  if (method === 'GET' && get) {
    const inv = invoices.get(get[1]);
    if (!inv) throw new Error('mock invoice not found');
    return inv;
  }

  // Orders create
  if (method === 'POST' && path === '/v2/checkout/orders') {
    const id = 'ORDER-' + randomUUID().slice(0, 8).toUpperCase();
    const order = {
      id,
      status: 'PAYER_ACTION_REQUIRED',
      links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}`, method: 'GET' }],
      purchase_units: body.purchase_units,
    };
    orders.set(id, order);
    return order;
  }

  throw new Error(`mock paypal unimplemented ${method} ${path}`);
}

export function _reset() { invoices.clear(); orders.clear(); }
