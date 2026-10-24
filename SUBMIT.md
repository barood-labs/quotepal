# QuotePal — Devpost draft (DO NOT SUBMIT YET)

**Target submit:** ~Nov 10, 2026 (hard stop Nov 12, 2026 12:00pm PST).  
**Event:** https://paypalaihackathon.devpost.com/  
**Rules:** https://paypalaihackathon.devpost.com/rules  
**Important:** Create a **new** software project. Do **not** edit the Wasl entry (https://devpost.com/software/wasl-41xru2).

---

## Project name
QuotePal

## Tagline / elevator (≤200 chars)
Talk the job, get paid. AI turns messy trades notes into itemized quotes, PayPal invoices, and polite late-payment reminders for solo plumbers, cleaners, and handymen.

## About the project

### Inspiration
Solo tradespeople finish a job and then spend 20 minutes typing an invoice on their phone, guessing prices, and chasing payment. QuotePal meets them where they already are: a voice note or SMS-style dump of what they just did.

### What it does
1. Paste or dictate a messy job summary (customer, address, work done, hours).
2. AI matches lines to the tradesperson’s **price book**, flags weak matches for review, and builds an itemized quote.
3. One tap creates and sends a **PayPal Invoicing v2** invoice with a pay link.
4. When payment is late, AI drafts a **friendly / firm / final** reminder with A/B subject lines and sends it through PayPal’s remind API.
5. Optional Orders v2 “pay now” link for faster checkout.

### How we built it
- **Node / Express** API + mobile-first vanilla UI (no heavy frontend framework).
- **PayPal Developer Platform:** Invoicing v2 (create, send, remind) and Orders v2 pay-now. Offline **mock** mode so judges can run the full loop without credentials.
- **AI:** Offline trades NER (name/email/phone/address, fuzzy SKU aliases, word quantities like “three hours”) with optional OpenAI-compatible LLM. Reminder copy tones + `subject_variants`.
- JSON price book + local store for demos.

### Challenges
- Keeping HTTP shapes stable while upgrading the AI layer so the UI never churned.
- Making “needs review” useful without shaming the user — small flags and a single banner.
- Proving uniqueness vs our other PayPal entry (Wasl): different audience, PayPal surfaces, and AI tasks.

### Accomplishments
- End-to-end mock path: parse → edit → invoice → remind (tests green).
- Review flags + address field + reminder A/B subjects in the mobile UI.
- Public OSS repo with MIT license and a short demo video.

### What we learned
Trades NLP is messy (synonyms, hours-as-words, phones that look like quantities). Confidence + review flags beat pretending every parse is perfect. PayPal Invoicing v2 is the right product surface for this audience — not escrow.

### What’s next
Live sandbox credentials by default for hosted demo, voice input (`webkitSpeechRecognition`), and webhook `INVOICING.INVOICE.PAID` to flip local status.

---

## Built with (tools list)
- PayPal Invoicing API v2
- PayPal Orders API v2
- Node.js / Express
- Vanilla JS / HTML / CSS
- OpenAI-compatible LLM (optional; heuristic offline fallback)
- ffmpeg / Chrome (demo recording)

## How AI is used
- Job note → structured quote (customer, address, line items vs price book, confidence, `needs_review` / `line_flags`)
- Late-payment reminder copy (tones + A/B subjects)

## How PayPal is used
- Invoicing v2: create invoice, send to customer, remind
- Orders v2: optional pay-now link
- Mock mode for zero-credential demos

## Links (fill at submit)
- **GitHub:** https://github.com/barood-labs/quotepal
- **Demo video (local):** `/workspace/bounty/drafts/quotepal/demo/quotepal_demo.mp4` (15.7s, also in repo `demo/quotepal_demo.mp4`)
- **Demo video (YouTube):** _not uploaded yet — Satr Tools Studio still needs phone verification for custom thumbnails; upload Public/Unlisted without custom thumb when Studio is ready, then paste URL here_
- **Try it:** `npm start` → http://localhost:8790 (mock PayPal)
- **License:** MIT (visible in repo About)

## Distinct from Wasl (for judges / duplicate-check)

| | Wasl | QuotePal |
|---|------|----------|
| Audience | Bilingual creators + brands | Solo trades / home services |
| Core loop | Chat → escrow hold → video verify → split payout | Job note → quote → invoice → remind |
| PayPal | Orders AUTHORIZE, capture/void, Payouts | Invoicing v2 create/send/remind, Orders pay-now |
| AI | Whisper, OCR, contract grounding | Job→quote NLP, reminder copy |

## Submit checklist (Day 4)
- [ ] Wasl Devpost entry untouched
- [ ] New Devpost software project created
- [ ] Public repo URL + MIT in About
- [ ] YouTube video &lt; 3 min, public or unlisted
- [ ] Built-with list includes PayPal + AI
- [ ] Screenshots optional
- [ ] Submit before Nov 12, 2026 12:00pm PST (prefer Nov 10)
