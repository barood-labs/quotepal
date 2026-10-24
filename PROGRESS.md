# PayPal AI Hackathon — QuotePal

URL: https://paypalaihackathon.devpost.com/  
Rules: https://paypalaihackathon.devpost.com/rules  
Deadline: **Thu Nov 12, 2026 12:00 PM PST** (1:00 PM America/Denver).  
Winners ~Dec 21. Cash pool ~$67.5k–$69.75k (use live page at submit).

## Rules that matter for us

- Working project that meaningfully uses **PayPal Developer Platform + an AI tool** (Stage 1 pass/fail).
- Submit: description, tools used, **public OSS repo** (license in About), runnable build or hosted demo, YouTube **< 3 min**.
- **Multiple Submissions:** allowed if each is **unique and substantially different** (Official Rules). Wasl ≠ QuotePal → OK.
- Judging (equal): Tech, Design, Impact, Innovation, Presentation.

## Idea

Solo tradespeople type/speak a messy job summary → AI itemized quote from their price book → PayPal **Invoicing v2** create+send → pay link → AI late-payment **remind**.

## Status

### Money scaffold (Oct 22) — kept as reference
`/workspace/money/contests/paypal-ai-hackathon/app/` — thin API only (ai/paypal/server .mjs + 1 test). No UI.

### Bounty product shell (Oct 23) — active
`/workspace/bounty/drafts/quotepal/` — repo-ready shell:
- [x] Express API + mock PayPal Invoicing/Orders
- [x] Mobile UI (parse → edit → invoice → remind)
- [x] Price book, heuristic AI + optional LLM, reminder templates
- [x] Tests (unit + e2e mock flow), README, MIT, BUILD_PLAN.md
- [x] **Day 2 Money ML** (`server/ai.js`): stronger NER (name/email/phone/address, fuzzy pricebook SKUs + word qtys), `needs_review` + `line_flags`, reminder tones friendly/firm/final with A/B `subject_variants`, 8 fixtures in `test/fixtures/`. `npm test` → **15/15**.
- [ ] Sandbox creds live test
- [ ] Voice input
- [x] Day 3 UI: customer_address, needs_review banner, line flags, reminder tones + subject_variants
- [x] Public GitHub + demo video + SUBMIT.md draft (**Devpost not submitted yet**)

## Do not touch
- Wasl submission: https://devpost.com/software/wasl-41xru2
- `/workspace/bounty/paypal/` (Wasl codebase)
