/* ═══════════════════════════════════════════════════════════════
   GabikOS — data: the figures every screen reads

   These used to live inside the screen that drew them, which meant the
   dashboard could not show your next lesson without loading the whole
   timetable editor, or today's water without the whole Health module.
   Thirteen screens arrived on every boot for the sake of a dozen numbers.

   So the numbers live here, and the screens that draw them are fetched
   when you actually open one. Each module still re-exports its own slice,
   so nothing that imported `dueToday` from tasks.js had to change.

   Rule for this file: it reads and writes the store, and nothing else.
   No markup, no module of its own to load.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from './store.js';
import { render } from './router.js';
import { toast } from './ui.js';
import { esc, today, addDaysISO, diffDays, isPast, by, sum, pct, clamp, round, uid, parseISO,
         monthKey, fmtMoney, isoWeek, minutesBetween } from './util.js';

/* ═══ Tasks ═══════════════════════════════════════════════════ */
export const openTasks = () => S().tasks.filter(t => !t.done);
export const dueToday = () => openTasks().filter(t => t.due && diffDays(t.due, today()) <= 0);
export const overdue = () => openTasks().filter(t => t.due && isPast(t.due));
export const projectOf = id => S().projects.find(p => p.id === id);

/* ═══ Health ══════════════════════════════════════════════════
   Habits read through these too, so they come first.             */
export const metricFor = (date = today()) => S().metrics.find(m => m.date === date);

/** Sleep is kept in minutes; the old `sleep` hours field still reads. */
export function sleepMinsOf(m) {
  if (!m) return null;
  if (m.sleepMins != null) return m.sleepMins;
  if (m.bedtime && m.wake) return minutesBetween(m.bedtime, m.wake);
  if (m.sleep != null) return Math.round(m.sleep * 60);
  return null;
}

/** Keep the derived fields honest whatever route wrote the patch. */
export function derive(next) {
  if (next.bedtime && next.wake && next.sleepMins == null) next.sleepMins = minutesBetween(next.bedtime, next.wake);
  if (next.sleepMins != null) next.sleep = round(next.sleepMins / 60, 2);
  else if (next.sleep != null && next.sleepMins == null) next.sleepMins = Math.round(next.sleep * 60);
  return next;
}

export function setMetric(patch, date = today()) {
  const existing = metricFor(date);
  if (existing) store.update('metrics', existing.id, derive({ ...existing, ...patch }));
  else store.add('metrics', derive({ date, ...patch }));
}

export const stepsReadAt = (m = metricFor()) =>
  (m?.src?.steps === 'apple' && m?.srcAt?.steps) ? m.srcAt.steps : 0;

export const waterToday = () => metricFor()?.water || 0;
export function addWater(n = 1) {
  const goal = settings().goals.water || 8;
  const next = clamp(waterToday() + n, 0, 30);
  setMetric({ water: next });
  if (next === goal) toast('Water goal reached 💧', 'ok');
  render();
}

/* ═══ Habits ══════════════════════════════════════════════════
   A linked habit keeps no tally of its own: it reads and writes the
   metric, so the tile and the habit can never disagree.            */
export const METRIC_LINKS = [
  { value: '', label: 'Keep its own count' },
  { value: 'water', label: 'Water — the glasses in Health' },
  { value: 'steps', label: 'Steps — the count in Health' },
  { value: 'sleep', label: 'Sleep — the hours in Health' },
];
const linkOf = habitId => store.find('habits', habitId)?.linkedMetric || '';

export const logFor = (habitId, date) => {
  const key = linkOf(habitId);
  if (key) return Number(metricFor(date)?.[key]) || 0;
  return S().habitLog?.[habitId]?.[date] || 0;
};
export const isScheduled = (habit, date) =>
  !habit.schedule?.length || habit.schedule.includes(parseISO(date).getDay());

export function setLog(habitId, date, value) {
  const key = linkOf(habitId);
  if (key) { setMetric({ [key]: value > 0 ? value : null }, date); return; }
  store.commit(s => {
    s.habitLog[habitId] ??= {};
    if (value > 0) s.habitLog[habitId][date] = value;
    else delete s.habitLog[habitId][date];
  }, { key: 'habitLog' });
}

/**
 * Linking a habit that already has months behind it would make that history
 * disappear, because the habit stops reading its own log. Move it across
 * first, in one write, and never over a figure Health already holds.
 */
export function adoptHistory(habitId, key) {
  const log = S().habitLog?.[habitId] || {};
  const dates = Object.keys(log);
  if (!dates.length || !key) return 0;
  let moved = 0;
  store.commit(st => {
    for (const d of dates) {
      const m = st.metrics.find(x => x.date === d);
      if (m) { if (m[key] == null) { m[key] = log[d]; moved++; } }
      else { st.metrics.unshift({ id: uid('met'), date: d, [key]: log[d], createdAt: Date.now() }); moved++; }
    }
  }, { key: 'metrics' });
  return moved;
}

export function bumpHabit(habitId, date = today(), delta = 1) {
  const hab = store.find('habits', habitId);
  if (!hab) return;
  const target = Number(hab.target) || 1;
  const cur = logFor(habitId, date);
  // tapping a single-step habit toggles it; multi-step habits increment then wrap
  const next = target <= 1 ? (cur ? 0 : 1) : clamp(cur + delta, 0, target);
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

/**
 * Anyone who already had "Drink water" gets it joined to the Water tile,
 * once, carrying its history. Writing the field on every habit — empty for
 * the rest — is what keeps that to once.
 */
export function linkKnownHabits() {
  const pending = S().habits.filter(h => h.linkedMetric === undefined);
  if (!pending.length) return 0;
  let linked = 0;
  for (const h of pending) {
    const water = /water/i.test(h.name || '') || /glass/i.test(h.unit || '');
    const key = water ? 'water' : '';
    if (key) { adoptHistory(h.id, key); linked++; }
    store.update('habits', h.id, { linkedMetric: key }, { silentHistory: true });
  }
  return linked;
}

/** Heatmap cells for a habit — 91 days of level 0–4. */
export function cellsFor(habitId, days = 91) {
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

/* ═══ Calendar ════════════════════════════════════════════════ */
export const EVENT_CATS = [
  { value: 'personal', label: 'Personal', color: '#7c5cff' },
  { value: 'work', label: 'Work', color: '#4cc4f0' },
  { value: 'health', label: 'Health', color: '#3ecf8e' },
  { value: 'social', label: 'Social', color: '#f5b544' },
  { value: 'travel', label: 'Travel', color: '#ec6ead' },
  { value: 'other', label: 'Other', color: '#6b7286' },
];
export const catOf = v => EVENT_CATS.find(c => c.value === v) || EVENT_CATS[5];
export const eventsOn = date => S().events.filter(e => e.date === date).sort(by('time'));
export const upcoming = (n = 6) => S().events
  .filter(e => diffDays(e.date, today()) >= 0)
  .sort(by(e => e.date + (e.time || '')))
  .slice(0, n);

/* ═══ Focus ═══════════════════════════════════════════════════ */
export const focusToday = () => sum(S().focusSessions.filter(s => s.date === today()).map(s => s.minutes));
export const focusWeek = () => {
  const week = Array.from({ length: 7 }, (_, i) => addDaysISO(today(), -i));
  return sum(S().focusSessions.filter(s => week.includes(s.date)).map(s => s.minutes));
};

/* ═══ Journal ═════════════════════════════════════════════════ */
export const MOODS = [
  { value: 1, label: 'Rough',   emoji: '😔', color: '#ff6b6b' },
  { value: 2, label: 'Low',     emoji: '😕', color: '#f5904f' },
  { value: 3, label: 'Okay',    emoji: '😐', color: '#f5b544' },
  { value: 4, label: 'Good',    emoji: '🙂', color: '#7cc98f' },
  { value: 5, label: 'Great',   emoji: '😄', color: '#3ecf8e' },
];
export const moodOf = v => MOODS.find(m => m.value === Number(v)) || MOODS[2];
export const entryFor = date => S().journal.find(e => e.date === date);
export const hasEntryToday = () => !!entryFor(today());

/* ═══ Goals ═══════════════════════════════════════════════════ */
export const activeGoals = () => S().goals.filter(g => !g.archived);
export const goalProgress = g => {
  if (g.milestones?.length) return pct(g.milestones.filter(m => m.done).length, g.milestones.length);
  return pct(Number(g.current) || 0, Number(g.target) || 100);
};

/* ═══ Money ═══════════════════════════════════════════════════ */
export const CATEGORIES = {
  income:  ['Salary', 'Freelance', 'Gift', 'Refund', 'Investment', 'Other income'],
  expense: ['Food', 'Groceries', 'Rent', 'Bills', 'Transport', 'Health', 'Shopping',
            'Fun', 'Subscriptions', 'Travel', 'Education', 'Other'],
};
export const currency = () => settings().currency || '€';
export const money = v => fmtMoney(v, currency());
export const txOfMonth = (mk = monthKey()) => S().transactions.filter(t => (t.date || '').startsWith(mk));
export const monthIncome = mk => sum(txOfMonth(mk).filter(t => t.type === 'income').map(t => t.amount));
export const monthExpense = mk => sum(txOfMonth(mk).filter(t => t.type === 'expense').map(t => t.amount));
export const monthNet = mk => monthIncome(mk) - monthExpense(mk);

/* ═══ School ══════════════════════════════════════════════════ */
export const DEFAULT_PERIODS = [
  { n: 0,  start: '07:10', end: '07:55' }, { n: 1,  start: '08:00', end: '08:45' },
  { n: 2,  start: '08:55', end: '09:40' }, { n: 3,  start: '09:50', end: '10:35' },
  { n: 4,  start: '10:45', end: '11:30' }, { n: 5,  start: '11:40', end: '12:25' },
  { n: 6,  start: '12:30', end: '13:15' }, { n: 7,  start: '13:20', end: '14:05' },
  { n: 8,  start: '14:10', end: '14:55' }, { n: 9,  start: '15:00', end: '15:45' },
  { n: 10, start: '15:50', end: '16:35' }, { n: 11, start: '16:50', end: '17:35' },
  { n: 12, start: '17:40', end: '18:25' }, { n: 13, start: '18:30', end: '19:15' },
];
export const periods = () => settings().school?.periods?.length ? settings().school.periods : DEFAULT_PERIODS;
export const schoolCfg = () => ({ weekMode: 'single', days: 5, ...(settings().school || {}) });
export const weekParity = (d = new Date()) => (isoWeek(d) % 2 ? 'a' : 'b');
export const parityLabel = p => (p === 'a' ? 'Week A (odd)' : 'Week B (even)');
export const subjects = () => S().subjects || [];
export const lessons = () => S().lessons || [];
export const subjectOf = id => subjects().find(s => s.id === id);

export const clockToMins = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Lessons for a weekday, in period order, respecting week parity. */
export function lessonsOn(day, parity = weekParity()) {
  return lessons()
    .filter(l => l.day === day && (l.week === 'all' || !l.week || l.week === parity))
    .sort(by(l => Number(l.period)));
}
export const todayLessons = () => lessonsOn(new Date().getDay());

/** What is on right now, and what is next. */
export function currentAndNext() {
  const now = nowMins();
  const ps = periods();
  const timed = todayLessons().map(l => {
    const p = ps.find(x => Number(x.n) === Number(l.period));
    if (!p) return null;
    const span = Math.max(1, Number(l.span) || 1);
    const idx = ps.findIndex(x => Number(x.n) === Number(p.n));
    const last = ps[Math.min(idx + span - 1, ps.length - 1)] || p;
    return { ...l, span, start: clockToMins(p.start), end: clockToMins(last.end), startStr: p.start, endStr: last.end };
  }).filter(l => l && !isNaN(l.start));
  return {
    current: timed.find(l => now >= l.start && now < l.end) || null,
    next: timed.find(l => l.start > now) || null,
    all: timed,
  };
}
