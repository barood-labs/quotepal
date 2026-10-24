# QuotePal — 2–4 day ship plan (Bounty product + Money ML)

**Deadline:** Thu Nov 12, 2026 12:00pm PST (= 1:00pm America/Denver)  
**Devpost:** second unique entry; **do not touch Wasl**  
**Rules:** multiple submissions OK if unique & substantially different (Official Rules §4).

## Day 0 status (done this pass)

- [x] Product shell at `/workspace/bounty/drafts/quotepal/`
- [x] Mock PayPal Invoicing v2 + Orders pay-now
- [x] Heuristic AI parse + reminder templates (LLM optional)
- [x] Mobile-first UI: parse → edit → invoice → remind
- [x] Price book, tests, README, MIT
- [ ] Sandbox live invoice (needs PayPal REST app creds in `.env`)
- [ ] Public `barood-labs/quotepal` repo
- [ ] <3 min YouTube demo
- [ ] Devpost submission (hold until above)

## Uniqueness vs Wasl (keep this sharp in the writeup)

| | Wasl | QuotePal |
|---|------|----------|
| Audience | Bilingual creators + brands | Solo trades / home services |
| Core loop | Chat → escrow hold → video verify → split payout | Job note → quote → invoice → remind |
| PayPal | Orders AUTHORIZE, capture/void, Payouts | Invoicing v2 create/send/remind, Orders pay-now |
| AI | Whisper, OCR, contract grounding, AG Grid NL | Job→quote NLP, reminder copy |
| Language | EN + Arabic RTL | EN (trades US) |

## Day 1 — sandbox + polish (Bounty)

1. Create/confirm PayPal sandbox merchant app; put creds in `.env` (`PAYPAL_ENV=sandbox`).
2. End-to-end: parse sample → send real sandbox invoice → open pay link as sandbox personal buyer → remind.
3. Webhook stub (optional): `INVOICING.INVOICE.PAID` → flip local status (nice-to-have, not blocker).
4. Voice input in UI (`webkitSpeechRecognition` / MediaRecorder → same `/api/parse`) — 1–2 hours.
5. README screenshots + `npm test` green on clean clone.

## Day 2 — Money ML upgrade

**Status: done (Money, Oct 23 evening MT).** `npm test` 15/15.

1. Money replaces/extends `server/ai.js`:
   - Stronger job NER (customer, address, SKUs, hours) against `data/pricebook.json`.
   - Confidence + “needs review” flags for low-match lines.
   - Reminder tones: friendly / firm / final, with A/B subject lines.
2. Keep HTTP response shapes stable so UI doesn’t churn.
3. Add 5–10 fixture transcripts in `test/fixtures/` (messy real-world notes).

## Day 3 — demo + packaging

1. Record <3 min YouTube (no copyrighted music): problem → sample job → quote edit → PayPal invoice → reminder.
2. Push public GitHub `barood-labs/quotepal`, MIT license visible in About, topics.
3. Optional: Render blueprint (copy Wasl pattern) for hosted demo URL — helps Design/Presentation scores.
4. Draft Devpost text (About / Built with / How AI + PayPal are used). **Do not submit until Day 4 review.**

## Day 4 — submit window (before Nov 12)

1. Dual-check: Wasl submission untouched; QuotePal project is a **new** Devpost software entry.
2. Fill tools list: PayPal Invoicing v2, Orders v2, (LLM name), Express, etc.
3. Submit by **Nov 10** preferred buffer (hard stop Nov 12 12pm PST).

## Owner split

| Piece | Owner |
|-------|--------|
| UI, mock/sandbox wiring, demo video, Devpost, GitHub | Bounty |
| `ai.js` model quality, fixtures, reminder copy eval | Money |
| PayPal developer account / sandbox login if 2FA | User |

## Out of scope for v1

- Native mobile app, Stripe, accounting sync (QuickBooks), multi-employee shops, Wasl-style escrow.
