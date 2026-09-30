/* ═══════════════════════════════════════════════════════════════
   Guards the deployment files against the mistake that froze the
   site: a JSON file with a key its host does not accept.

   Vercel validates vercel.json and refuses the whole deployment
   when it finds a property it does not know, which leaves the last
   good build serving and no sign on the site that anything is
   wrong. A comment added to a headers rule cost several days of
   changes never reaching the phone they were written for.

   usage: node tools/check-config.mjs
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync } from 'node:fs';

const problems = [];
const check = (cond, msg) => { if (!cond) problems.push(msg); };

/* ─── vercel.json ─── */
const TOP = new Set(['$schema', 'cleanUrls', 'trailingSlash', 'headers', 'redirects',
  'rewrites', 'routes', 'regions', 'buildCommand', 'outputDirectory', 'installCommand',
  'devCommand', 'framework', 'functions', 'crons', 'public', 'github', 'images', 'ignoreCommand']);
const RULE = new Set(['source', 'headers', 'has', 'missing']);
const ENTRY = new Set(['key', 'value']);

let vercel;
try { vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')); }
catch (err) { problems.push(`vercel.json is not valid JSON: ${err.message}`); }

if (vercel) {
  for (const k of Object.keys(vercel))
    check(TOP.has(k), `vercel.json: unknown top-level key "${k}" — Vercel rejects the file and keeps the previous deployment`);
  (vercel.headers || []).forEach((rule, i) => {
    for (const k of Object.keys(rule))
      check(RULE.has(k), `vercel.json: headers[${i}] has "${k}"; only ${[...RULE].join(', ')} are allowed (JSON has no comments)`);
    check(typeof rule.source === 'string', `vercel.json: headers[${i}] needs a source`);
    (rule.headers || []).forEach((h, j) => {
      for (const k of Object.keys(h))
        check(ENTRY.has(k), `vercel.json: headers[${i}].headers[${j}] has "${k}"`);
    });
  });
  // the reason the no-cache rule exists at all
  const js = (vercel.headers || []).find(r => /css\|js/.test(r.source || ''));
  check(js && /no-cache/.test(JSON.stringify(js.headers)),
    'vercel.json: js/css must be no-cache — without it a fix sits on the server while the phone runs the old copy');
}

/* ─── manifest.webmanifest ─── */
try {
  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  check(typeof m.start_url === 'string', 'manifest: start_url missing');
  check(Array.isArray(m.icons) && m.icons.length, 'manifest: no icons');
} catch (err) { problems.push(`manifest.webmanifest is not valid JSON: ${err.message}`); }

/* ─── index.html ───────────────────────────────────────────────
   Zero build means nothing resolves these for us. A preload with a typo
   is a wasted request; a stylesheet with one is a site without CSS. */
const root = new URL('../', import.meta.url);
const exists = rel => { try { readFileSync(new URL(rel, root)); return true; } catch { return false; } };

let html = '';
try { html = readFileSync(new URL('index.html', root), 'utf8'); }
catch (err) { problems.push(`index.html could not be read: ${err.message}`); }

for (const m of html.matchAll(/(?:href|src)="([^"#:]+\.(?:js|css|woff2|webmanifest|png))"/g))
  check(exists(m[1]), `index.html points at ${m[1]}, which is not in the repository`);

check(!/fonts\.(googleapis|gstatic)\.com/.test(html.replace(/<!--[\s\S]*?-->/g, '')),
  'index.html asks another origin for a font — that is two handshakes before any text can be drawn, and fonts/ already has it');

/* ─── the screens the router promises ─── */
let views = '';
try { views = readFileSync(new URL('js/core/views.js', root), 'utf8'); }
catch (err) { problems.push(`js/core/views.js could not be read: ${err.message}`); }
for (const m of views.matchAll(/import\('\.\.\/(apps\/[\w-]+\.js)'\)/g))
  check(exists('js/' + m[1]), `views.js promises js/${m[1]}, which is not in the repository — that screen would 404 when opened`);

/* ─── the offline boot set ─── */
let sw = '';
try { sw = readFileSync(new URL('sw.js', root), 'utf8'); }
catch (err) { problems.push(`sw.js could not be read: ${err.message}`); }
const bootList = sw.slice(sw.indexOf('const BOOT = ['), sw.indexOf('].map(at)'));
for (const m of bootList.matchAll(/'([^']+\.(?:js|css|html|woff2|webmanifest))'/g))
  check(exists(m[1]), `sw.js would precache ${m[1]}, which is not in the repository`);

if (problems.length) {
  console.error('Deployment config problems:\n' + problems.map(p => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log('✓ vercel.json and the manifest are shaped the way their hosts expect');
