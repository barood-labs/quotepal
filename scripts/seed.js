import { newQuote, newInvoice } from '../server/store.js';

const q = newQuote({
  customer_name: 'Demo Customer',
  customer_email: 'demo@example.com',
  source_text: 'seed',
  parse_mode: 'seed',
  items: [
    { name: 'Trip / service call', qty: 1, unit_price: 40, unit: 'each' },
    { name: 'Faucet install', qty: 1, unit_price: 85, unit: 'each' },
  ],
  status: 'draft',
});
newInvoice({
  quote_id: q.id,
  customer_name: q.customer_name,
  customer_email: q.customer_email,
  currency: 'USD',
  items: q.items,
  total: 125,
  status: 'DRAFT',
  note: 'Seed invoice (not sent)',
});
console.log('Seeded quote', q.id);
