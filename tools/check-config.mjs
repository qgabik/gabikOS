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

if (problems.length) {
  console.error('Deployment config problems:\n' + problems.map(p => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log('✓ vercel.json and the manifest are shaped the way their hosts expect');
