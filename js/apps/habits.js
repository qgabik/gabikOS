/* ═══════════════════════════════════════════════════════════════
   GabikOS — Habits: streaks, heatmap, per-day progress
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { registerView, render, navigate, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile } from '../core/ui.js';
import { esc, today, iso, addDaysISO, diffDays, pct, clamp, plural, dayName, parseISO, round } from '../core/util.js';
import { heatmap } from '../core/charts.js';

/* ─── Log access ─── */
export const logFor = (habitId, date) => S().habitLog?.[habitId]?.[date] || 0;
export const isScheduled = (habit, date) =>
  !habit.schedule?.length || habit.schedule.includes(parseISO(date).getDay());

export function setLog(habitId, date, value) {
  store.commit(s => {
    s.habitLog[habitId] ??= {};
    if (value > 0) s.habitLog[habitId][date] = value;
    else delete s.habitLog[habitId][date];
  }, { key: 'habitLog' });
}

export function bumpHabit(habitId, date = today(), delta = 1) {
  const hab = store.find('habits', habitId);
  if (!hab) return;
  const target = Number(hab.target) || 1;
  const cur = logFor(habitId, date);
  // tapping a single-step habit toggles it; multi-step habits increment then wrap
  const next = target <= 1
    ? (cur ? 0 : 1)
    : clamp(cur + delta, 0, target);
  setLog(habitId, date, next);
  if (next >= target && cur < target) {
    const st = streak(habitId);
    toast(st > 1 ? `${esc(hab.name)} done — ${st} day streak 🔥` : `${esc(hab.name)} done`, 'ok');
    store.log('flame', `${hab.name} completed`, 'habits');
  }
  render();
}

/** Current consecutive streak of completed scheduled days, ending today/yesterday. */
export function streak(habitId) {
  const hab = store.find('habits', habitId);
  if (!hab) return 0;
  const target = Number(hab.target) || 1;
  let n = 0, d = today();
  // today not yet done doesn't break a streak that was alive yesterday
  if (logFor(habitId, d) < target) d = addDaysISO(d, -1);
  for (let guard = 0; guard < 1500; guard++) {
    if (!isScheduled(hab, d)) { d = addDaysISO(d, -1); continue; }
    if (logFor(habitId, d) >= target) { n++; d = addDaysISO(d, -1); }
    else break;
  }
  return n;
}

export function bestStreak(habitId) {
  const hab = store.find('habits', habitId);
  const log = S().habitLog?.[habitId] || {};
  const dates = Object.keys(log).sort();
  if (!dates.length) return 0;
  const target = Number(hab?.target) || 1;
  let best = 0, run = 0, cursor = dates[0];
  const end = today();
  for (let guard = 0; guard < 4000 && diffDays(cursor, end) <= 0; guard++) {
    if (isScheduled(hab, cursor)) {
      if ((log[cursor] || 0) >= target) { run++; best = Math.max(best, run); }
      else run = 0;
    }
    cursor = addDaysISO(cursor, 1);
  }
  return best;
}

/** Completion rate over the last n scheduled days. */
export function rate(habitId, days = 30) {
  const hab = store.find('habits', habitId);
  if (!hab) return 0;
  const target = Number(hab.target) || 1;
  let done = 0, total = 0;
  for (let i = 0; i < days; i++) {
    const d = addDaysISO(today(), -i);
    if (!isScheduled(hab, d)) continue;
    total++;
    if (logFor(habitId, d) >= target) done++;
  }
  return pct(done, total);
}

export const doneToday = () =>
  S().habits.filter(h => isScheduled(h, today()) && logFor(h.id, today()) >= (Number(h.target) || 1));
export const dueTodayHabits = () => S().habits.filter(h => isScheduled(h, today()));

/* ─── Forms ─── */
const DAYS = [{ value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' }];

const habitFields = (h = {}) => [
  { name: 'name', label: 'Habit', type: 'text', required: true, placeholder: 'e.g. Morning run', value: h.name },
  { name: 'target', label: 'Daily target', type: 'number', half: true, min: 1, step: 1, value: h.target ?? 1,
    hint: 'How many to count as done' },
  { name: 'unit', label: 'Unit', type: 'text', half: true, placeholder: 'glasses, pages, reps…', value: h.unit || 'time' },
  { name: 'schedule', label: 'Days', type: 'multiselect', options: DAYS, numeric: true,
    value: h.schedule ?? [1, 2, 3, 4, 5, 6, 0], hint: 'Leave all on for a daily habit' },
  { name: 'color', label: 'Colour', type: 'color', value: h.color || '#3ecf8e' },
  { name: 'icon', label: 'Icon', type: 'icon', value: h.icon || 'flame' },
  { name: 'why', label: 'Why does this matter?', type: 'textarea', rows: 2, value: h.why,
    hint: 'Read this on the days you do not feel like it' },
];

export async function newHabit() {
  const v = await openForm({ title: 'New habit', fields: habitFields(), submitLabel: 'Create habit' });
  if (!v) return;
  store.add('habits', { ...v, target: Number(v.target) || 1 });
  toast('Habit created — day one starts now', 'ok');
  render();
}

async function editHabit(id) {
  const h = store.find('habits', id);
  if (!h) return;
  const v = await openForm({ title: 'Edit habit', fields: habitFields(h), values: h, submitLabel: 'Save' });
  if (!v) return;
  store.update('habits', id, { ...v, target: Number(v.target) || 1 });
  toast('Habit updated', 'ok');
  render();
}

/* ─── Heatmap cells ─── */
function cellsFor(habitId, days = 91) {
  const hab = store.find('habits', habitId);
  const target = Number(hab?.target) || 1;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDaysISO(today(), -i);
    const v = logFor(habitId, d);
    const sched = isScheduled(hab, d);
    const ratio = v / target;
    const level = !sched && !v ? 0 : ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : v > 0 ? 1 : 0;
    out.push({ level, color: hab?.color, title: `${d} · ${v}/${target}${sched ? '' : ' (rest day)'}` });
  }
  return out;
}

/* ─── View ─── */
registerView('habits', {
  title: 'Habits', icon: 'flame', group: 'Do', order: 20,
  desc: 'Streaks, routines and consistency',
  keywords: ['habit', 'streak', 'routine', 'daily'],
  badge: () => { const d = dueTodayHabits().length - doneToday().length; return d > 0 ? d : null; },

  render(p) {
    const habits = S().habits;
    const view = p.view || 'cards';
    if (!habits.length) {
      return pageHead('Habits', 'Small things, done often', '', 'flame') +
        `<div class="card">${emptyState('flame', 'No habits yet',
          'Habits are the compound interest of self-improvement. Start with one you can do in two minutes.',
          '<button class="btn btn--primary mt-3" data-new-habit>Create your first habit</button>')}</div>`;
    }

    const due = dueTodayHabits(), done = doneToday();
    const todayPct = pct(done.length, due.length);
    const best = habits.map(h => ({ h, s: streak(h.id) })).sort((a, b) => b.s - a.s)[0];
    const avgRate = Math.round(habits.reduce((a, h) => a + rate(h.id, 30), 0) / habits.length);

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Today', value: `${done.length}<small>/${due.length}</small>`,
        sub: todayPct === 100 ? 'All done — perfect day' : `${todayPct}% complete`, icon: 'check',
        tone: todayPct === 100 ? 'ok' : '' })}
      ${statTile({ label: 'Best streak', value: best?.s || 0, sub: best?.s ? best.h.name : 'Get started today', icon: 'flame', tone: 'warn' })}
      ${statTile({ label: '30-day rate', value: avgRate + '%', sub: 'across all habits', icon: 'trendUp', tone: avgRate >= 70 ? 'ok' : '' })}
      ${statTile({ label: 'Tracking', value: habits.length, sub: plural(habits.length, 'habit'), icon: 'target', tone: 'info' })}
    </div>`;

    const head = pageHead('Habits', `${done.length} of ${due.length} done today`, `
      <div class="seg" data-view>
        <button class="${view === 'cards' ? 'is-on' : ''}" data-v="cards">${icon('grid')}<span class="hide-sm">Cards</span></button>
        <button class="${view === 'grid' ? 'is-on' : ''}" data-v="grid">${icon('columns')}<span class="hide-sm">Week</span></button>
      </div>
      <button class="btn btn--primary" data-new-habit>${icon('plus')}New habit</button>`, 'flame');

    const body = view === 'grid' ? weekGrid(habits) : `<div class="grid grid--2">
      ${habits.map(h => {
        const target = Number(h.target) || 1;
        const v = logFor(h.id, today());
        const complete = v >= target;
        const sched = isScheduled(h, today());
        const st = streak(h.id);
        return `<article class="habit ${complete ? 'is-done' : ''} ${sched ? '' : 'is-rest'}" style="--hc:${esc(h.color || '#3ecf8e')}">
          <div class="habit__head">
            <span class="habit__icon">${icon(h.icon || 'flame')}</span>
            <div class="grow">
              <h3 class="habit__name">${esc(h.name)}</h3>
              <div class="habit__sub">
                ${st ? `<span class="chip chip--warn">${icon('flame','ic ic--sm')}${st} day${st > 1 ? 's' : ''}</span>` : ''}
                <span class="chip">${rate(h.id, 30)}% this month</span>
                ${sched ? '' : '<span class="chip">rest day</span>'}
              </div>
            </div>
            <button class="icon-btn icon-btn--sm" data-hmenu="${h.id}"
              aria-label="More actions for ${esc(h.name)}">${icon('more')}</button>
          </div>

          <div class="habit__counter">
            ${target > 1 ? `<button class="icon-btn icon-btn--sm" data-dec="${h.id}" ${v <= 0 ? 'disabled' : ''} aria-label="Decrease">${icon('minus')}</button>` : ''}
            <button class="habit__tick" data-bump="${h.id}" aria-label="Log ${esc(h.name)}">
              ${complete ? icon('check', 'ic ic--lg') : icon(h.icon || 'plus', 'ic ic--lg')}
            </button>
            <div class="habit__amount">
              <strong>${v}</strong><span>/ ${target} ${esc(h.unit || '')}</span>
            </div>
          </div>

          <div class="bar bar--sm mt-2"><i style="width:${pct(v, target)}%;background:${esc(h.color || 'var(--accent)')}"></i></div>
          ${heatmap(cellsFor(h.id, 91), { cols: 13, title: `${h.name} last 13 weeks` })}
          ${h.why ? `<p class="habit__why">${esc(h.why)}</p>` : ''}
        </article>`;
      }).join('')}
    </div>`;

    return head + stats + body;
  },

  onMount(root) {
    on(root, 'click', '[data-new-habit]', newHabit);
    on(root, 'click', '[data-bump]', (e, el) => bumpHabit(el.dataset.bump));
    on(root, 'click', '[data-dec]', (e, el) => bumpHabit(el.dataset.dec, today(), -1));
    on(root, 'click', '[data-v]', (e, el) => navigate('habits', { view: el.dataset.v }));
    on(root, 'click', '[data-cell]', (e, el) => {
      const [id, date] = el.dataset.cell.split('|');
      const hab = store.find('habits', id);
      const target = Number(hab.target) || 1;
      setLog(id, date, logFor(id, date) >= target ? 0 : target);
      render();
    });
    on(root, 'click', '[data-hmenu]', (e, el) => {
      const id = el.dataset.hmenu;
      const h = store.find('habits', id);
      contextMenu(e, [
        { label: 'Edit habit', icon: 'edit', action: () => editHabit(id) },
        { label: 'Mark today done', icon: 'check', action: () => { setLog(id, today(), Number(h.target) || 1); render(); } },
        { label: 'Clear today', icon: 'x', action: () => { setLog(id, today(), 0); render(); } },
        '-',
        { label: `Best streak: ${bestStreak(id)} days`, icon: 'award', action: () => {} },
        '-',
        { label: 'Delete habit', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete habit?',
              message: `“${h.name}” and its entire history will be removed.`, confirmLabel: 'Delete', danger: true })) {
              store.commit(s => { delete s.habitLog[id]; });
              store.remove('habits', id);
              toast('Habit deleted', 'ok'); render();
            }
          } },
      ]);
    });
  },
});

/* ─── Week grid ─── */
function weekGrid(habits) {
  const days = Array.from({ length: 14 }, (_, i) => addDaysISO(today(), -(13 - i)));
  return `<div class="card"><div class="table__wrap"><table class="table hgrid">
    <thead><tr><th style="min-width:160px">Habit</th>
      ${days.map(d => `<th class="tc ${d === today() ? 'is-today' : ''}">
        <span class="hgrid__dow">${dayName(d, true)}</span>
        <span class="hgrid__num">${parseISO(d).getDate()}</span></th>`).join('')}
      <th class="tc">Streak</th></tr></thead>
    <tbody>${habits.map(h => {
      const target = Number(h.target) || 1;
      return `<tr>
        <td><div class="row gap-2"><span class="habit__icon habit__icon--sm" style="--hc:${esc(h.color)}">${icon(h.icon || 'flame', 'ic ic--sm')}</span>
          <span class="truncate">${esc(h.name)}</span></div></td>
        ${days.map(d => {
          const v = logFor(h.id, d), ok = v >= target, sched = isScheduled(h, d);
          return `<td class="tc"><button class="hcell ${ok ? 'is-on' : ''} ${sched ? '' : 'is-rest'}"
            data-cell="${h.id}|${d}" style="--hc:${esc(h.color)}" title="${d}: ${v}/${target}">
            ${ok ? icon('check', 'ic ic--sm') : ''}</button></td>`;
        }).join('')}
        <td class="tc"><span class="chip chip--warn">${streak(h.id)}</span></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div></div>`;
}
