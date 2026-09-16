/* ═══════════════════════════════════════════════════════════════
   GabikOS — command palette: navigate, search and act from anywhere
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from './store.js';
import { navigate, navViews, allViews, currentView } from './router.js';
import { icon } from './icons.js';
import { qs, qsa, toast, modal } from './ui.js';
import { esc, fuzzy, truncate, fmtDate, by } from './util.js';
import { excerpt } from './markdown.js';

let selected = 0;
let results = [];
let commands = [];

/** Register global commands (called once at boot). */
export function setCommands(list) { commands = list; }

export const isOpen = () => !qs('#palette').hidden;

export function openPalette(prefill = '') {
  const box = qs('#palette');
  const input = qs('#paletteInput');
  box.hidden = false;
  input.value = prefill;
  selected = 0;
  build(prefill);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

export function closePalette() {
  qs('#palette').hidden = true;
  qs('#paletteInput').value = '';
}

/* ─── Index everything searchable ─── */
function index() {
  const items = [];

  // views
  for (const v of navViews()) {
    items.push({
      group: 'Go to', icon: v.icon, title: v.title,
      sub: v.desc || '', meta: v.group,
      keywords: [v.title, ...(v.keywords || [])].join(' '),
      run: () => navigate(v.id),
    });
  }

  // commands
  for (const c of commands) {
    items.push({ group: 'Actions', icon: c.icon, title: c.title, sub: c.sub || '', meta: c.meta || '',
      keywords: [c.title, ...(c.keywords || [])].join(' '), run: c.run });
  }

  // tasks
  for (const t of S().tasks.filter(x => !x.done).slice(0, 120)) {
    items.push({
      group: 'Tasks', icon: 'checkSquare', title: t.title,
      sub: t.due ? `Due ${fmtDate(t.due)}` : 'No due date', meta: 'task',
      keywords: `${t.title} ${(t.tags || []).join(' ')} task todo`,
      run: () => { navigate('tasks', { filter: 'all' }); setTimeout(() => import('../apps/tasks.js').then(m => m.editTask(t.id)), 60); },
    });
  }

  // notes
  for (const n of S().notes.slice(0, 120)) {
    items.push({
      group: 'Notes', icon: 'note', title: n.title || 'Untitled',
      sub: excerpt(n.body, 60), meta: n.folder || 'Inbox',
      keywords: `${n.title} ${n.body?.slice(0, 400)} ${(n.tags || []).join(' ')} note`,
      run: () => navigate('notes', { id: n.id }),
    });
  }

  // habits
  for (const h of S().habits) {
    items.push({
      group: 'Habits', icon: h.icon || 'flame', title: h.name, sub: 'Log for today', meta: 'habit',
      keywords: `${h.name} habit streak`,
      run: () => import('../apps/habits.js').then(m => { m.bumpHabit(h.id); navigate('habits'); }),
    });
  }

  // goals
  for (const g of S().goals) {
    items.push({ group: 'Goals', icon: 'target', title: g.title, sub: g.category || '', meta: 'goal',
      keywords: `${g.title} ${g.category} goal`, run: () => navigate('goals') });
  }

  // events
  for (const e of S().events.slice(0, 60)) {
    items.push({ group: 'Calendar', icon: 'calendar', title: e.title, sub: fmtDate(e.date), meta: 'event',
      keywords: `${e.title} ${e.location || ''} event`, run: () => navigate('calendar') });
  }

  // custom collection records
  for (const c of S().collections) {
    const tf = c.fields.find(f => f.type === 'text') || c.fields[0];
    for (const r of (S().records?.[c.id] || []).slice(0, 60)) {
      items.push({
        group: c.name, icon: c.icon || 'star', title: String(r[tf?.id] || 'Untitled'),
        sub: c.singular || 'entry', meta: 'custom',
        keywords: `${Object.values(r).filter(v => typeof v === 'string').join(' ')} ${c.name}`,
        run: () => navigate(`c_${c.id}`),
      });
    }
  }

  return items;
}

function build(q) {
  const all = index();
  const query = q.trim();

  if (!query) {
    // default: actions + views, in a sensible order
    results = all.filter(i => i.group === 'Actions').slice(0, 6)
      .concat(all.filter(i => i.group === 'Go to').slice(0, 9));
  } else {
    results = all
      .map(i => ({ ...i, score: Math.max(fuzzy(query, i.title) * 2, fuzzy(query, i.keywords)) }))
      .filter(i => i.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }
  paint(query);
}

function paint(query) {
  const host = qs('#paletteResults');
  if (!results.length) {
    host.innerHTML = `<div class="palette__none">
      ${icon('search', 'ic ic--lg')}
      <p>No matches for “${esc(query)}”</p>
      <small>Try a module name, a task, or a note's words.</small>
    </div>`;
    return;
  }
  let html = '', lastGroup = null;
  results.forEach((r, i) => {
    if (r.group !== lastGroup) { html += `<div class="palette__group">${esc(r.group)}</div>`; lastGroup = r.group; }
    html += `<button class="palette__item ${i === selected ? 'is-sel' : ''}" data-i="${i}">
      <span class="pal__ic">${icon(r.icon || 'chevronRight')}</span>
      <span class="pal__txt"><strong>${esc(truncate(r.title, 62))}</strong>
        ${r.sub ? `<small>${esc(truncate(r.sub, 68))}</small>` : ''}</span>
      ${r.meta ? `<span class="pal__meta">${esc(r.meta)}</span>` : ''}
    </button>`;
  });
  host.innerHTML = html;
  host.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' });
}

function move(d) {
  if (!results.length) return;
  selected = (selected + d + results.length) % results.length;
  paint(qs('#paletteInput').value);
}

function run(i = selected) {
  const r = results[i];
  if (!r) return;
  closePalette();
  setTimeout(() => r.run(), 10);
}

/* ─── Wiring ─── */
export function initPalette() {
  const box = qs('#palette');
  const input = qs('#paletteInput');

  input.addEventListener('input', () => { selected = 0; build(input.value); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); run(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'Tab') { e.preventDefault(); move(e.shiftKey ? -1 : 1); }
  });

  qs('#paletteResults').addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) run(Number(b.dataset.i));
  });
  qs('#paletteResults').addEventListener('mousemove', e => {
    const b = e.target.closest('[data-i]');
    if (b && Number(b.dataset.i) !== selected) { selected = Number(b.dataset.i); paint(input.value); }
  });

  box.addEventListener('mousedown', e => { if (e.target === box) closePalette(); });
}
