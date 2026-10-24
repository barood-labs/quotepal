// QuotePal demo recorder — Chrome CDP screencast → JPEG frames + timeline.
// Usage: node demo/record.mjs http://localhost:8790 demo/build/frames
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || '/workspace/agenttown/node_modules/playwright-core');

const BASE = process.argv[2] || 'http://localhost:8790';
const OUT = path.resolve(process.argv[3] || 'demo/build/frames');
fs.mkdirSync(OUT, { recursive: true });
const W = 390, H = 844; // mobile viewport for trades UX

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 2,
  locale: 'en-US',
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const t0 = Date.now();
const frames = [];
const marks = [];
let n = 0;

cdp.on('Page.screencastFrame', async (f) => {
  const file = path.join(OUT, `f${String(n++).padStart(6, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
  frames.push({ file: path.basename(file), t: (Date.now() - t0) / 1000 });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});

const startCast = () =>
  cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 90,
    maxWidth: W * 2,
    maxHeight: H * 2,
    everyNthFrame: 1,
  });
const mark = (name) => {
  marks.push({ name, t: (Date.now() - t0) / 1000 });
  console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${name}`);
};
const wait = (ms) => page.waitForTimeout(ms);
const save = () =>
  fs.writeFileSync(
    path.join(OUT, '..', 'timeline.json'),
    JSON.stringify({ frames, marks, viewport: { W, H } }, null, 1),
  );

const keepAlive = setInterval(() => page.evaluate(() => {
  let k = document.getElementById('__k');
  if (!k) {
    k = document.createElement('div');
    k.id = '__k';
    k.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;z-index:99999;pointer-events:none';
    document.body.appendChild(k);
  }
  k.style.background = k.style.background === 'rgb(45,212,168)' ? 'rgb(44,211,167)' : 'rgb(45,212,168)';
}).catch(() => {}), 200);

async function cursorTap(sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  if (b) {
    await page.evaluate(([x, y]) => {
      let c = document.getElementById('__cur');
      if (!c) {
        c = document.createElement('div');
        c.id = '__cur';
        c.style.cssText = 'position:fixed;z-index:99999;width:28px;height:28px;border-radius:50%;background:rgba(45,212,168,.45);border:2px solid #2dd4a8;pointer-events:none;transition:all .35s ease;transform:translate(-50%,-50%)';
        document.body.appendChild(c);
      }
      c.style.left = x + 'px';
      c.style.top = y + 'px';
    }, [b.x + b.width / 2, b.y + b.height / 2]);
    await wait(400);
  }
  await el.click();
}

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await startCast();
  await wait(1200);
  mark('hero');

  await cursorTap('#btnSample');
  await wait(900);
  mark('sample');

  await cursorTap('#btnParse');
  await page.locator('#parseHint').filter({ hasText: /Parsed|flagged|confidence/i }).waitFor({ timeout: 20000 });
  await page.locator('#quoteCard').waitFor({ state: 'visible', timeout: 10000 });
  await wait(1800);
  mark('parsed');

  // Scroll quote into view and linger on review banner / address
  await page.locator('#reviewBanner, #custAddress').first().scrollIntoViewIfNeeded().catch(() => {});
  await wait(1400);
  await page.locator('#itemsTable').scrollIntoViewIfNeeded();
  await wait(1600);
  mark('review');

  // Tiny edit so judges see interactivity
  const nameBox = page.locator('#custName');
  await nameBox.scrollIntoViewIfNeeded();
  const cur = await nameBox.inputValue();
  if (cur && !cur.includes('(confirmed)')) {
    await nameBox.fill(cur.replace(/\s*$/, '') + '');
  }
  await wait(600);

  await cursorTap('#btnInvoice');
  await page.locator('#invoiceHint').filter({ hasText: /Invoice sent|PayPal/i }).waitFor({ timeout: 20000 });
  await page.locator('#invoiceCard').waitFor({ state: 'visible', timeout: 10000 });
  await wait(2000);
  mark('invoiced');

  await page.locator('#remindTone').selectOption('friendly');
  await wait(400);
  await cursorTap('#btnRemind');
  await page.locator('#remindPreview').waitFor({ state: 'visible', timeout: 20000 });
  await wait(1200);
  // Pick subject B if present
  const chips = page.locator('#subjectVariants .chip');
  if (await chips.count() >= 2) {
    await chips.nth(1).click();
    await wait(900);
  }
  mark('reminded');
  await wait(1800);
  mark('end');
} catch (e) {
  console.error('RECORD_ERROR', e);
  marks.push({ name: 'error', t: (Date.now() - t0) / 1000, err: String(e) });
} finally {
  clearInterval(keepAlive);
  await cdp.send('Page.stopScreencast').catch(() => {});
  save();
  await browser.close();
  const ok = marks.some(m => m.name === 'end') && !marks.some(m => m.name === 'error');
  console.log(ok ? 'OK' : 'FAIL', `frames=${frames.length}`);
  process.exit(ok ? 0 : 1);
}
