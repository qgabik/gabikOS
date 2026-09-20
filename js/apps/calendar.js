/* ═══════════════════════════════════════════════════════════════
   GabikOS — Calendar: month grid, agenda, events + task due dates
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu } from '../core/ui.js';
import { esc, iso, today, parseISO, addDays, addDaysISO, monthName, dayName, fmtDate,
         startOfWeek, diffDays, by, plural, isPast } from '../core/util.js';

const CATS = [
  { value: 'personal', label: 'Personal', color: '#7c5cff' },
  { value: 'work', label: 'Work', color: '#4cc4f0' },
  { value: 'health', label: 'Health', color: '#3ecf8e' },
  { value: 'social', label: 'Social', color: '#f5b544' },
  { value: 'travel', label: 'Travel', color: '#ec6ead' },
  { value: 'other', label: 'Other', color: '#6b7286' },
];
export const catOf = v => CATS.find(c => c.value === v) || CATS[5];

export const eventsOn = date => S().events.filter(e => e.date === date).sort(by('time'));
export const upcoming = (n = 6) => S().events
  .filter(e => diffDays(e.date, today()) >= 0)
  .sort(by(e => e.date + (e.time || '')))
  .slice(0, n);

const eventFields = (e = {}) => [
  { name: 'title', label: 'Event', type: 'text', required: true, placeholder: 'e.g. Dinner with Anna', value: e.title },
  { name: 'date', label: 'Date', type: 'date', required: true, half: true, value: e.date || today() },
  { name: 'time', label: 'Time', type: 'time', half: true, value: e.time || '' },
  { name: 'duration', label: 'Duration (min)', type: 'number', half: true, min: 0, step: 15, value: e.duration },
  { name: 'category', label: 'Category', type: 'select', half: true, value: e.category || 'personal', options: CATS },
  { name: 'location', label: 'Location', type: 'text', placeholder: 'Where?', value: e.location },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: e.notes },
];

export async function newEvent(preset = {}) {
  const v = await openForm({ title: 'New event', fields: eventFields(preset), submitLabel: 'Add event' });
  if (!v) return;
  store.add('events', v);
  store.log('calendar', `Scheduled “${v.title}”`, 'calendar');
  toast('Event added', 'ok');
  render();
}

async function editEvent(id) {
  const e = store.find('events', id);
  if (!e) return;
  const v = await openForm({ title: 'Edit event', fields: eventFields(e), values: e, submitLabel: 'Save' });
  if (!v) return;
  store.update('events', id, v);
  toast('Event updated', 'ok');
  render();
}

registerView('calendar', {
  title: 'Calendar', icon: 'calendar', group: 'Do', order: 40,
  desc: 'Your month at a glance',
  keywords: ['calendar', 'event', 'schedule', 'month', 'agenda'],

  render(p) {
    const cursor = p.m ? parseISO(p.m + '-01') : new Date();
    const view = p.view || 'month';
    const y = cursor.getFullYear(), mo = cursor.getMonth();
    const monthLabel = `${monthName(mo)} ${y}`;

    const head = pageHead('Calendar', monthLabel, `
      <div class="seg">
        <button class="${view === 'month' ? 'is-on' : ''}" data-cview="month">${icon('grid')}<span class="hide-sm">Month</span></button>
        <button class="${view === 'agenda' ? 'is-on' : ''}" data-cview="agenda">${icon('list')}<span class="hide-sm">Agenda</span></button>
      </div>
      <div class="seg">
        <button data-nav-m="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
        <button data-nav-m="0">Today</button>
        <button data-nav-m="1" aria-label="Next month">${icon('chevronRight')}</button>
      </div>
      <button class="btn btn--primary" data-new-event>${icon('plus')}<span class="hide-sm">Event</span></button>`, 'calendar');

    return head + (view === 'agenda' ? agendaHtml() : monthHtml(y, mo));
  },

  onMount(root) {
    on(root, 'click', '[data-new-event]', () => newEvent({ date: params().d || today() }));
    on(root, 'click', '[data-cview]', (e, el) => navigate('calendar', { ...params(), view: el.dataset.cview }));
    on(root, 'click', '[data-day]', (e, el) => {
      if (e.target.closest('[data-ev]')) return;
      newEvent({ date: el.dataset.day });
    });
    on(root, 'click', '[data-ev]', (e, el) => { e.stopPropagation(); editEvent(el.dataset.ev); });
    on(root, 'contextmenu', '[data-ev]', (e, el) => {
      const id = el.dataset.ev, ev = store.find('events', id);
      contextMenu(e, [
        { label: 'Edit', icon: 'edit', action: () => editEvent(id) },
        { label: 'Move to tomorrow', icon: 'arrowRight', action: () => { store.update('events', id, { date: addDaysISO(ev.date, 1) }); render(); } },
        '-',
        { label: 'Delete', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete event?', message: `“${ev.title}” will be removed.`, confirmLabel: 'Delete', danger: true })) {
              store.remove('events', id); toast('Event deleted', 'ok'); render();
            }
          } },
      ]);
    });
    on(root, 'click', '[data-nav-m]', (e, el) => {
      const d = Number(el.dataset.navM);
      if (!d) return navigate('calendar', { ...params(), m: '' });
      const cur = params().m ? parseISO(params().m + '-01') : new Date();
      cur.setDate(1);
      cur.setMonth(cur.getMonth() + d);
      navigate('calendar', { ...params(), m: iso(cur).slice(0, 7) });
    });
  },
});

function monthHtml(y, mo) {
  const wk = settings().weekStartsOn ?? 1;
  const first = new Date(y, mo, 1);
  const gridStart = startOfWeek(first, wk);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(iso(addDays(gridStart, i)));
  const dowNames = Array.from({ length: 7 }, (_, i) => dayName(addDays(gridStart, i), true));
  const t = today();

  return `<div class="card cal">
    <div class="cal__dow">${dowNames.map(d => `<span>${esc(d)}</span>`).join('')}</div>
    <div class="cal__grid">
      ${days.map(d => {
        const dt = parseISO(d);
        const other = dt.getMonth() !== mo;
        const evs = eventsOn(d);
        const tasks = S().tasks.filter(x => !x.done && x.due === d);
        return `<div class="cal__cell ${other ? 'is-other' : ''} ${d === t ? 'is-today' : ''}" data-day="${d}">
          <span class="cal__num">${dt.getDate()}</span>
          <div class="cal__items">
            ${evs.slice(0, 3).map(e => `<button class="cal__ev" data-ev="${e.id}"
              style="--ec:${catOf(e.category).color}" title="${esc(e.title)}">
              ${e.time ? `<b>${esc(e.time)}</b> ` : ''}${esc(e.title)}</button>`).join('')}
            ${tasks.slice(0, 2).map(x => `<span class="cal__task" title="Task: ${esc(x.title)}">
              ${icon('checkSquare', 'ic ic--sm')}${esc(x.title)}</span>`).join('')}
            ${evs.length + tasks.length > 5 ? `<span class="cal__more">+${evs.length + tasks.length - 5} more</span>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function agendaHtml() {
  const list = S().events.filter(e => diffDays(e.date, today()) >= -1).sort(by(e => e.date + (e.time || '')));
  const tasks = S().tasks.filter(t => !t.done && t.due).sort(by('due'));
  const byDate = new Map();
  for (const e of list) { byDate.set(e.date, byDate.get(e.date) || { events: [], tasks: [] }); byDate.get(e.date).events.push(e); }
  for (const t of tasks) { byDate.set(t.due, byDate.get(t.due) || { events: [], tasks: [] }); byDate.get(t.due).tasks.push(t); }
  const dates = [...byDate.keys()].sort();

  if (!dates.length) return `<div class="card">${emptyState('calendar', 'Nothing scheduled',
    'Add an event or give a task a due date and it will show up here.',
    '<button class="btn btn--primary mt-3" data-new-event>Add an event</button>')}</div>`;

  return `<div class="agenda">${dates.map(d => {
    const { events, tasks } = byDate.get(d);
    return `<section class="agenda__day card">
      <header class="agenda__head ${d === today() ? 'is-today' : ''}">
        <div class="agenda__date"><strong>${parseISO(d).getDate()}</strong><span>${dayName(d, true)}</span></div>
        <div><h3>${esc(fmtDate(d))}</h3>
          <small class="dim">${plural(events.length, 'event')} · ${plural(tasks.length, 'task')}</small></div>
        <div class="grow"></div>
        <button class="icon-btn icon-btn--sm" data-day="${d}" title="Add event here">${icon('plus')}</button>
      </header>
      <div class="list">
        ${events.map(e => `<div class="list__row"><span class="tag-dot" style="background:${catOf(e.category).color}"></span>
          <button class="list__main list__row--btn" data-ev="${e.id}" style="padding:0;background:none">
            <div class="list__title">${esc(e.title)}</div>
            <div class="list__sub">${e.time ? `${icon('clock','ic ic--sm')}${esc(e.time)}` : 'All day'}
              ${e.location ? `· ${esc(e.location)}` : ''} · ${esc(catOf(e.category).label)}</div>
          </button></div>`).join('')}
        ${tasks.map(t => `<div class="list__row"><span class="tag-dot" style="background:var(--text-3)"></span>
          <div class="list__main"><div class="list__title">${esc(t.title)}</div>
          <div class="list__sub">${icon('checkSquare','ic ic--sm')}Task ${isPast(t.due) ? '· <span style="color:var(--bad)">overdue</span>' : ''}</div></div></div>`).join('')}
      </div>
    </section>`;
  }).join('')}</div>`;
}
