# QuotePal

**Talk the job, get paid.**

AI quotes + PayPal invoices for solo tradespeople (plumbers, cleaners, handymen).

Dictate or type a messy job note → QuotePal turns it into an itemized quote from your price book → creates and sends a **PayPal Invoicing v2** invoice → optional **Orders v2** pay-now → AI drafts polite late-payment reminders (friendly / firm / final) with A/B subject lines via the PayPal remind API.

Weak matches are flagged so you can fix them before the customer sees the invoice.

> **Not Wasl.** [Wasl](https://devpost.com/software/wasl-41xru2) is a separate PayPal AI Hackathon entry (bilingual creator escrow: Orders AUTHORIZE + Payouts + Whisper/OCR). QuotePal is a different product for a different audience and different PayPal surfaces.

## Demo flow (~2 minutes)

1. Open the app → **Load sample** → **Generate quote**.
2. Review the yellow **Needs review** banner and any `!` line flags. Edit customer, address, or prices.
3. **Create & send PayPal invoice** → open the pay link.
4. Pick a reminder tone → **Draft & send reminder** → choose subject A or B.

Default mode is an offline **PayPal mock** (`PAYPAL_ENV=mock`) so anyone can click through with zero credentials. Flip to sandbox when you have a REST app.

## Quick start

```bash
git clone https://github.com/barood-labs/quotepal.git
cd quotepal
npm install
cp .env.example .env          # defaults are fine for mock mode
npm start                     # → http://localhost:8790
npm test
```

### Real PayPal sandbox

1. https://developer.paypal.com → Apps & Credentials → Sandbox → Create App (Merchant).
2. Put `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and sandbox business `MERCHANT_EMAIL` in `.env`.
3. Set `PAYPAL_ENV=sandbox`.
4. Restart. Header pill should say `PayPal: sandbox`.

### Optional LLM

Without `AI_API_KEY`, parsing uses an offline heuristic (explicit `2 x faucet @ 85` plus price-book alias / synonym matching, address NER, hours-as-words). With any OpenAI-compatible key:

```
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini
```

## Architecture

```
public/                 Mobile-first vanilla UI
server/index.js         Express API
server/ai.js            job→quote parse + reminder copy
server/paypal.js        Invoicing v2 + Orders v2 client
server/mock-paypal.js   Offline simulator
server/store.js         JSON store for quotes / invoices / reminders
data/pricebook.json     Editable trades price list
test/fixtures/          Messy real-world job notes
```

## API (short)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/parse` | `{ text }` → draft quote (`needs_review`, `line_flags`, `customer_address`) |
| PATCH | `/api/quotes/:id` | edit quote (incl. address) |
| POST | `/api/quotes/:id/invoice` | create + send PayPal invoice |
| POST | `/api/invoices/:id/remind` | AI reminder + PayPal remind (`tone`, `subject_variants`) |
| POST | `/api/quotes/:id/paynow` | Orders v2 pay-now link |
| GET | `/api/pricebook` | price list |

## Hackathon notes

- Event: [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/)
- Deadline: **Nov 12, 2026 @ 12:00pm PST** (1:00pm America/Denver)
- Rules allow multiple submissions if each is unique and substantially different — QuotePal ≠ Wasl.
- See `SUBMIT.md` for the Devpost draft (do not submit until ~Nov 10).

## License

MIT © barood-labs
