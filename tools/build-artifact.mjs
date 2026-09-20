/* ═══════════════════════════════════════════════════════════════
   Derives the hosted entry page from index.html.

   Claude Artifact hosting wraps the published file in its own
   <!doctype>/<html>/<head>/<body>, so the hosted copy must contain
   page content only. Generating it from index.html keeps the two
   from drifting apart.

   usage: node tools/build-artifact.mjs [outfile]
   ═══════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const out = process.argv[2] || 'gabikos.html';

const pick = re => (src.match(re) || [])[0] || '';
const title = pick(/<title>[\s\S]*?<\/title>/i);
const fontLinks = [...src.matchAll(/<link[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/gi)].map(m => m[0]);
const cssLinks  = [...src.matchAll(/<link[^>]*href="styles\/[^"]+"[^>]*>/gi)].map(m => m[0]);
const preloads  = [...src.matchAll(/<link[^>]*rel="modulepreload"[^>]*>/gi)].map(m => m[0]);
const body      = (src.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [, ''])[1].trim();

if (!title || !cssLinks.length || !body) {
  console.error('build-artifact: could not parse index.html — aborting rather than publishing a broken page.');
  process.exit(1);
}

writeFileSync(out, `${title}
${fontLinks.join('\n')}
${cssLinks.join('\n')}
${preloads.join('\n')}
<style>
  /* the host pads :root with the phone's safe-area insets, so the
     app sizes from html/body rather than the raw viewport */
  html, body { height: 100%; margin: 0; }
</style>

${body}
`);

console.log(`built ${out} — ${cssLinks.length} stylesheets, ${preloads.length} module hints, ${body.split('\n').length} lines of markup`);
