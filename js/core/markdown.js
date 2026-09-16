/* ═══════════════════════════════════════════════════════════════
   GabikOS — minimal, safe markdown renderer
   Escapes first, then formats: no raw HTML ever reaches the DOM.
   ═══════════════════════════════════════════════════════════════ */
import { esc } from './util.js';

function inline(s) {
  return s
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/==([^=\n]+)==/g, '<mark>$1</mark>');
}

export function markdown(src = '') {
  const lines = esc(src).split('\n');
  const out = [];
  let inCode = false, codeLang = '', listType = null, inQuote = false;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };

  for (let raw of lines) {
    // fenced code
    const fence = raw.match(/^```(\w*)\s*$/);
    if (fence) {
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { closeList(); closeQuote(); codeLang = fence[1]; out.push(`<pre class="md-code"${codeLang ? ` data-lang="${codeLang}"` : ''}><code>`); inCode = true; }
      continue;
    }
    if (inCode) { out.push(raw + '\n'); continue; }

    const line = raw.trimEnd();

    if (!line.trim()) { closeList(); closeQuote(); continue; }

    // headings
    const hd = line.match(/^(#{1,4})\s+(.*)$/);
    if (hd) { closeList(); closeQuote(); out.push(`<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`); continue; }

    // horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line)) { closeList(); closeQuote(); out.push('<hr/>'); continue; }

    // blockquote
    const bq = line.match(/^&gt;\s?(.*)$/);
    if (bq) { closeList(); if (!inQuote) { out.push('<blockquote>'); inQuote = true; } out.push(`<p>${inline(bq[1])}</p>`); continue; }
    closeQuote();

    // task list
    const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      if (listType !== 'ul') { closeList(); out.push('<ul class="md-tasks">'); listType = 'ul'; }
      const done = task[1].toLowerCase() === 'x';
      out.push(`<li class="md-task${done ? ' is-done' : ''}"><span class="md-tick">${done ? '✓' : ''}</span>${inline(task[2])}</li>`);
      continue;
    }
    // unordered
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`); continue;
    }
    // ordered
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`); continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inCode) out.push('</code></pre>');
  closeList(); closeQuote();
  return out.join('\n');
}

/** First non-heading line, for previews. */
export function excerpt(src = '', n = 120) {
  const line = src.split('\n').map(l => l.trim())
    .find(l => l && !l.startsWith('#') && !l.startsWith('```') && !/^(---|\*\*\*)$/.test(l)) || '';
  const clean = line.replace(/[*_`~>#\[\]]/g, '').replace(/\((https?:[^)]+)\)/g, '').trim();
  return clean.length > n ? clean.slice(0, n).trimEnd() + '…' : clean;
}

export const wordCount = s => (String(s).trim().match(/\S+/g) || []).length;
