/* ═══════════════════════════════════════════════════════════════
   GabikOS — Builder: design your own trackers.
   A collection becomes a real module in the sidebar with its own
   table, cards, filters, stats and CRUD — no code required.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, unregisterView, navigate, render, params, currentView } from '../core/router.js';
import { icon, PICKABLE } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile, modal, qs } from '../core/ui.js';
import { esc, uid, today, fmtDate, fmtMoney, by, sum, avg, round, plural, truncate, slug, download } from '../core/util.js';
import { barChart, donut, legend } from '../core/charts.js';

/* ─── Field types ─── */
export const FIELD_TYPES = [
  { value: 'text',     label: 'Text',        icon: 'note' },
  { value: 'textarea', label: 'Long text',   icon: 'journal' },
  { value: 'number',   label: 'Number',      icon: 'chart' },
  { value: 'money',    label: 'Money',       icon: 'wallet' },
  { value: 'date',     label: 'Date',        icon: 'calendar' },
  { value: 'select',   label: 'Choice',      icon: 'list' },
  { value: 'tags',     label: 'Tags',        icon: 'tag' },
  { value: 'checkbox', label: 'Yes / No',    icon: 'checkSquare' },
  { value: 'rating',   label: 'Rating (1-5)', icon: 'star' },
  { value: 'url',      label: 'Link',        icon: 'link' },
];

/* ─── Templates ─── */
export const TEMPLATES = [
  { name: 'Reading list', singular: 'Book', icon: 'book', color: '#f5b544', group: 'Life', fields: [
      { label: 'Title', type: 'text', required: true }, { label: 'Author', type: 'text' },
      { label: 'Status', type: 'select', options: ['Want to read', 'Reading', 'Finished', 'Abandoned'] },
      { label: 'Rating', type: 'rating' }, { label: 'Pages', type: 'number' },
      { label: 'Finished on', type: 'date' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Watchlist', singular: 'Title', icon: 'film', color: '#ec6ead', group: 'Life', fields: [
      { label: 'Title', type: 'text', required: true },
      { label: 'Type', type: 'select', options: ['Film', 'Series', 'Documentary'] },
      { label: 'Status', type: 'select', options: ['Want to watch', 'Watching', 'Watched'] },
      { label: 'Rating', type: 'rating' }, { label: 'Where', type: 'text' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Recipes', singular: 'Recipe', icon: 'utensils', color: '#3ecf8e', group: 'Life', fields: [
      { label: 'Name', type: 'text', required: true },
      { label: 'Category', type: 'select', options: ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Drink'] },
      { label: 'Time (min)', type: 'number' }, { label: 'Rating', type: 'rating' },
      { label: 'Ingredients', type: 'textarea' }, { label: 'Method', type: 'textarea' }, { label: 'Tags', type: 'tags' } ] },
  { name: 'Wishlist', singular: 'Item', icon: 'star', color: '#7c5cff', group: 'Life', fields: [
      { label: 'Item', type: 'text', required: true }, { label: 'Price', type: 'money' },
      { label: 'Priority', type: 'select', options: ['Someday', 'Soon', 'Now'] },
      { label: 'Link', type: 'url' }, { label: 'Bought', type: 'checkbox' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Contacts', singular: 'Person', icon: 'users', color: '#4cc4f0', group: 'Life', fields: [
      { label: 'Name', type: 'text', required: true }, { label: 'How we met', type: 'text' },
      { label: 'Phone', type: 'text' }, { label: 'Email', type: 'text' },
      { label: 'Birthday', type: 'date' }, { label: 'Last caught up', type: 'date' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Places to go', singular: 'Place', icon: 'compass', color: '#26c6da', group: 'Life', fields: [
      { label: 'Place', type: 'text', required: true }, { label: 'Country', type: 'text' },
      { label: 'Status', type: 'select', options: ['Dreaming', 'Planning', 'Booked', 'Been'] },
      { label: 'Budget', type: 'money' }, { label: 'Best season', type: 'text' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Learning', singular: 'Course', icon: 'graduation', color: '#a78bfa', group: 'Grow', fields: [
      { label: 'What', type: 'text', required: true }, { label: 'Source', type: 'text' },
      { label: 'Status', type: 'select', options: ['Queued', 'In progress', 'Done'] },
      { label: 'Progress %', type: 'number' }, { label: 'Link', type: 'url' }, { label: 'Notes', type: 'textarea' } ] },
  { name: 'Projects', singular: 'Project', icon: 'rocket', color: '#ff8a65', group: 'Grow', fields: [
      { label: 'Project', type: 'text', required: true },
      { label: 'Status', type: 'select', options: ['Idea', 'Active', 'Paused', 'Shipped'] },
      { label: 'Started', type: 'date' }, { label: 'Deadline', type: 'date' },
      { label: 'Link', type: 'url' }, { label: 'Notes', type: 'textarea' } ] },
];

/* ─── Helpers ─── */
export const recordsOf = cid => S().records?.[cid] || [];
const fieldKey = f => f.id;
const titleField = c => c.fields.find(f => f.type === 'text') || c.fields[0];

export function collectionViewId(c) { return `c_${c.id}`; }

function normaliseFields(raw) {
  return raw.map(f => ({
    id: f.id || uid('fld'),
    label: f.label,
    type: f.type || 'text',
    options: f.options || [],
    required: !!f.required,
  }));
}

/* ─── Create / edit collections ─── */
export async function newCollection(template = null) {
  const v = await openForm({
    title: template ? `New: ${template.name}` : 'Create a tracker',
    size: 'wide', submitLabel: template ? 'Create tracker' : 'Next: add fields',
    fields: [
      { name: 'name', label: 'What are you tracking?', type: 'text', required: true,
        placeholder: 'e.g. Plants, Guitar gear, Clients', value: template?.name,
        hint: 'This becomes a module in your sidebar' },
      { name: 'singular', label: 'One of them is called…', type: 'text', half: true,
        placeholder: 'e.g. Plant', value: template?.singular },
      { name: 'group', label: 'Sidebar section', type: 'select', half: true, value: template?.group || 'Life',
        options: ['Do', 'Think', 'Life', 'Grow', 'Custom'] },
      { name: 'icon', label: 'Icon', type: 'icon', value: template?.icon || 'star' },
      { name: 'color', label: 'Colour', type: 'color', value: template?.color || '#7c5cff' },
    ],
  });
  if (!v) return;

  const fields = template
    ? normaliseFields(template.fields)
    : normaliseFields([{ label: 'Name', type: 'text', required: true }]);

  const c = store.add('collections', {
    ...v,
    singular: v.singular || v.name.replace(/s$/, ''),
    fields,
  });
  store.commit(s => { s.records[c.id] = []; });
  registerCollections();
  store.log('layers', `Built a new tracker: ${c.name}`, collectionViewId(c));
  toast(`“${c.name}” is live in your sidebar`, 'ok');

  if (template) navigate(collectionViewId(c));
  else editFields(c.id);
  return c;
}

export async function editFields(cid) {
  const c = store.find('collections', cid);
  if (!c) return;

  const draw = () => `
    <p class="dim mb-4" style="font-size:13px">Fields are the columns of your tracker. Drag to reorder is not needed — use the arrows.</p>
    <div class="fieldlist" data-fieldlist>
      ${c.fields.map((f, i) => `
        <div class="fieldrow" data-fid="${f.id}">
          <span class="fieldrow__ic">${icon(FIELD_TYPES.find(t => t.value === f.type)?.icon || 'note', 'ic ic--sm')}</span>
          <div class="grow">
            <strong>${esc(f.label)}</strong>
            <small class="dim">${esc(FIELD_TYPES.find(t => t.value === f.type)?.label || f.type)}${f.required ? ' · required' : ''}
              ${f.options?.length ? ` · ${f.options.length} choices` : ''}</small>
          </div>
          <div class="row gap-1">
            <button class="icon-btn icon-btn--sm" data-up="${f.id}" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp')}</button>
            <button class="icon-btn icon-btn--sm" data-down="${f.id}" ${i === c.fields.length - 1 ? 'disabled' : ''}>${icon('chevronDown')}</button>
            <button class="icon-btn icon-btn--sm" data-efield="${f.id}">${icon('edit')}</button>
            <button class="icon-btn icon-btn--sm icon-btn--danger" data-dfield="${f.id}">${icon('trash')}</button>
          </div>
        </div>`).join('')}
    </div>
    <button class="btn btn--block mt-4" data-addfield>${icon('plus')}Add a field</button>`;

  const refresh = () => {
    const body = qs('#modalBody');
    if (body) { body.innerHTML = draw(); wire(body); }
  };

  function wire(body) {
    body.querySelector('[data-addfield]').onclick = async () => {
      const v = await fieldForm();
      if (!v) return;
      store.update('collections', cid, col => ({ fields: [...col.fields, { id: uid('fld'), ...v }] }));
      c.fields = store.find('collections', cid).fields;
      refresh(); registerCollections();
    };
    body.querySelectorAll('[data-efield]').forEach(b => b.onclick = async () => {
      const f = c.fields.find(x => x.id === b.dataset.efield);
      const v = await fieldForm(f);
      if (!v) return;
      store.update('collections', cid, col => ({ fields: col.fields.map(x => x.id === f.id ? { ...x, ...v } : x) }));
      c.fields = store.find('collections', cid).fields;
      refresh(); registerCollections();
    });
    body.querySelectorAll('[data-dfield]').forEach(b => b.onclick = async () => {
      if (c.fields.length <= 1) return toast('A tracker needs at least one field', 'warn');
      store.update('collections', cid, col => ({ fields: col.fields.filter(x => x.id !== b.dataset.dfield) }));
      c.fields = store.find('collections', cid).fields;
      refresh(); registerCollections();
    });
    const swap = (id, dir) => {
      const i = c.fields.findIndex(x => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= c.fields.length) return;
      const next = [...c.fields];
      [next[i], next[j]] = [next[j], next[i]];
      store.update('collections', cid, { fields: next });
      c.fields = next;
      refresh();
    };
    body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => swap(b.dataset.up, -1));
    body.querySelectorAll('[data-down]').forEach(b => b.onclick = () => swap(b.dataset.down, 1));
  }

  modal.open({
    title: `Fields · ${c.name}`, size: 'wide', body: draw(),
    footer: `<div class="grow"></div><button class="btn btn--primary" data-done>Done</button>`,
    onMount: (body, foot) => {
      wire(body);
      foot.querySelector('[data-done]').onclick = () => { modal.close(); registerCollections(); render(); };
    },
    onClose: () => { registerCollections(); render(); },
  });
}

async function fieldForm(f = null) {
  const v = await openForm({
    title: f ? `Edit field · ${f.label}` : 'New field',
    submitLabel: f ? 'Save field' : 'Add field',
    fields: [
      { name: 'label', label: 'Field name', type: 'text', required: true, placeholder: 'e.g. Status', value: f?.label },
      { name: 'type', label: 'Type', type: 'select', value: f?.type || 'text',
        options: FIELD_TYPES.map(t => ({ value: t.value, label: t.label })) },
      { name: 'options', label: 'Choices', type: 'tags', value: f?.options,
        placeholder: 'Low, Medium, High', hint: 'Only used by the “Choice” type — separate with commas' },
      { name: 'required', label: 'Required field', type: 'checkbox', value: f?.required },
    ],
  });
  return v;
}

/* ─── Records ─── */
function recordFields(c, rec = {}) {
  return c.fields.map(f => {
    const base = { name: f.id, label: f.label, required: f.required, value: rec[f.id] };
    switch (f.type) {
      case 'textarea': return { ...base, type: 'textarea', rows: 3 };
      case 'number': return { ...base, type: 'number', step: 'any', half: true };
      case 'money': return { ...base, type: 'number', step: 0.01, half: true, label: `${f.label} (${settings().currency})` };
      case 'date': return { ...base, type: 'date', half: true };
      case 'select': return { ...base, type: 'select', half: true, options: ['', ...(f.options || [])] };
      case 'tags': return { ...base, type: 'tags' };
      case 'checkbox': return { ...base, type: 'checkbox' };
      case 'rating': return { ...base, type: 'rating', half: true };
      case 'url': return { ...base, type: 'text', placeholder: 'https://' };
      default: return { ...base, type: 'text' };
    }
  });
}

export async function newRecord(cid, preset = {}) {
  const c = store.find('collections', cid);
  if (!c) return;
  const v = await openForm({
    title: `New ${c.singular || 'entry'}`, size: c.fields.length > 5 ? 'wide' : '',
    fields: recordFields(c, preset), submitLabel: 'Add',
  });
  if (!v) return;
  store.commit(s => {
    s.records[cid] = [{ id: uid('rec'), createdAt: Date.now(), ...v }, ...(s.records[cid] || [])];
  }, { key: 'records' });
  toast(`${c.singular || 'Entry'} added`, 'ok');
  render();
}

async function editRecord(cid, rid) {
  const c = store.find('collections', cid);
  const rec = recordsOf(cid).find(r => r.id === rid);
  if (!c || !rec) return;
  const v = await openForm({
    title: `Edit ${c.singular || 'entry'}`, size: c.fields.length > 5 ? 'wide' : '',
    fields: recordFields(c, rec), values: rec, submitLabel: 'Save',
  });
  if (!v) return;
  store.commit(s => {
    s.records[cid] = (s.records[cid] || []).map(r => r.id === rid ? { ...r, ...v, updatedAt: Date.now() } : r);
  }, { key: 'records' });
  toast('Saved', 'ok');
  render();
}

function deleteRecord(cid, rid) {
  store.commit(s => { s.records[cid] = (s.records[cid] || []).filter(r => r.id !== rid); }, { key: 'records' });
  render();
}

/* ─── Cell rendering ─── */
function cell(f, value) {
  if (value == null || value === '') return '<span class="dim">—</span>';
  switch (f.type) {
    case 'checkbox': return value ? `<span class="chip chip--ok">${icon('check', 'ic ic--sm')}Yes</span>` : '<span class="chip">No</span>';
    case 'rating': return `<span class="stars" title="${value}/5">${'★'.repeat(Number(value) || 0)}<span class="dim">${'☆'.repeat(5 - (Number(value) || 0))}</span></span>`;
    case 'money': return `<span class="mono">${fmtMoney(value, settings().currency)}</span>`;
    case 'number': return `<span class="mono">${Number(value).toLocaleString()}</span>`;
    case 'date': return esc(fmtDate(value));
    case 'select': return `<span class="chip chip--accent">${esc(value)}</span>`;
    case 'tags': return (Array.isArray(value) ? value : [value]).map(t => `<span class="chip">${esc(t)}</span>`).join(' ');
    case 'url': return `<a href="${esc(value)}" target="_blank" rel="noopener noreferrer" class="row gap-1">${icon('external', 'ic ic--sm')}Open</a>`;
    case 'textarea': return esc(truncate(value, 70));
    default: return esc(String(value));
  }
}

/* ─── Dynamic view registration ─── */
export function registerCollections() {
  // drop views for collections that no longer exist
  const live = new Set(S().collections.map(c => collectionViewId(c)));
  for (const c of S().collections) buildCollectionView(c);
  window.__gabikCollectionViews ??= new Set();
  for (const id of window.__gabikCollectionViews) if (!live.has(id)) unregisterView(id);
  window.__gabikCollectionViews = live;
}

function buildCollectionView(c) {
  registerView(collectionViewId(c), {
    title: c.name,
    icon: c.icon || 'star',
    hue: c.color || '#8b6dff',
    group: c.group || 'Custom',
    order: 200,
    custom: true,
    collectionId: c.id,
    desc: `Your own tracker · ${plural(c.fields.length, 'field')}`,
    keywords: [c.name.toLowerCase(), c.singular?.toLowerCase() || '', 'tracker', 'custom'],
    badge: () => recordsOf(c.id).length || null,

    render(p) {
      const col = store.find('collections', c.id) || c;
      const recs = recordsOf(col.id);
      const q = (p.q || '').toLowerCase();
      const sortKey = p.sort || '';
      const dir = p.dir === 'asc' ? 1 : -1;
      const mode = p.mode || col.defaultView || 'table';

      let shown = [...recs];
      if (q) shown = shown.filter(r => col.fields.some(f => String(r[f.id] ?? '').toLowerCase().includes(q)));
      if (sortKey) shown.sort(by(r => r[sortKey] ?? '', dir));
      else shown.sort(by('createdAt', -1));

      const head = pageHead(col.name, `${plural(recs.length, col.singular?.toLowerCase() || 'entry', (col.singular || 'entrie') + 's')} tracked`, `
        <div class="seg">
          <button class="${mode === 'table' ? 'is-on' : ''}" data-cmode="table">${icon('list')}<span class="hide-sm">Table</span></button>
          <button class="${mode === 'cards' ? 'is-on' : ''}" data-cmode="cards">${icon('grid')}<span class="hide-sm">Cards</span></button>
        </div>
        <button class="icon-btn" data-csettings title="Tracker settings">${icon('settings')}</button>
        <button class="btn btn--primary" data-cnew>${icon('plus')}New ${esc(col.singular || 'entry')}</button>`, col.icon);

      if (!recs.length) return head + `<div class="card">${emptyState(col.icon || 'star', `No ${esc(col.name.toLowerCase())} yet`,
        `This tracker is yours — ${plural(col.fields.length, 'field')} ready to fill.`,
        `<div class="row gap-2 mt-3"><button class="btn btn--primary" data-cnew>Add the first one</button>
         <button class="btn" data-cfields>Edit fields</button></div>`)}</div>`;

      /* summary stats from numeric + choice fields */
      const numFields = col.fields.filter(f => f.type === 'number' || f.type === 'money');
      const choiceField = col.fields.find(f => f.type === 'select' && f.options?.length);
      const rateField = col.fields.find(f => f.type === 'rating');
      const stats = `<div class="grid grid--stat mb-6">
        ${statTile({ label: 'Total', value: recs.length, sub: plural(recs.length, col.singular?.toLowerCase() || 'entry', (col.singular || 'entrie') + 's'), icon: col.icon || 'database' })}
        ${numFields.slice(0, 2).map(f => {
          const vals = recs.map(r => Number(r[f.id])).filter(v => !isNaN(v));
          const total = sum(vals);
          return statTile({ label: f.label, value: f.type === 'money' ? fmtMoney(total, settings().currency) : round(total, 2).toLocaleString(),
            sub: vals.length ? `avg ${f.type === 'money' ? fmtMoney(avg(vals), settings().currency) : round(avg(vals), 1)}` : 'no values', icon: f.type === 'money' ? 'wallet' : 'chart', tone: 'info' });
        }).join('')}
        ${rateField ? (() => {
          const vals = recs.map(r => Number(r[rateField.id])).filter(v => v > 0);
          return statTile({ label: rateField.label, value: vals.length ? round(avg(vals), 1) + '★' : '—', sub: `${vals.length} rated`, icon: 'star', tone: 'warn' });
        })() : ''}
        ${choiceField ? (() => {
          const top = [...new Set(recs.map(r => r[choiceField.id]).filter(Boolean))]
            .map(v => ({ v, n: recs.filter(r => r[choiceField.id] === v).length })).sort((a, b) => b.n - a.n)[0];
          return statTile({ label: choiceField.label, value: top ? top.n : 0, sub: top ? `mostly “${top.v}”` : 'not set', icon: 'pie', tone: 'ok' });
        })() : ''}
      </div>`;

      const bar = `<div class="filterbar">
        <div class="notes__search" style="max-width:280px;flex:1">
          ${icon('search', 'ic ic--sm')}
          <input class="input" placeholder="Search ${esc(col.name.toLowerCase())}…" value="${esc(p.q || '')}" data-cq />
        </div>
        <div class="grow"></div>
        <select class="select select--inline" data-csort>
          <option value="">Newest first</option>
          ${col.fields.map(f => `<option value="${f.id}"${sortKey === f.id ? ' selected' : ''}>Sort by ${esc(f.label)}</option>`).join('')}
        </select>
        ${sortKey ? `<button class="btn btn--sm" data-cdir>${icon(dir === 1 ? 'chevronUp' : 'chevronDown')}${dir === 1 ? 'Asc' : 'Desc'}</button>` : ''}
      </div>`;

      const body = mode === 'cards' ? cardsHtml(col, shown) : tableHtml(col, shown);
      return head + stats + bar + body;
    },

    onMount(root) {
      const cid = c.id;
      on(root, 'click', '[data-cnew]', () => newRecord(cid));
      on(root, 'click', '[data-cedit]', (e, el) => editRecord(cid, el.dataset.cedit));
      on(root, 'click', '[data-cfields]', () => editFields(cid));
      on(root, 'click', '[data-cmode]', (e, el) => navigate(collectionViewId(c), { ...params(), mode: el.dataset.cmode }));
      on(root, 'click', '[data-cdir]', () => navigate(collectionViewId(c), { ...params(), dir: params().dir === 'asc' ? 'desc' : 'asc' }));
      on(root, 'click', '[data-cdel]', async (e, el) => {
        if (await confirmDialog({ title: `Delete this ${c.singular || 'entry'}?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })) {
          deleteRecord(cid, el.dataset.cdel); toast('Deleted', 'ok');
        }
      });
      root.querySelector('[data-csort]')?.addEventListener('change', e =>
        navigate(collectionViewId(c), { ...params(), sort: e.target.value }));
      const qi = root.querySelector('[data-cq]');
      qi?.addEventListener('input', debounceLocal(() => {
        const val = qi.value;
        navigate(collectionViewId(c), { ...params(), q: val });
        setTimeout(() => { const again = qs('[data-cq]'); if (again) { again.focus(); again.setSelectionRange(val.length, val.length); } }, 0);
      }, 320));
      on(root, 'click', '[data-csettings]', e => collectionMenu(e, cid));
    },
  });
}

let _dt;
const debounceLocal = (fn, ms) => (...a) => { clearTimeout(_dt); _dt = setTimeout(() => fn(...a), ms); };

function tableHtml(col, rows) {
  const shownFields = col.fields.slice(0, 7);
  return `<div class="card"><div class="table__wrap"><table class="table">
    <thead><tr>${shownFields.map(f => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.length ? rows.map(r => `<tr>
      ${shownFields.map(f => `<td>${cell(f, r[f.id])}</td>`).join('')}
      <td class="tr"><div class="row gap-1" style="justify-content:flex-end">
        <button class="icon-btn icon-btn--sm" data-cedit="${r.id}">${icon('edit')}</button>
        <button class="icon-btn icon-btn--sm icon-btn--danger" data-cdel="${r.id}">${icon('trash')}</button>
      </div></td></tr>`).join('')
      : `<tr><td colspan="${shownFields.length + 1}" class="tc dim" style="padding:30px">Nothing matches your search</td></tr>`}
    </tbody></table></div></div>`;
}

function cardsHtml(col, rows) {
  const tf = titleField(col);
  const rest = col.fields.filter(f => f.id !== tf?.id).slice(0, 5);
  if (!rows.length) return `<div class="card">${emptyState('search', 'Nothing matches', 'Try a different search.')}</div>`;
  return `<div class="grid grid--3">${rows.map(r => `
    <article class="card card--pad card--hover rcard" style="--cc:${esc(col.color || '#7c5cff')}">
      <header class="rcard__head">
        <span class="rcard__ic">${icon(col.icon || 'star', 'ic ic--sm')}</span>
        <h3 class="grow truncate">${esc(r[tf?.id] || 'Untitled')}</h3>
        <button class="icon-btn icon-btn--sm" data-cedit="${r.id}">${icon('edit')}</button>
      </header>
      <dl class="rcard__fields">
        ${rest.filter(f => r[f.id] != null && r[f.id] !== '' && !(Array.isArray(r[f.id]) && !r[f.id].length))
          .map(f => `<div><dt>${esc(f.label)}</dt><dd>${cell(f, r[f.id])}</dd></div>`).join('') || '<div class="dim">No details yet</div>'}
      </dl>
      <footer class="rcard__foot">
        <button class="btn btn--ghost btn--sm" data-cedit="${r.id}">Open</button>
        <button class="btn btn--ghost btn--sm icon-btn--danger" data-cdel="${r.id}">${icon('trash')}</button>
      </footer>
    </article>`).join('')}</div>`;
}

function collectionMenu(e, cid) {
  const c = store.find('collections', cid);
  contextMenu(e, [
    { label: 'Edit fields', icon: 'layers', action: () => editFields(cid) },
    { label: 'Rename / restyle', icon: 'palette', action: async () => {
        const v = await openForm({ title: 'Tracker settings', size: 'wide', submitLabel: 'Save',
          fields: [
            { name: 'name', label: 'Name', type: 'text', required: true, value: c.name },
            { name: 'singular', label: 'Singular', type: 'text', half: true, value: c.singular },
            { name: 'group', label: 'Sidebar section', type: 'select', half: true, value: c.group || 'Custom',
              options: ['Do', 'Think', 'Life', 'Grow', 'Custom'] },
            { name: 'icon', label: 'Icon', type: 'icon', value: c.icon },
            { name: 'color', label: 'Colour', type: 'color', value: c.color },
          ] });
        if (!v) return;
        store.update('collections', cid, v);
        registerCollections(); toast('Tracker updated', 'ok'); render();
      } },
    '-',
    { label: 'Export as CSV', icon: 'download', action: () => exportCsv(cid) },
    { label: 'Duplicate structure', icon: 'copy', action: () => {
        const copy = store.add('collections', { ...c, id: undefined, name: c.name + ' (copy)', fields: c.fields.map(f => ({ ...f, id: uid('fld') })) });
        store.commit(s => { s.records[copy.id] = []; });
        registerCollections(); toast('Duplicated', 'ok'); navigate(collectionViewId(copy));
      } },
    '-',
    { label: 'Delete tracker', icon: 'trash', danger: true, action: async () => {
        if (await confirmDialog({ title: `Delete “${c.name}”?`,
          message: `The tracker and all ${recordsOf(cid).length} entries will be removed permanently.`,
          confirmLabel: 'Delete everything', danger: true })) {
          store.commit(s => { delete s.records[cid]; });
          store.remove('collections', cid);
          unregisterView(collectionViewId(c));
          registerCollections();
          toast('Tracker deleted', 'ok');
          navigate('builder');
        }
      } },
  ]);
}

function exportCsv(cid) {
  const c = store.find('collections', cid);
  const rows = recordsOf(cid);
  const escCsv = v => {
    const s = Array.isArray(v) ? v.join('; ') : v === true ? 'yes' : v === false ? 'no' : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [c.fields.map(f => escCsv(f.label)).join(','),
    ...rows.map(r => c.fields.map(f => escCsv(r[f.id])).join(','))].join('\n');
  download(`${slug(c.name) || 'tracker'}.csv`, csv, 'text/csv');
  toast('CSV exported', 'ok');
}

/* ─── Builder hub view ─── */
registerView('builder', {
  title: 'Builder', icon: 'layers', group: 'Grow', order: 90,
  desc: 'Create your own trackers and modules',
  keywords: ['builder', 'create', 'custom', 'tracker', 'make', 'new module', 'database'],

  render() {
    const cols = S().collections;
    const head = pageHead('Builder', 'Design a tracker for anything — it becomes a real part of your system',
      `<button class="btn btn--primary" data-newcol>${icon('plus')}New tracker</button>`, 'layers');

    const mine = cols.length ? `
      <h2 class="section-title">${icon('database')}Your trackers</h2>
      <div class="grid grid--3 mb-6">${cols.map(c => {
        const n = recordsOf(c.id).length;
        return `<article class="card card--pad card--hover buildcard" style="--cc:${esc(c.color || '#7c5cff')}">
          <button class="buildcard__open" data-open="${collectionViewId(c)}">
            <span class="buildcard__ic">${icon(c.icon || 'star', 'ic ic--lg')}</span>
            <h3>${esc(c.name)}</h3>
            <p class="dim">${plural(n, c.singular?.toLowerCase() || 'entry', (c.singular || 'entrie') + 's')}
              · ${plural(c.fields.length, 'field')}</p>
          </button>
          <div class="row gap-2 mt-3">
            <button class="btn btn--sm grow" data-open="${collectionViewId(c)}">Open</button>
            <button class="icon-btn icon-btn--sm" data-cfg="${c.id}">${icon('settings')}</button>
          </div>
        </article>`;
      }).join('')}</div>` : '';

    const templates = `
      <h2 class="section-title">${icon('sparkles')}Start from a template</h2>
      <p class="dim mb-4" style="font-size:13px">Every template is fully editable once created — rename it, add fields, change the icon.</p>
      <div class="grid grid--3">${TEMPLATES.map((t, i) => `
        <button class="card card--pad card--hover tmplcard" data-tmpl="${i}" style="--cc:${t.color}">
          <span class="tmplcard__ic">${icon(t.icon, 'ic ic--lg')}</span>
          <div class="grow">
            <h3>${esc(t.name)}</h3>
            <p class="dim">${t.fields.map(f => f.label).slice(0, 3).join(' · ')}…</p>
          </div>
          <span class="tmplcard__add">${icon('plus', 'ic ic--sm')}</span>
        </button>`).join('')}</div>`;

    const explainer = cols.length ? '' : `
      <div class="card card--pad mb-6 callout">
        <div class="row gap-3">
          <span class="stat__icon">${icon('lightbulb')}</span>
          <div>
            <h3>This is where GabikOS becomes yours</h3>
            <p class="dim mt-2" style="font-size:13.4px">Tasks, habits and notes cover the basics. But your life has
            things nobody else tracks — your plants, your gear, your clients, the coffees you want to try.
            Build a tracker for those here and it gets its own place in the sidebar, with a table, cards,
            search, stats and CSV export.</p>
          </div>
        </div>
      </div>`;

    return head + explainer + mine + templates;
  },

  onMount(root) {
    on(root, 'click', '[data-newcol]', () => newCollection());
    on(root, 'click', '[data-tmpl]', (e, el) => newCollection(TEMPLATES[Number(el.dataset.tmpl)]));
    on(root, 'click', '[data-open]', (e, el) => navigate(el.dataset.open));
    on(root, 'click', '[data-cfg]', (e, el) => { e.stopPropagation(); collectionMenu(e, el.dataset.cfg); });
  },
});
