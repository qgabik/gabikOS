/* ═══════════════════════════════════════════════════════════════
   GabikOS — Notes: markdown editor with live preview
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { confirmDialog, toast, on, emptyState, pageHead, contextMenu, openForm, qs } from '../core/ui.js';
import { esc, uid, relTime, by, unique, debounce, truncate, plural } from '../core/util.js';
import { markdown, excerpt, wordCount } from '../core/markdown.js';

export const noteCount = () => S().notes.length;

export function newNote(preset = {}) {
  const n = store.add('notes', {
    title: preset.title || 'Untitled note',
    body: preset.body || '',
    folder: preset.folder || 'Inbox',
    tags: preset.tags || [],
    pinned: false,
    updatedAt: Date.now(),
  });
  store.log('note', 'Created a note', 'notes');
  navigate('notes', { id: n.id });
  return n;
}

const folders = () => unique(['Inbox', ...S().notes.map(n => n.folder || 'Inbox')]);

/* ─── View ─── */
registerView('notes', {
  title: 'Notes', icon: 'note', group: 'Think', order: 30,
  desc: 'Markdown notes, ideas and references',
  keywords: ['note', 'markdown', 'idea', 'write', 'doc'],

  render(p) {
    const notes = S().notes;
    const q = (p.q || '').toLowerCase();
    const folder = p.folder || '';
    const tag = p.tag || '';
    const activeId = p.id;

    let shown = [...notes];
    if (folder) shown = shown.filter(n => (n.folder || 'Inbox') === folder);
    if (tag) shown = shown.filter(n => (n.tags || []).includes(tag));
    if (q) shown = shown.filter(n => (n.title + ' ' + n.body + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q));
    shown.sort(by(n => -(n.updatedAt || n.createdAt || 0)));
    shown.sort(by(n => (n.pinned ? 0 : 1)));

    const active = activeId ? notes.find(n => n.id === activeId) : shown[0];
    const allTags = unique(notes.flatMap(n => n.tags || []));

    if (!notes.length) {
      return pageHead('Notes', 'Your second brain', `<button class="btn btn--primary" data-new-note>${icon('plus')}New note</button>`, 'note')
        + `<div class="card">${emptyState('note', 'No notes yet',
          'Capture an idea, a recipe, a plan, a reading list — anything. Markdown works here.',
          '<button class="btn btn--primary mt-3" data-new-note>Write your first note</button>')}</div>`;
    }

    return pageHead('Notes', `${plural(notes.length, 'note')} · ${folders().length} folders`, `
      <button class="btn btn--primary" data-new-note>${icon('plus')}New note</button>`, 'note') + `

    <div class="notes">
      <aside class="notes__side">
        <div class="notes__search">
          ${icon('search', 'ic ic--sm')}
          <input class="input" placeholder="Search notes…" value="${esc(p.q || '')}" data-q />
        </div>
        <div class="notes__filters">
          <button class="chip ${!folder && !tag ? 'chip--accent' : ''}" data-folder="">All</button>
          ${folders().map(f => `<button class="chip ${folder === f ? 'chip--accent' : ''}" data-folder="${esc(f)}">
            ${icon('folder', 'ic ic--sm')}${esc(f)}</button>`).join('')}
          ${allTags.slice(0, 12).map(t => `<button class="chip ${tag === t ? 'chip--accent' : ''}" data-tag="${esc(t)}">#${esc(t)}</button>`).join('')}
        </div>
        <div class="notes__list">
          ${shown.length ? shown.map(n => `
            <button class="nitem ${active?.id === n.id ? 'is-active' : ''}" data-open="${n.id}">
              <div class="nitem__top">
                ${n.pinned ? `<span class="nitem__pin">${icon('pin', 'ic ic--sm')}</span>` : ''}
                <strong class="truncate">${esc(n.title || 'Untitled')}</strong>
              </div>
              <span class="nitem__ex">${esc(excerpt(n.body, 68) || 'Empty note')}</span>
              <span class="nitem__meta">${esc(relTime(n.updatedAt || n.createdAt))}
                ${(n.tags || []).length ? `· ${(n.tags || []).slice(0, 2).map(t => '#' + esc(t)).join(' ')}` : ''}</span>
            </button>`).join('') : `<p class="notes__none">No notes match.</p>`}
        </div>
      </aside>

      <section class="notes__main card">
        ${active ? noteEditor(active) : emptyState('note', 'Pick a note', 'Choose one on the left, or create a new one.')}
      </section>
    </div>`;
  },

  onMount(root) {
    on(root, 'click', '[data-new-note]', () => newNote());
    on(root, 'click', '[data-open]', (e, el) => navigate('notes', { ...params(), id: el.dataset.open }));
    on(root, 'click', '[data-folder]', (e, el) => navigate('notes', { folder: el.dataset.folder }));
    on(root, 'click', '[data-tag]', (e, el) => navigate('notes', { tag: el.dataset.tag }));

    const qInput = root.querySelector('[data-q]');
    if (qInput) {
      const run = debounce(() => {
        const val = qInput.value;
        navigate('notes', { ...params(), q: val, id: '' });
        setTimeout(() => {
          const again = qs('[data-q]');
          if (again) { again.focus(); again.setSelectionRange(val.length, val.length); }
        }, 0);
      }, 320);
      qInput.addEventListener('input', run);
    }

    /* editor wiring */
    const title = root.querySelector('[data-note-title]');
    const body = root.querySelector('[data-note-body]');
    const preview = root.querySelector('[data-note-preview]');
    const id = title?.dataset.noteTitle;
    const stats = root.querySelector('[data-note-stats]');

    const save = debounce(() => {
      if (!id) return;
      store.update('notes', id, { title: title.value.trim() || 'Untitled', body: body.value });
      const item = root.querySelector(`[data-open="${id}"]`);
      if (item) {
        item.querySelector('strong').textContent = title.value.trim() || 'Untitled';
        item.querySelector('.nitem__ex').textContent = excerpt(body.value, 68) || 'Empty note';
      }
      if (stats) stats.textContent = `${plural(wordCount(body.value), 'word')} · saved`;
    }, 420);

    const sync = () => {
      if (preview) preview.innerHTML = markdown(body.value) || '<p class="dim">Nothing yet — start typing on the left.</p>';
      if (stats) stats.textContent = `${plural(wordCount(body.value), 'word')} · saving…`;
      save();
    };
    title?.addEventListener('input', sync);
    body?.addEventListener('input', sync);
    body?.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = body.selectionStart, en = body.selectionEnd;
        body.value = body.value.slice(0, s) + '  ' + body.value.slice(en);
        body.selectionStart = body.selectionEnd = s + 2;
        sync();
      }
    });

    on(root, 'click', '[data-tool]', (e, el) => {
      if (!body) return;
      const tool = el.dataset.tool;
      const s = body.selectionStart, en = body.selectionEnd;
      const sel = body.value.slice(s, en) || '';
      const wraps = { bold: ['**', '**'], italic: ['*', '*'], code: ['`', '`'], strike: ['~~', '~~'] };
      const lines = { h1: '# ', h2: '## ', bullet: '- ', task: '- [ ] ', quote: '> ' };
      let next, caret;
      if (wraps[tool]) {
        const [a, b] = wraps[tool];
        next = body.value.slice(0, s) + a + (sel || 'text') + b + body.value.slice(en);
        caret = s + a.length + (sel || 'text').length;
      } else if (lines[tool]) {
        const ls = body.value.lastIndexOf('\n', s - 1) + 1;
        next = body.value.slice(0, ls) + lines[tool] + body.value.slice(ls);
        caret = en + lines[tool].length;
      } else if (tool === 'link') {
        next = body.value.slice(0, s) + `[${sel || 'label'}](https://)` + body.value.slice(en);
        caret = s + (sel || 'label').length + 3;
      } else if (tool === 'rule') {
        next = body.value.slice(0, s) + '\n---\n' + body.value.slice(en);
        caret = s + 5;
      } else return;
      body.value = next;
      body.focus();
      body.setSelectionRange(caret, caret);
      sync();
    });

    on(root, 'click', '[data-nmenu]', (e, el) => {
      const nid = el.dataset.nmenu;
      const n = store.find('notes', nid);
      contextMenu(e, [
        { label: n.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', action: () => { store.update('notes', nid, { pinned: !n.pinned }); render(); } },
        { label: 'Move to folder…', icon: 'folder', action: async () => {
            const v = await openForm({ title: 'Move note', submitLabel: 'Move',
              fields: [{ name: 'folder', label: 'Folder', type: 'text', required: true, value: n.folder || 'Inbox',
                hint: 'Type a new name to create a folder' }] });
            if (v) { store.update('notes', nid, { folder: v.folder }); toast(`Moved to ${v.folder}`, 'ok'); render(); }
          } },
        { label: 'Edit tags…', icon: 'tag', action: async () => {
            const v = await openForm({ title: 'Tags', submitLabel: 'Save',
              fields: [{ name: 'tags', label: 'Tags', type: 'tags', value: n.tags }] });
            if (v) { store.update('notes', nid, { tags: v.tags }); render(); }
          } },
        '-',
        { label: 'Duplicate', icon: 'copy', action: () => {
            store.add('notes', { ...n, id: undefined, title: n.title + ' (copy)', pinned: false, updatedAt: Date.now() });
            toast('Duplicated', 'ok'); render();
          } },
        { label: 'Export as .md', icon: 'download', action: async () => {
            const { download } = await import('../core/util.js');
            download(`${(n.title || 'note').replace(/[^\w\s-]/g, '').trim() || 'note'}.md`, n.body, 'text/markdown');
            toast('Note exported', 'ok');
          } },
        '-',
        { label: 'Delete note', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete note?', message: `“${n.title}” will be removed permanently.`,
              confirmLabel: 'Delete', danger: true })) {
              store.remove('notes', nid); toast('Note deleted', 'ok'); navigate('notes', {});
            }
          } },
      ]);
    });
  },
});

function noteEditor(n) {
  const tools = [
    ['bold', 'B'], ['italic', 'I'], ['h1', 'H1'], ['h2', 'H2'],
    ['bullet', '•'], ['task', '☑'], ['quote', '❝'], ['code', '</>'], ['link', '🔗'], ['rule', '―'],
  ];
  return `
    <header class="note-head">
      <input class="note-title" data-note-title="${n.id}" value="${esc(n.title || '')}" placeholder="Note title" />
      <div class="row gap-1">
        <span class="note-stats dim" data-note-stats>${plural(wordCount(n.body), 'word')}</span>
        <button class="icon-btn icon-btn--sm" data-nmenu="${n.id}">${icon('more')}</button>
      </div>
    </header>
    <div class="note-toolbar">
      ${tools.map(([t, l]) => `<button class="note-tool" data-tool="${t}" title="${t}">${esc(l)}</button>`).join('')}
      <div class="grow"></div>
      <span class="chip">${icon('folder', 'ic ic--sm')}${esc(n.folder || 'Inbox')}</span>
      ${(n.tags || []).map(t => `<span class="chip">#${esc(t)}</span>`).join('')}
    </div>
    <div class="note-split">
      <textarea class="note-body mono" data-note-body spellcheck="true"
        placeholder="# Start writing…&#10;&#10;Markdown works: **bold**, *italic*, - lists, - [ ] tasks, > quotes, \`code\`.">${esc(n.body || '')}</textarea>
      <div class="note-preview md" data-note-preview>${markdown(n.body) || '<p class="dim">Nothing yet — start typing on the left.</p>'}</div>
    </div>`;
}
