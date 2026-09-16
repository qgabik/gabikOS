/* ═══════════════════════════════════════════════════════════════
   GabikOS — Health: workouts, body metrics, water, sleep, steps
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile } from '../core/ui.js';
import { esc, today, addDaysISO, fmtDate, fmtMins, by, sum, avg, round, pct, clamp,
         plural, dayName, diffDays, parseISO } from '../core/util.js';
import { lineChart, barChart, sparkline } from '../core/charts.js';

/* ─── Daily metrics ─── */
export const metricFor = (date = today()) => S().metrics.find(m => m.date === date);
export function setMetric(patch, date = today()) {
  const existing = metricFor(date);
  if (existing) store.update('metrics', existing.id, patch);
  else store.add('metrics', { date, ...patch });
}
export const waterToday = () => metricFor()?.water || 0;
export function addWater(n = 1) {
  const goal = settings().goals.water || 8;
  const next = clamp((waterToday()) + n, 0, 30);
  setMetric({ water: next });
  if (next === goal) toast('Water goal reached 💧', 'ok');
  render();
}

const WORKOUT_TYPES = ['Strength', 'Run', 'Cycle', 'Swim', 'Walk', 'Yoga', 'HIIT', 'Sport', 'Climb', 'Other'];

const workoutFields = (w = {}) => [
  { name: 'type', label: 'Type', type: 'select', half: true, value: w.type || 'Strength', options: WORKOUT_TYPES },
  { name: 'date', label: 'Date', type: 'date', half: true, required: true, value: w.date || today() },
  { name: 'duration', label: 'Duration (min)', type: 'number', half: true, min: 1, step: 5, required: true, value: w.duration ?? 45 },
  { name: 'intensity', label: 'Intensity', type: 'select', half: true, value: w.intensity || 'moderate',
    options: [{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }, { value: 'max', label: 'All out' }] },
  { name: 'title', label: 'What did you do?', type: 'text', placeholder: 'e.g. Push day — bench, dips, shoulders', value: w.title },
  { name: 'calories', label: 'Calories (optional)', type: 'number', half: true, min: 0, step: 10, value: w.calories },
  { name: 'feel', label: 'How did it feel?', type: 'rating', half: true, value: w.feel },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: w.notes },
];

export async function newWorkout(preset = {}) {
  const v = await openForm({ title: 'Log workout', fields: workoutFields(preset), submitLabel: 'Save workout', size: 'wide' });
  if (!v) return;
  store.add('workouts', v);
  store.log('dumbbell', `${v.type} · ${v.duration} min`, 'health');
  toast('Workout logged 💪', 'ok');
  render();
}

async function logDay(date = today()) {
  const m = metricFor(date) || {};
  const v = await openForm({
    title: `Daily check-in · ${fmtDate(date)}`, size: 'wide', submitLabel: 'Save',
    fields: [
      { name: 'weight', label: 'Weight (kg)', type: 'number', half: true, min: 0, step: 0.1, value: m.weight },
      { name: 'sleep', label: 'Sleep (hours)', type: 'number', half: true, min: 0, max: 24, step: 0.25, value: m.sleep },
      { name: 'steps', label: 'Steps', type: 'number', half: true, min: 0, step: 100, value: m.steps },
      { name: 'water', label: 'Water (glasses)', type: 'number', half: true, min: 0, step: 1, value: m.water },
      { name: 'restingHr', label: 'Resting HR (bpm)', type: 'number', half: true, min: 0, step: 1, value: m.restingHr },
      { name: 'mood', label: 'Energy today', type: 'range', half: true, min: 1, max: 5, step: 1, value: m.mood ?? 3 },
    ],
  });
  if (!v) return;
  setMetric(v, date);
  toast('Day logged', 'ok');
  render();
}

const series = (key, days = 30) => {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDaysISO(today(), -i);
    const m = S().metrics.find(x => x.date === d);
    out.push({ label: `${parseISO(d).getDate()}/${parseISO(d).getMonth() + 1}`, value: m?.[key] ?? null, date: d });
  }
  return out;
};

registerView('health', {
  title: 'Health', icon: 'heart', group: 'Life', order: 70,
  desc: 'Training, body, sleep and hydration',
  keywords: ['health', 'fitness', 'workout', 'gym', 'sleep', 'weight', 'water', 'steps'],

  render(p) {
    const tab = p.tab || 'today';
    const workouts = [...S().workouts].sort(by('date', -1));
    const g = settings().goals;
    const m = metricFor() || {};

    const week = Array.from({ length: 7 }, (_, i) => addDaysISO(today(), -(6 - i)));
    const weekWorkouts = workouts.filter(w => week.includes(w.date));
    const weekMins = sum(weekWorkouts.map(w => w.duration));
    const weights = S().metrics.filter(x => x.weight != null).sort(by('date'));
    const sleepVals = S().metrics.filter(x => x.sleep != null).slice(-14).map(x => x.sleep);

    const head = pageHead('Health', `${plural(weekWorkouts.length, 'session')} this week · ${fmtMins(weekMins)} trained`, `
      <div class="seg">
        <button class="${tab === 'today' ? 'is-on' : ''}" data-tab="today">Today</button>
        <button class="${tab === 'training' ? 'is-on' : ''}" data-tab="training">Training</button>
        <button class="${tab === 'body' ? 'is-on' : ''}" data-tab="body">Body</button>
      </div>
      <button class="btn btn--primary" data-new-workout>${icon('plus')}<span class="hide-sm">Workout</span></button>`, 'heart');

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'This week', value: fmtMins(weekMins), sub: plural(weekWorkouts.length, 'workout'), icon: 'dumbbell', tone: 'ok' })}
      ${statTile({ label: 'Water today', value: `${m.water || 0}<small>/${g.water}</small>`, sub: `${pct(m.water || 0, g.water)}% of goal`, icon: 'droplet', tone: 'info' })}
      ${statTile({ label: 'Sleep', value: m.sleep ? `${m.sleep}<small>h</small>` : '—', sub: sleepVals.length ? `${round(avg(sleepVals), 1)}h avg (14d)` : 'not logged', icon: 'bed', tone: (m.sleep || 0) >= g.sleep ? 'ok' : 'warn' })}
      ${statTile({ label: 'Steps', value: m.steps ? (m.steps / 1000).toFixed(1) + 'k' : '—', sub: `goal ${(g.steps / 1000).toFixed(0)}k`, icon: 'footprints', tone: (m.steps || 0) >= g.steps ? 'ok' : '' })}
    </div>`;

    if (tab === 'training') {
      const byType = WORKOUT_TYPES.map(t => ({ label: t.slice(0, 3), value: workouts.filter(w => w.type === t).length })).filter(x => x.value);
      return head + stats + `
      <div class="grid grid--2 mb-6">
        <div class="card"><div class="card__head">${icon('chart')}<h3>Minutes per day (14 days)</h3></div>
          <div class="card__body">${barChart(Array.from({ length: 14 }, (_, i) => {
            const d = addDaysISO(today(), -(13 - i));
            return { label: dayName(d, true)[0], value: sum(workouts.filter(w => w.date === d).map(w => w.duration)) };
          }), { format: v => v + 'm' })}</div></div>
        <div class="card"><div class="card__head">${icon('pie')}<h3>Favourite sessions</h3></div>
          <div class="card__body">${byType.length ? barChart(byType, { format: v => plural(v, 'session') }) : '<div class="chart-empty">No workouts yet</div>'}</div></div>
      </div>
      <div class="card"><div class="card__head">${icon('list')}<h3>Workout log</h3><span class="nav__badge">${workouts.length}</span></div>
        <div class="list">${workouts.length ? workouts.slice(0, 60).map(w => `
          <div class="list__row">
            <span class="stat__icon">${icon('dumbbell', 'ic ic--sm')}</span>
            <div class="list__main">
              <div class="list__title">${esc(w.title || w.type)}</div>
              <div class="list__sub">${esc(w.type)} · ${fmtMins(w.duration)} · ${esc(w.intensity || 'moderate')}
                ${w.calories ? `· ${w.calories} kcal` : ''} · ${esc(fmtDate(w.date))}
                ${w.feel ? `· ${'★'.repeat(w.feel)}` : ''}</div>
            </div>
            <div class="list__actions">
              <button class="icon-btn icon-btn--sm icon-btn--danger" data-wdel="${w.id}">${icon('trash')}</button>
            </div>
          </div>`).join('') : emptyState('dumbbell', 'No workouts logged', 'Every session counts. Log the first one.',
            '<button class="btn btn--primary mt-3" data-new-workout>Log a workout</button>')}
        </div></div>`;
    }

    if (tab === 'body') {
      const wSeries = series('weight', 60).filter(x => x.value != null);
      const sSeries = series('sleep', 30);
      const first = weights[0], last = weights.at(-1);
      const change = first && last ? round(last.weight - first.weight, 1) : null;
      return head + stats + `
      <div class="grid grid--2 mb-6">
        <div class="card"><div class="card__head">${icon('scale')}<h3>Weight</h3>
          ${change != null ? `<span class="chip ${change <= 0 ? 'chip--ok' : 'chip--warn'}">${change > 0 ? '+' : ''}${change} kg</span>` : ''}</div>
          <div class="card__body">${lineChart(wSeries, { unit: ' kg', format: v => v })}</div></div>
        <div class="card"><div class="card__head">${icon('bed')}<h3>Sleep (30 days)</h3></div>
          <div class="card__body">${lineChart(sSeries.filter(x => x.value != null), { color: '#a78bfa', unit: 'h' })}</div></div>
      </div>
      <div class="card"><div class="card__head">${icon('calendar')}<h3>Daily log</h3>
        <button class="btn btn--sm" data-log-day>${icon('plus')}Log today</button></div>
        <div class="table__wrap"><table class="table">
          <thead><tr><th>Date</th><th>Weight</th><th>Sleep</th><th>Steps</th><th>Water</th><th>Energy</th><th></th></tr></thead>
          <tbody>${[...S().metrics].sort(by('date', -1)).slice(0, 40).map(x => `
            <tr><td>${esc(fmtDate(x.date))}</td>
              <td class="mono">${x.weight != null ? x.weight + ' kg' : '—'}</td>
              <td class="mono">${x.sleep != null ? x.sleep + ' h' : '—'}</td>
              <td class="mono">${x.steps != null ? Number(x.steps).toLocaleString() : '—'}</td>
              <td class="mono">${x.water || 0}</td>
              <td>${x.mood ? '●'.repeat(x.mood) + '<span class="dim">' + '○'.repeat(5 - x.mood) + '</span>' : '—'}</td>
              <td class="tr"><button class="icon-btn icon-btn--sm" data-edit-day="${esc(x.date)}">${icon('edit')}</button></td>
            </tr>`).join('') || '<tr><td colspan="7" class="dim tc" style="padding:26px">No entries yet</td></tr>'}
          </tbody></table></div></div>`;
    }

    /* today tab */
    const g2 = settings().goals;
    const recent = workouts.slice(0, 5);
    return head + stats + `
    <div class="grid grid--2 mb-6">
      <div class="card"><div class="card__head">${icon('droplet')}<h3>Hydration</h3>
        <span class="chip chip--info">${m.water || 0} / ${g2.water}</span></div>
        <div class="card__body">
          <div class="water">
            ${Array.from({ length: g2.water }, (_, i) => `<button class="glass ${i < (m.water || 0) ? 'is-full' : ''}"
              data-water-set="${i + 1}" aria-label="${i + 1} glasses">${icon('droplet')}</button>`).join('')}
          </div>
          <div class="row gap-2 mt-4">
            <button class="btn btn--sm" data-water="1">${icon('plus')}Glass</button>
            <button class="btn btn--sm btn--ghost" data-water="-1">${icon('x')}Undo</button>
            <div class="grow"></div>
            <span class="dim" style="font-size:12px">${pct(m.water || 0, g2.water)}% of your daily goal</span>
          </div>
        </div></div>

      <div class="card"><div class="card__head">${icon('activity')}<h3>Today at a glance</h3>
        <button class="btn btn--sm" data-log-day>${icon('edit')}Log</button></div>
        <div class="card__body col gap-4">
          ${[
            { label: 'Sleep', v: m.sleep, goal: g2.sleep, unit: 'h', ic: 'bed', color: '#a78bfa' },
            { label: 'Steps', v: m.steps, goal: g2.steps, unit: '', ic: 'footprints', color: '#3ecf8e' },
            { label: 'Water', v: m.water, goal: g2.water, unit: ' glasses', ic: 'droplet', color: '#4cc4f0' },
          ].map(r => `<div>
            <div class="row row--between mb-2">
              <span class="row gap-2" style="font-size:13px">${icon(r.ic, 'ic ic--sm')}${r.label}</span>
              <strong class="mono" style="font-size:13px">${r.v != null ? Number(r.v).toLocaleString() + r.unit : '—'}
                <span class="dim">/ ${Number(r.goal).toLocaleString()}${r.unit}</span></strong>
            </div>
            <div class="bar"><i style="width:${pct(r.v || 0, r.goal)}%;background:${r.color}"></i></div>
          </div>`).join('')}
        </div></div>
    </div>

    <div class="card"><div class="card__head">${icon('dumbbell')}<h3>Recent workouts</h3>
      <button class="btn btn--sm" data-new-workout>${icon('plus')}Log</button></div>
      <div class="list">${recent.length ? recent.map(w => `
        <div class="list__row"><span class="stat__icon">${icon('dumbbell', 'ic ic--sm')}</span>
          <div class="list__main"><div class="list__title">${esc(w.title || w.type)}</div>
            <div class="list__sub">${fmtMins(w.duration)} · ${esc(w.intensity || '')} · ${esc(fmtDate(w.date))}</div></div>
        </div>`).join('') : emptyState('dumbbell', 'No workouts yet', 'Log your first session and the streak starts today.',
          '<button class="btn btn--primary mt-3" data-new-workout>Log a workout</button>')}
      </div></div>`;
  },

  onMount(root) {
    on(root, 'click', '[data-tab]', (e, el) => navigate('health', { tab: el.dataset.tab }));
    on(root, 'click', '[data-new-workout]', () => newWorkout());
    on(root, 'click', '[data-water]', (e, el) => addWater(Number(el.dataset.water)));
    on(root, 'click', '[data-water-set]', (e, el) => {
      const n = Number(el.dataset.waterSet);
      setMetric({ water: waterToday() === n ? n - 1 : n });
      render();
    });
    on(root, 'click', '[data-log-day]', () => logDay());
    on(root, 'click', '[data-edit-day]', (e, el) => logDay(el.dataset.editDay));
    on(root, 'click', '[data-wdel]', async (e, el) => {
      const w = store.find('workouts', el.dataset.wdel);
      if (await confirmDialog({ title: 'Delete workout?', message: `${w.type} on ${fmtDate(w.date)}`, confirmLabel: 'Delete', danger: true })) {
        store.remove('workouts', w.id); toast('Deleted', 'ok'); render();
      }
    });
  },
});
