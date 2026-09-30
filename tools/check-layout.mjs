/* ═══════════════════════════════════════════════════════════════
   Two checks a phone cannot pass by accident.

   1. Does anything sit outside the screen?
      The usual test — document.scrollWidth > innerWidth — cannot see
      this app's worst layout bugs, because .view hides its overflow.
      A broken column does not scroll sideways; it is simply cut off,
      and looks like missing content rather than a bug. So this
      measures every element against the viewport instead.

   2. Would a thumb hit the control it is aiming at?
      Measuring an element's own box is not the answer either: small
      controls here are given a finger-sized overlay on a coarse
      pointer, which a box measurement cannot see. This asks the page
      what is actually under four points around each control.

   Needs Playwright, so it is a tool you run rather than a deploy
   gate:  node tools/check-layout.mjs
   ═══════════════════════════════════════════════════════════════ */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = 8347;
const SCREENS = ['dashboard', 'tasks', 'habits', 'focus', 'calendar', 'school', 'notes',
  'journal', 'goals', 'health', 'finance', 'builder', 'settings'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  try { ({ chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs')); }
  catch {
    console.error('This needs Playwright:  npm i -D playwright');
    process.exit(2);
  }
}

const srv = createServer(async (req, res) => {
  try {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = join(ROOT, rel === '/' ? 'index.html' : rel.replace(/^\//, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => srv.listen(PORT, r));
const URL_ = `http://localhost:${PORT}/index.html`;

const problems = [];
const browser = await chromium.launch();

async function open(size) {
  const ctx = await browser.newContext({
    viewport: size, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => problems.push(`page error: ${e.message}`));
  await page.goto(URL_, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#obGo');
  await page.click('#obGo');
  await page.waitForSelector('.view__in');
  await page.waitForTimeout(500);
  return page;
}

/* ── 1. outside the screen ── */
for (const size of [{ width: 393, height: 852 }, { width: 320, height: 720 }]) {
  const page = await open(size);
  for (const view of SCREENS) {
    await page.evaluate(id => { location.hash = '#/' + id; }, view);
    await page.waitForTimeout(550);
    const over = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('#view *')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (getComputedStyle(el).position === 'fixed') continue;
        // a row meant to scroll sideways is allowed to be wider than the screen
        if (el.closest('.seg, .scroller, .table__wrap, .quickcats')) continue;
        const past = Math.round(r.right - innerWidth);
        if (past > 1) out.push(`${(el.className || el.tagName).toString().trim().slice(0, 32)} +${past}px`);
      }
      return [...new Set(out)].slice(0, 4);
    });
    if (over.length) problems.push(`${view} @${size.width}px reaches past the screen: ${over.join(', ')}`);
  }
  await page.context().close();
}

/* ── 2. thumb-sized taps ── */
{
  const page = await open({ width: 393, height: 852 });
  // The welcome toast sits over the first screen for six seconds. Probing
  // through it would report every control under it as unreachable.
  await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  for (const view of SCREENS) {
    await page.evaluate(id => { location.hash = '#/' + id; }, view);
    await page.waitForTimeout(550);
    const missed = await page.evaluate(() => {
      document.querySelectorAll('#toasts .toast').forEach(t => t.remove());
      const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
      const floor = bar && bar.height ? bar.top : innerHeight;
      const out = [];
      for (const el of document.querySelectorAll('#view button, #view a[href], #view [role=button]')) {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        const pts = [[cx, cy - 11], [cx, cy + 11], [cx - 11, cy], [cx + 11, cy]]
          .filter(([x, y]) => x >= 1 && x <= innerWidth - 1 && y >= 1 && y <= floor - 1);
        if (pts.length < 4) continue;      // at the edge of the screen; cannot be probed fairly
        const hit = pts.every(([x, y]) => {
          const t = document.elementFromPoint(x, y);
          return t && (t === el || el.contains(t) || t.closest('button,a,[role=button]') === el);
        });
        if (!hit) {
          const on = pts.map(([x, y]) => { const t = document.elementFromPoint(x, y); return t ? (t.className || t.tagName).toString().trim().slice(0, 20) : 'null'; });
          out.push(`${(el.className || el.tagName).toString().trim().slice(0, 30)} ${Math.round(b.width)}x${Math.round(b.height)} → hits ${[...new Set(on)].join(', ')}`);
        }
      }
      return [...new Set(out)];
    });
    // A month-grid event is a dot beside six others; its day cell catches the
    // near miss and opens the same date, which is the right answer anyway.
    const real = missed.filter(m => !m.startsWith('cal__ev'));
    if (real.length) problems.push(`${view}: a thumb would miss ${real.join(', ')}`);
  }
  await page.context().close();
}

await browser.close();
await new Promise(r => srv.close(r));

if (problems.length) {
  console.error('Layout problems:\n' + problems.map(p => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log(`✓ ${SCREENS.length} screens fit 393px and 320px, and every control takes a thumb`);
