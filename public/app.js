const $ = (s) => document.querySelector(s);
let currentQuote = null;
let currentInvoice = null;
let lastReminder = null;
let pickedSubject = null;

const SAMPLE = `Just wrapped at Maria Lopez's place, 412 Oak St Apt 3 (maria.lopez@example.com, 801-555-0142). Replaced 2 kitchen faucets, snaked the clogged drain, and spent about 1 hour on general labor. She wants the invoice tonight.`;

async function boot() {
  const h = await fetch('/api/health').then(r => r.json());
  $('#modePill').textContent = `PayPal: ${h.paypal_mode}`;
  $('#aiPill').textContent = h.ai ? 'AI: LLM' : 'AI: heuristic';
  $('#footerMode').textContent = h.paypal_mode;
  const book = await fetch('/api/pricebook').then(r => r.json());
  $('#priceList').innerHTML = book.items.map(i =>
    `<li><strong>${i.name}</strong> — $${i.unit_price}/${i.unit}</li>`).join('');
}

$('#btnSample').onclick = () => { $('#jobText').value = SAMPLE; };
$('#btnParse').onclick = async () => {
  const text = $('#jobText').value.trim();
  if (!text) return hint('parseHint', 'Add some job notes first.', true);
  $('#btnParse').disabled = true;
  hint('parseHint', 'Parsing…');
  try {
    const q = await api('POST', '/api/parse', { text });
    currentQuote = q;
    showQuote(q);
    const conf = ((q.confidence || 0) * 100).toFixed(0);
    const flag = q.needs_review ? ' · flagged for review' : '';
    hint('parseHint', `Parsed with ${q.parse_mode} (confidence ${conf}%${flag}). Edit anything, then invoice.`, false);
  } catch (e) {
    hint('parseHint', e.message, true);
  } finally {
    $('#btnParse').disabled = false;
  }
};

function showQuote(q) {
  $('#quoteCard').hidden = false;
  $('#quoteMeta').textContent = `#${q.id.slice(0, 8)} · ${q.status}`;
  $('#custName').value = q.customer_name || '';
  $('#custEmail').value = q.customer_email || '';
  $('#custPhone').value = q.customer_phone || '';
  $('#custAddress').value = q.customer_address || '';
  $('#currency').value = q.currency || 'USD';
  $('#note').value = q.note || '';
  const banner = $('#reviewBanner');
  if (q.needs_review) {
    banner.hidden = false;
    const weak = (q.line_flags || []).filter(f => f.needs_review).map(f => f.name);
    $('#reviewBannerText').textContent = weak.length
      ? `Check: ${weak.slice(0, 3).join(', ')}${weak.length > 3 ? '…' : ''}`
      : 'Some customer fields or matches look weak — check before invoicing.';
  } else {
    banner.hidden = true;
  }
  renderItems(q.items || []);
  retotal();
}

function flagFor(it, idx) {
  const fromItem = it.needs_review === true;
  const fromFlags = (currentQuote?.line_flags || []).find(f =>
    (f.sku && it.sku && f.sku === it.sku) || f.name === it.name);
  return fromItem || Boolean(fromFlags?.needs_review);
}

function renderItems(items) {
  const tb = $('#itemsTable tbody');
  tb.innerHTML = '';
  items.forEach((it, idx) => {
    const tr = document.createElement('tr');
    if (flagFor(it, idx)) tr.classList.add('needs-review');
    const flag = flagFor(it, idx)
      ? `<span class="flag" title="Needs review">!</span>`
      : `<span class="flag ok" title="Matched">✓</span>`;
    tr.innerHTML = `
      <td class="flag-cell">${flag}</td>
      <td><input data-k="name" data-i="${idx}" value="${esc(it.name)}" /></td>
      <td style="width:70px"><input data-k="qty" data-i="${idx}" type="number" step="0.1" value="${it.qty}" /></td>
      <td style="width:90px"><input data-k="unit_price" data-i="${idx}" type="number" step="0.01" value="${it.unit_price}" /></td>
      <td><button type="button" class="ghost" data-del="${idx}">×</button></td>`;
    tb.appendChild(tr);
  });
  tb.querySelectorAll('input').forEach(inp => inp.addEventListener('input', onItemEdit));
  tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    currentQuote.items.splice(Number(b.dataset.del), 1);
    if (currentQuote.line_flags) currentQuote.line_flags.splice(Number(b.dataset.del), 1);
    renderItems(currentQuote.items);
    retotal();
  });
}

function onItemEdit(e) {
  const i = Number(e.target.dataset.i);
  const k = e.target.dataset.k;
  let v = e.target.value;
  if (k !== 'name') v = Number(v);
  currentQuote.items[i][k] = v;
  if (k === 'name' || k === 'unit_price') {
    currentQuote.items[i].needs_review = false;
  }
  retotal();
}

$('#btnAddItem').onclick = () => {
  currentQuote.items.push({ name: 'New item', qty: 1, unit_price: 0, unit: 'each', needs_review: true });
  renderItems(currentQuote.items);
  retotal();
};

function gatherQuoteFields() {
  currentQuote.customer_name = $('#custName').value.trim();
  currentQuote.customer_email = $('#custEmail').value.trim();
  currentQuote.customer_phone = $('#custPhone').value.trim();
  currentQuote.customer_address = $('#custAddress').value.trim();
  currentQuote.currency = $('#currency').value.trim() || 'USD';
  currentQuote.note = $('#note').value;
}

function quotePatchBody() {
  const items = currentQuote.items || [];
  const stillWeak = items.some(it => it.needs_review) || !(currentQuote.customer_email || '').trim();
  return {
    customer_name: currentQuote.customer_name,
    customer_email: currentQuote.customer_email,
    customer_phone: currentQuote.customer_phone,
    customer_address: currentQuote.customer_address,
    currency: currentQuote.currency,
    items,
    note: currentQuote.note,
    needs_review: stillWeak,
  };
}

$('#btnSave').onclick = async () => {
  gatherQuoteFields();
  currentQuote = await api('PATCH', `/api/quotes/${currentQuote.id}`, quotePatchBody());
  showQuote(currentQuote);
  hint('invoiceHint', 'Saved.', false);
};

$('#btnInvoice').onclick = async () => {
  gatherQuoteFields();
  await api('PATCH', `/api/quotes/${currentQuote.id}`, quotePatchBody());
  $('#btnInvoice').disabled = true;
  hint('invoiceHint', 'Creating PayPal invoice…');
  try {
    const out = await api('POST', `/api/quotes/${currentQuote.id}/invoice`, {});
    currentInvoice = out.invoice;
    lastReminder = null;
    pickedSubject = null;
    showInvoice(out.invoice);
    hint('invoiceHint', `Invoice sent via PayPal (${out.mode}).`, false);
  } catch (e) {
    hint('invoiceHint', e.message, true);
  } finally {
    $('#btnInvoice').disabled = false;
  }
};

function showInvoice(inv) {
  $('#invoiceCard').hidden = false;
  $('#invoiceKv').innerHTML = `
    <dt>Status</dt><dd>${esc(inv.status)}</dd>
    <dt>PayPal id</dt><dd>${esc(inv.paypal_invoice_id || '—')}</dd>
    <dt>Customer</dt><dd>${esc(inv.customer_name)} · ${esc(inv.customer_email)}</dd>
    <dt>Total</dt><dd>${esc(inv.currency)} ${Number(inv.total).toFixed(2)}</dd>
    <dt>Reminders</dt><dd>${inv.reminder_count || 0}</dd>`;
  const a = $('#payLink');
  a.href = inv.pay_link || '#';
  a.style.pointerEvents = inv.pay_link ? '' : 'none';
}

$('#btnRemind').onclick = async () => {
  if (!currentInvoice) return;
  $('#btnRemind').disabled = true;
  try {
    const tone = $('#remindTone').value || 'friendly';
    const out = await api('POST', `/api/invoices/${currentInvoice.id}/remind`, { tone });
    currentInvoice = out.invoice;
    lastReminder = out.reminder;
    showInvoice(out.invoice);
    renderSubjectVariants(out.reminder);
    const pre = $('#remindPreview');
    pre.hidden = false;
    const subj = pickedSubject || out.reminder.subject;
    pre.textContent = `Subject: ${subj}\n\n${out.reminder.body}\n\n— via ${out.reminder.mode} · tone ${tone}`;
  } catch (e) {
    hint('invoiceHint', e.message, true);
  } finally {
    $('#btnRemind').disabled = false;
  }
};

function renderSubjectVariants(rem) {
  const wrap = $('#subjectPick');
  const row = $('#subjectVariants');
  const variants = Array.isArray(rem.subject_variants) ? rem.subject_variants.filter(Boolean) : [];
  if (!variants.length) {
    wrap.hidden = true;
    row.innerHTML = '';
    pickedSubject = rem.subject || null;
    return;
  }
  wrap.hidden = false;
  pickedSubject = rem.subject || variants[0];
  row.innerHTML = '';
  variants.slice(0, 2).forEach((s, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip' + (s === pickedSubject ? ' active' : '');
    btn.textContent = `Option ${i === 0 ? 'A' : 'B'}: ${s}`;
    btn.onclick = () => {
      pickedSubject = s;
      row.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const pre = $('#remindPreview');
      if (!pre.hidden && lastReminder) {
        pre.textContent = `Subject: ${pickedSubject}\n\n${lastReminder.body}\n\n— via ${lastReminder.mode}`;
      }
    };
    row.appendChild(btn);
  });
}

function retotal() {
  const t = (currentQuote?.items || []).reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
  $('#totalAmt').textContent = `$${t.toFixed(2)}`;
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function hint(id, msg, err) {
  const el = document.getElementById(id);
  el.textContent = msg || '';
  el.className = 'hint' + (err ? ' err' : msg ? ' ok' : '');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

boot().catch(console.error);
