/**
 * QuotePal AI layer (Day 2 — Money ML upgrade).
 * - parseJob: messy job text → structured quote (LLM or offline heuristic)
 * - draftReminder: late-payment reminder copy (friendly / firm / final + A/B subjects)
 *
 * Keep return shapes stable for the UI. Optional fields may be added.
 */
import { config, loadPricebook } from './config.js';

const PARSE_SCHEMA = `Return ONLY JSON with keys:
customer_name (string), customer_email (string), customer_phone (string),
customer_address (string),
currency (string, default USD),
items (array of {name, qty, unit_price, unit, sku?, needs_review?}),
note (string),
confidence (0-1),
needs_review (boolean).
Match line items to the price list when possible. Infer qty=1 when omitted.
Include a trip/service call fee when the job implies an on-site visit and the list has one.
Flag needs_review true on the quote or any item when the match is weak or price was guessed.`;

const WORD_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5,
};

/** Extra synonyms beyond pricebook aliases (normalized keys → sku). */
const EXTRA_SYNONYMS = {
  'tap replace': 'faucet',
  'tap install': 'faucet',
  'kitchen faucet': 'faucet',
  'bathroom faucet': 'faucet',
  'new toilet': 'toilet',
  'toilet replacement': 'toilet',
  'garbage disposer': 'disposal',
  'disposall install': 'disposal',
  'clogged drain': 'drain',
  'clogged sink': 'drain',
  'sink clog': 'drain',
  'drain snake': 'drain',
  'snaked the drain': 'drain',
  'light switch': 'outlet',
  'wall outlet': 'outlet',
  'gfci': 'outlet',
  'ceilingfan': 'ceiling_fan',
  'fan hang': 'ceiling_fan',
  'dry wall': 'drywall_patch',
  'wall patch': 'drywall_patch',
  'patch hole': 'drywall_patch',
  'touch-up paint': 'paint_hr',
  'touchup': 'paint_hr',
  'painting hours': 'paint_hr',
  'paint job': 'paint_hr',
  'labor hours': 'labor_hr',
  'handyman hours': 'labor_hr',
  'hourly labor': 'labor_hr',
  'hrs labor': 'labor_hr',
  'house cleaning': 'clean_std',
  'standard cleaning': 'clean_std',
  'maid service': 'clean_std',
  'move-out clean': 'clean_deep',
  'moveout clean': 'clean_deep',
  'deep cleaning': 'clean_deep',
  'call-out': 'trip',
  'callout': 'trip',
  'service-call': 'trip',
  'trip fee': 'trip',
};

export async function parseJob(text, priceListText = '') {
  const book = loadPricebook();
  const listText = priceListText || formatPricebook(book);
  if (config.aiApiKey) {
    try {
      const out = await chatJson([
        { role: 'system', content: PARSE_SCHEMA + '\n\nPrice list:\n' + listText },
        { role: 'user', content: text },
      ]);
      return normalizeQuote(out, text, 'llm');
    } catch (e) {
      console.warn('[ai] LLM parse failed, using heuristic:', e.message);
    }
  }
  return normalizeQuote(heuristicParse(text, book), text, 'heuristic');
}

export async function draftReminder(invoice, tone = 'friendly') {
  const total = invoiceTotal(invoice);
  const days = daysSince(invoice.created_at);
  if (config.aiApiKey) {
    try {
      const out = await chatJson([
        {
          role: 'system',
          content:
            'Write a short late-payment reminder email as JSON {subject, body, subject_variants: [a,b]}. ' +
            'No threats or legal intimidation. Tone: ' + tone +
            '. Include two distinct subject line options in subject_variants; subject is the primary.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            customer_name: invoice.customer_name,
            business: loadPricebook().business_name,
            total,
            currency: invoice.currency || 'USD',
            days_outstanding: days,
            invoice_number: invoice.paypal_invoice_id || invoice.id.slice(0, 8),
            pay_link: invoice.pay_link || '',
          }),
        },
      ]);
      const variants = Array.isArray(out.subject_variants) && out.subject_variants.length
        ? out.subject_variants.map(String)
        : [out.subject || 'Friendly reminder', out.subject || 'Friendly reminder'];
      return {
        subject: out.subject || variants[0] || 'Friendly reminder',
        body: out.body || '',
        mode: 'llm',
        subject_variants: variants.slice(0, 2),
      };
    } catch (e) {
      console.warn('[ai] LLM reminder failed, using template:', e.message);
    }
  }
  return templateReminder(invoice, total, days, tone);
}

async function chatJson(messages) {
  const r = await fetch(`${config.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.aiModel,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      messages,
    }),
  });
  if (!r.ok) throw new Error(`ai ${r.status} ${await r.text()}`);
  const j = await r.json();
  return JSON.parse(j.choices[0].message.content);
}

/** Offline parse: qty x name @ price, OR pricebook alias matching with fuzzy qty/address NER. */
export function heuristicParse(text, book = loadPricebook()) {
  const items = [];
  const usedSkus = new Set();
  let priceGuessed = false;

  // Explicit "2 x faucet install @ 85" lines (preserve order; do not also alias-match these)
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*x\s*([^@\n,]+?)\s*@\s*\$?(\d+(?:\.\d+)?)/gi)) {
    const name = m[2].trim();
    const qty = Number(m[1]);
    const unit_price = Number(m[3]);
    const match = bestAliasMatch(name, book);
    const item = {
      name: match ? match.row.name : name,
      qty,
      unit_price,
      unit: match ? match.row.unit : 'each',
      sku: match ? match.row.sku : undefined,
      match_score: match ? match.score : 0.4,
      needs_review: !match || match.score < 0.7,
    };
    if (match) usedSkus.add(match.row.sku);
    items.push(item);
  }

  if (!items.length) {
    const matches = findPricebookMatches(text, book);
    for (const m of matches) {
      if (usedSkus.has(m.row.sku)) continue;
      usedSkus.add(m.row.sku);
      const qty = extractQtyNear(text, m.alias, m.row.unit);
      const weak = m.score < 0.75;
      items.push({
        name: m.row.name,
        qty,
        unit_price: m.row.unit_price,
        unit: m.row.unit,
        sku: m.row.sku,
        match_score: m.score,
        needs_review: weak,
      });
      if (weak) priceGuessed = true;
    }
  }

  // Auto trip fee for on-site vibes when not already present
  const onSite = /\b(house|home|apartment|install|clog|visit|come by|on[- ]?site|come over|stop by|at the (house|home|apt))\b/i.test(text);
  if (onSite && !items.some(i => /trip|service call/i.test(i.name) || i.sku === 'trip')) {
    const trip = book.items.find(i => i.sku === 'trip');
    if (trip) {
      items.unshift({
        name: trip.name,
        qty: 1,
        unit_price: trip.unit_price,
        unit: trip.unit,
        sku: trip.sku,
        match_score: 0.85,
        needs_review: false,
      });
    }
  }

  const email = extractEmail(text);
  const phone = extractPhone(text);
  const address = extractAddress(text);
  const customer_name = extractName(text, email, phone, address);

  const weakItems = items.filter(i => i.needs_review).length;
  let confidence = 0.15;
  if (items.length) {
    const avgScore = items.reduce((s, i) => s + (i.match_score || 0.5), 0) / items.length;
    confidence = Math.min(0.92, 0.35 + avgScore * 0.4 + (email ? 0.08 : 0) + (phone ? 0.05 : 0) + (address ? 0.05 : 0) + (customer_name !== 'Customer' ? 0.05 : 0));
    if (weakItems) confidence = Math.max(0.25, confidence - weakItems * 0.08);
  }

  const needs_review = !items.length || weakItems > 0 || priceGuessed || customer_name === 'Customer' || (!email && !phone);

  const noteBits = [];
  if (address) noteBits.push(`Job site: ${address}`);

  return {
    customer_name,
    customer_email: email,
    customer_phone: phone,
    customer_address: address,
    currency: book.currency || 'USD',
    items,
    note: noteBits.join(' '),
    confidence: Number(confidence.toFixed(3)),
    needs_review,
    line_flags: items.map(i => ({
      name: i.name,
      sku: i.sku,
      needs_review: Boolean(i.needs_review),
      match_score: i.match_score,
    })),
  };
}

function normalizeQuote(raw, sourceText, mode) {
  const items = Array.isArray(raw.items)
    ? raw.items
        .map(i => {
          const needs = i.needs_review === true || (Number(i.unit_price) === 0);
          return {
            name: String(i.name || 'Item').trim(),
            qty: Number(i.qty) || 1,
            unit_price: Number(i.unit_price) || 0,
            unit: i.unit || 'each',
            sku: i.sku || undefined,
            needs_review: needs || undefined,
            match_score: i.match_score,
          };
        })
        .filter(i => i.name && i.unit_price >= 0)
    : [];

  const anyItemReview = items.some(i => i.needs_review);
  const confidence = Number(raw.confidence) || (mode === 'llm' ? 0.8 : 0.5);
  const needs_review =
    raw.needs_review === true ||
    anyItemReview ||
    confidence < 0.5 ||
    !items.length;

  const out = {
    customer_name: String(raw.customer_name || 'Customer').trim(),
    customer_email: String(raw.customer_email || '').trim(),
    customer_phone: String(raw.customer_phone || '').trim(),
    currency: String(raw.currency || 'USD'),
    items: items.map(({ match_score, ...rest }) => {
      // keep needs_review on item; drop match_score from HTTP surface (optional keep via line_flags)
      const o = { ...rest };
      if (!o.needs_review) delete o.needs_review;
      if (!o.sku) delete o.sku;
      return o;
    }),
    note: String(raw.note || ''),
    confidence,
    source_text: sourceText,
    parse_mode: mode,
    needs_review,
  };

  const addr = String(raw.customer_address || '').trim();
  if (addr) out.customer_address = addr;

  if (Array.isArray(raw.line_flags)) {
    out.line_flags = raw.line_flags;
  } else {
    out.line_flags = items.map(i => ({
      name: i.name,
      sku: i.sku,
      needs_review: Boolean(i.needs_review),
      match_score: i.match_score,
    }));
  }

  return out;
}

function templateReminder(invoice, total, days, tone) {
  const name = invoice.customer_name || 'there';
  const biz = loadPricebook().business_name;
  const amt = `${invoice.currency || 'USD'} ${total.toFixed(2)}`;
  const invId = invoice.paypal_invoice_id || invoice.id.slice(0, 8);
  const link = invoice.pay_link ? `\n\nPay here: ${invoice.pay_link}` : '';
  const t = ['friendly', 'firm', 'final'].includes(tone) ? tone : 'friendly';

  const copy = {
    friendly: {
      subject_variants: [
        `Friendly reminder from ${biz}`,
        `Quick nudge — ${amt} still open`,
      ],
      body:
        `Hi ${name},\n\nJust a quick, friendly nudge — your invoice for ${amt} is still open (about ${days} day(s)). ` +
        `No rush if you're mid-week; whenever you can take care of it, we'd appreciate it.${link}\n\nThanks so much,\n${biz}`,
    },
    firm: {
      subject_variants: [
        `Invoice reminder — ${amt} still open`,
        `Please arrange payment for invoice ${invId}`,
      ],
      body:
        `Hi ${name},\n\nThis is a reminder that invoice ${invId} for ${amt} has been open for about ${days} day(s). ` +
        `Please arrange payment at your earliest convenience so we can close this out.${link}\n\nThanks,\n${biz}`,
    },
    final: {
      subject_variants: [
        `Final notice — invoice ${invId} (${amt})`,
        `Last reminder before we close the books — ${amt}`,
      ],
      body:
        `Hi ${name},\n\nThis is a final courtesy notice regarding invoice ${invId} for ${amt}, now outstanding about ${days} day(s). ` +
        `Please complete payment so we can mark this settled. We value your business and want to wrap this up cleanly — ` +
        `reach out if something on the invoice needs clarifying.${link}\n\nThank you,\n${biz}`,
    },
  };

  const pack = copy[t];
  return {
    subject: pack.subject_variants[0],
    body: pack.body,
    mode: 'template',
    subject_variants: pack.subject_variants,
  };
}

export function formatPricebook(book = loadPricebook()) {
  return book.items.map(i => `- ${i.name}: $${i.unit_price}/${i.unit} (aka: ${i.aliases.join(', ')})`).join('\n');
}

export function invoiceTotal(inv) {
  return (inv.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
}

function daysSince(iso) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plural-light fold: fans→fan, outlets→outlet, hours→hour, clogs→clog */
function stemLight(s) {
  const t = normalizeKey(s);
  if (t.endsWith('ies') && t.length > 4) return t.slice(0, -3) + 'y';
  if (t.endsWith('sses')) return t.slice(0, -2);
  if (t.endsWith('ches') || t.endsWith('shes')) return t.slice(0, -2);
  if (t.endsWith('s') && !t.endsWith('ss') && t.length > 3) return t.slice(0, -1);
  return t;
}

function buildAliasIndex(book) {
  const index = [];
  for (const row of book.items) {
    const aliases = new Set([row.name, row.sku, ...(row.aliases || [])]);
    for (const [syn, sku] of Object.entries(EXTRA_SYNONYMS)) {
      if (sku === row.sku) aliases.add(syn);
    }
    for (const a of aliases) {
      const key = normalizeKey(a);
      if (!key) continue;
      index.push({ alias: a, key, stem: stemLight(a), row, len: key.length });
    }
  }
  // Longer aliases first so "garbage disposal" beats "disposal" / "hour"
  index.sort((a, b) => b.len - a.len);
  return index;
}

function bestAliasMatch(phrase, book) {
  const index = buildAliasIndex(book);
  const key = normalizeKey(phrase);
  const stem = stemLight(phrase);
  let best = null;
  for (const entry of index) {
    let score = 0;
    if (key === entry.key) score = 1;
    else if (stem === entry.stem) score = 0.95;
    else if (key.includes(entry.key) || entry.key.includes(key)) score = 0.85;
    else if (stem.includes(entry.stem) || entry.stem.includes(stem)) score = 0.8;
    else continue;
    // Prefer longer alias at same score
    if (!best || score > best.score || (score === best.score && entry.len > best.len)) {
      best = { row: entry.row, score, alias: entry.alias, len: entry.len };
    }
  }
  return best;
}

function findPricebookMatches(text, book) {
  const index = buildAliasIndex(book);
  const lower = normalizeKey(text);
  const stemmedText = lower.split(' ').map(w => stemLight(w)).join(' ');
  const found = [];
  const hitSkus = new Set();

  for (const entry of index) {
    if (hitSkus.has(entry.row.sku)) continue;
    // Skip bare "hour"/"hourly" — require labor/handyman context (not paint hours)
    if (entry.row.sku === 'labor_hr' && (entry.key === 'hour' || entry.key === 'hourly' || entry.key === 'hrs')) {
      if (!/\b(labor|handyman|hourly\s+work|hrs?\s+of\s+labor|general\s+labor)\b/i.test(text)) {
        continue;
      }
    }
    if (entry.row.sku === 'paint_hr' && (entry.key === 'paint' || entry.key === 'painting' || entry.key === 'touch up')) {
      // ok — paint words are specific enough
    }

    let score = 0;
    let matchedAlias = entry.alias;

    // Hyphen/space insensitive whole-phrase includes
    const compact = lower.replace(/[-\s]/g, '');
    const entryCompact = entry.key.replace(/[-\s]/g, '');
    if (entry.key.length >= 3 && (lower.includes(entry.key) || compact.includes(entryCompact))) {
      score = entry.key.split(' ').length >= 2 ? 0.95 : 0.85;
    } else if (entry.stem.length >= 3 && stemmedText.includes(entry.stem)) {
      score = 0.8;
    } else {
      continue;
    }

    // Soft penalty for very short aliases that might be ambiguous
    if (entry.key.length <= 4 && score < 0.95) score = Math.min(score, 0.72);

    hitSkus.add(entry.row.sku);
    found.push({ row: entry.row, score, alias: matchedAlias });
  }

  return found;
}

function saneQty(n) {
  return Number.isFinite(n) && n > 0 && n <= 48;
}

function extractQtyNear(text, alias, unit) {
  const base = stemLight(alias);
  // Allow light plural/hyphen variants in the alias slot
  const a = `(?:${escapeRe(alias.toLowerCase())}|${escapeRe(base)}s?|${escapeRe(normalizeKey(alias))})`;
  // Mask phones so area codes aren't read as quantities
  const masked = text
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, ' ')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ');

  if (unit === 'hour') {
    const hrPatterns = [
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:hrs?|hours?)\\s+(?:of\\s+)?(?:${a})`, 'i'),
      new RegExp(`(?:${a})\\s*(?:for\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:hrs?|hours?)`, 'i'),
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:hrs?|hours?)\\s+(?:of\\s+)?(?:paint|painting|labor|handyman)`, 'i'),
      /\b(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i,
    ];
    for (const re of hrPatterns) {
      const m = masked.match(re);
      if (m && saneQty(Number(m[1]))) return Number(m[1]);
    }
    const wordHr = masked.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|half)\s*(?:hrs?|hours?)\b/i);
    if (wordHr) return WORD_NUM[wordHr[1].toLowerCase()] || 1;
  }

  const patterns = [
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*(?:${a})`, 'i'),
    new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(?:${a})\\b`, 'i'),
    new RegExp(`\\b(one|two|three|four|five|six|seven|eight|nine|ten|a|an)\\s+(?:${a})\\b`, 'i'),
    // trailing number only when joined by x/× (avoid "faucet\\n801-...")
    new RegExp(`(?:${a})\\s*[x×]\\s*(\\d+(?:\\.\\d+)?)`, 'i'),
  ];
  for (const re of patterns) {
    const m = masked.match(re);
    if (!m) continue;
    const raw = m[1];
    if (WORD_NUM[raw.toLowerCase()] != null) return WORD_NUM[raw.toLowerCase()];
    const n = Number(raw);
    if (saneQty(n)) return n;
  }
  return 1;
}

function extractEmail(text) {
  return (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
}

function extractPhone(text) {
  return (text.match(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/) || [''])[0];
}

function extractAddress(text) {
  // Mask email/phone so digits don't confuse street parsing
  const scrubbed = text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, ' ');

  const patterns = [
    // Standard: 123 Main St / 456 N Temple Ave, City ST 84101
    /\b(\d{1,5}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Way|Cir|Circle|Pl|Place|Pkwy|Parkway)\.?(?:\s*,?\s*[A-Za-z .'-]+)?(?:\s*,?\s*[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?)/,
    // Directional before street name: 88 W Temple Ave
    /\b(\d{1,5}\s+(?:N|S|E|W|North|South|East|West)\.?\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane)\.?)/i,
    // Salt Lake grid: 1420 E 2100 S[, City ST ZIP]
    /\b(\d{1,5}\s+[NSEW]\.?\s+\d{1,5}\s+[NSEW]\.?(?:\s*,?\s*[A-Za-z .'-]+)?(?:\s+[A-Z]{2})?(?:\s+\d{5}(?:-\d{4})?)?)/i,
  ];
  for (const re of patterns) {
    const m = scrubbed.match(re);
    if (m) return m[1].replace(/\s+/g, ' ').replace(/[,\s]+$/, '').trim();
  }
  return '';
}

function extractName(text, email, phone, address) {
  // Strip email/phone/address so they don't pollute name matches
  let scrubbed = text;
  if (email) scrubbed = scrubbed.replace(email, ' ');
  if (phone) scrubbed = scrubbed.replace(phone, ' ');
  if (address) scrubbed = scrubbed.replace(address, ' ');

  const labeled =
    scrubbed.match(/\b(?:for|customer|client|homeowner|home owner)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    scrubbed.match(/\b(?:name)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/) ||
    scrubbed.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:called|wants|needs|asked|texted|emailed)/) ||
    scrubbed.match(/(?:^|\n)\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\s*[-–—,:]/);

  if (labeled) return labeled[1].trim();

  // Fallback: first Title Case pair that isn't a street word or month-ish noise
  const skip = /^(Job|Went|House|Home|Street|Avenue|Road|Drive|North|South|East|West|Salt|Lake|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Deep|Standard|General|Interior|Ceiling|Garbage|Faucet|Toilet|Drain)$/;
  for (const m of scrubbed.matchAll(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g)) {
    if (skip.test(m[1]) || skip.test(m[2])) continue;
    return `${m[1]} ${m[2]}`;
  }
  return 'Customer';
}
