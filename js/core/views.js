/* ═══════════════════════════════════════════════════════════════
   GabikOS — the list of screens, and where to find each one

   Every screen is described here and fetched only when it is opened.
   The description is all the sidebar, the phone's tab bar, the badges
   and the search need, so the whole app is navigable from a boot that
   downloaded one screen.

   Before this, opening GabikOS meant downloading the timetable editor,
   the Apple Health bridge, the tracker builder and ten more screens —
   about 300 KB of JavaScript to parse before the dashboard could draw.
   ═══════════════════════════════════════════════════════════════ */
import { registerView, registerLazy, unregisterView } from './router.js';
import { S } from './store.js';
import { dueToday, dueTodayHabits, doneToday, hasEntryToday, todayLessons } from './data.js';
import { plural } from './util.js';

/* Static specifiers, so a browser can see the module graph and a service
   worker can cache it. */
const LOADERS = {
  tasks:    () => import('../apps/tasks.js'),
  habits:   () => import('../apps/habits.js'),
  focus:    () => import('../apps/focus.js'),
  calendar: () => import('../apps/calendar.js'),
  school:   () => import('../apps/school.js'),
  notes:    () => import('../apps/notes.js'),
  journal:  () => import('../apps/journal.js'),
  goals:    () => import('../apps/goals.js'),
  health:   () => import('../apps/health.js'),
  finance:  () => import('../apps/finance.js'),
  builder:  () => import('../apps/builder.js'),
  settings: () => import('../apps/settings.js'),
  account:  () => import('../apps/account.js'),
};

/** Fetch a screen's module — for the odd action that needs it before you open it. */
export const loadApp = name => LOADERS[name]();

/** Call something a screen exports, fetching the screen first. */
export const run = (name, fn, ...args) =>
  LOADERS[name]().then(m => m[fn]?.(...args));

const SCREENS = [
  ['tasks', { title: 'Tasks', icon: 'checkSquare', group: 'Do', order: 10,
    desc: 'Everything you need to get done',
    keywords: ['todo', 'task', 'project', 'inbox'],
    badge: () => dueToday().length || null }],

  ['habits', { title: 'Habits', icon: 'flame', group: 'Do', order: 20,
    desc: 'Streaks, routines and consistency',
    keywords: ['habit', 'streak', 'routine', 'daily'],
    badge: () => { const d = dueTodayHabits().length - doneToday().length; return d > 0 ? d : null; } }],

  ['focus', { title: 'Focus', icon: 'timer', group: 'Do', order: 25,
    desc: 'Pomodoro timer and deep work log',
    keywords: ['focus', 'pomodoro', 'timer', 'deep work', 'concentrate'] }],

  ['notes', { title: 'Notes', icon: 'note', group: 'Think', order: 30,
    desc: 'Markdown notes, ideas and references',
    keywords: ['note', 'markdown', 'idea', 'write', 'doc'] }],

  ['journal', { title: 'Journal', icon: 'journal', group: 'Think', order: 35,
    desc: 'Daily reflection and mood',
    keywords: ['journal', 'diary', 'mood', 'reflect', 'gratitude'],
    badge: () => (hasEntryToday() ? null : '•') }],

  ['calendar', { title: 'Calendar', icon: 'calendar', group: 'Do', order: 40,
    desc: 'Your month at a glance',
    keywords: ['calendar', 'event', 'schedule', 'month', 'agenda'] }],

  ['school', { title: 'School', icon: 'graduation', group: 'Do', order: 45,
    desc: 'Your timetable, subjects and next lesson',
    keywords: ['school', 'timetable', 'rozvrh', 'lessons', 'skolaonline', 'škola', 'subjects', 'class'],
    badge: () => todayLessons().length || null }],

  ['goals', { title: 'Goals', icon: 'target', group: 'Grow', order: 50,
    desc: 'The bigger picture and what moves it',
    keywords: ['goal', 'target', 'objective', 'milestone', 'ambition'] }],

  ['finance', { title: 'Money', icon: 'wallet', group: 'Life', order: 60,
    desc: 'Income, spending and budgets',
    keywords: ['money', 'finance', 'budget', 'expense', 'income', 'spending'] }],

  ['health', { title: 'Health', icon: 'heart', group: 'Life', order: 70,
    desc: 'Sleep, steps, training and body',
    keywords: ['health', 'fitness', 'workout', 'gym', 'sleep', 'bedtime', 'weight', 'water',
               'steps', 'apple health'] }],

  ['builder', { title: 'Builder', icon: 'layers', group: 'Grow', order: 90,
    desc: 'Create your own trackers and modules',
    keywords: ['builder', 'create', 'custom', 'tracker', 'make', 'new module', 'database'] }],

  ['settings', { title: 'Settings', icon: 'settings', group: 'System', order: 900,
    desc: 'Appearance, goals, data and backups',
    keywords: ['settings', 'preferences', 'theme', 'backup', 'export', 'import', 'data', 'accent'] }],
];

/** Put every screen in the nav. Only the one you open is downloaded. */
export function registerScreens() {
  for (const [id, meta] of SCREENS) registerLazy(id, meta, LOADERS[id]);
}

/* ─── Trackers you built yourself ─────────────────────────────
   These are rows in your own data, so they must appear in the nav from a
   cold boot — but the module that draws them is 30 KB, and most boots
   never open one. They are listed from the collection itself and drawn
   by Builder when you tap in.                                         */
let builderRegistrar = null;

/** Builder calls this as it loads, and takes over from the stubs. */
export function useBuilderRegistrar(fn) { builderRegistrar = fn; fn(); }

export const collectionViewId = c => `c_${c.id}`;
const recordsOf = cid => S().records?.[cid] || [];
let listed = new Set();

export function registerCollections() {
  if (builderRegistrar) return builderRegistrar();
  const live = new Set();
  for (const c of S().collections) {
    const id = collectionViewId(c);
    live.add(id);
    registerLazy(id, {
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
    }, LOADERS.builder);
  }
  for (const id of listed) if (!live.has(id)) unregisterView(id);
  listed = live;
}

/* Kept so callers that re-register after a change keep working. */
export { registerView };
