/* ═══════════════════════════════════════════════════════════════
   GabikOS — store: single source of truth + localStorage persistence
   ═══════════════════════════════════════════════════════════════ */
import { uid, today, deep, debounce } from './util.js';

const KEY = 'gabikos:v1';

/** The four shortcuts a phone gets when nobody has chosen otherwise.
 *  Lives here rather than in main.js so Settings can read it without the
 *  two importing each other. */
export const DEFAULT_TABS = ['dashboard', 'finance', 'school', 'health'];

/** What the bar should actually show: a chosen set, else the default. */
export const barTabs = () =>
  (store.state.settings.mobileTabs?.length ? store.state.settings.mobileTabs : DEFAULT_TABS).slice(0, 4);
const SCHEMA = 1;

/* ─── Default state ─── */
export function blankState() {
  return {
    schema: SCHEMA,
    createdAt: Date.now(),
    profile: { name: 'Gabik', tagline: 'Building a better day, every day.', onboarded: false },
    settings: {
      theme: 'midnight',
      accent: '#8b6dff',
      density: 'normal',
      textScale: 1,
      colorfulNav: true,
      currency: '€',
      weekStartsOn: 1,
      pomodoro: { focus: 25, short: 5, long: 15, rounds: 4 },
      goals: { water: 8, steps: 8000, sleep: 8, focusMins: 120 },
      school: { days: 5, periods: [] },
      health: { linked: false, autoPull: true, lastAt: 0, lastSource: '', lastDays: 0,
                shortcutName: 'Steps to GabikOS', autoRefresh: false, shortcutBlocked: false },
      sidebarCollapsed: false,
      /* The four shortcuts along the bottom of a phone screen. Empty means
         "use the app's default", so a later change to that default reaches
         anyone who has not chosen for themselves. */
      mobileTabs: [],
      pinned: ['dashboard', 'tasks', 'habits', 'notes'],
    },

    /* productivity */
    projects: [],
    tasks: [],
    habits: [],
    habitLog: {},          // { habitId: { 'YYYY-MM-DD': number } }
    notes: [],
    events: [],
    goals: [],
    subjects: [],          // school subjects
    lessons: [],           // timetable entries

    /* life */
    journal: [],           // { id, date, mood, energy, text, gratitude[] }
    workouts: [],
    metrics: [],           // { id, date, weight, steps, sleep, water }
    meals: [],
    transactions: [],
    budgets: [],
    media: [],             // books / films / shows / games
    bookmarks: [],
    focusSessions: [],

    /* user-built modules */
    collections: [],       // { id, name, icon, color, fields[], group }
    records: {},           // { collectionId: [ {id, ...values} ] }

    /* meta */
    activity: [],          // recent actions, newest first

    /* local-only sync bookkeeping — never itself synced */
    syncMeta: { slices: {}, pulled: {}, lastPull: 0 },
  };
}

/* ─── Store ─── */
class Store {
  constructor() {
    this.state = blankState();
    this.listeners = new Set();
    this.history = [];
    this.persist = debounce(() => this.save(), 260);
  }

  /* --- persistence --- */
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      this.state = this.migrate(data);
      return true;
    } catch (err) {
      console.warn('[GabikOS] could not load saved data:', err);
      return false;
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
      return true;
    } catch (err) {
      console.error('[GabikOS] save failed:', err);
      window.dispatchEvent(new CustomEvent('gabikos:save-error', { detail: err }));
      return false;
    }
  }

  migrate(data) {
    const base = blankState();
    // shallow-merge top level, deep-merge the two nested config objects
    const next = { ...base, ...data, schema: SCHEMA };
    next.profile = { ...base.profile, ...(data.profile || {}) };
    next.settings = { ...base.settings, ...(data.settings || {}) };
    next.settings.pomodoro = { ...base.settings.pomodoro, ...(data.settings?.pomodoro || {}) };
    next.settings.goals = { ...base.settings.goals, ...(data.settings?.goals || {}) };
    next.settings.school = { ...base.settings.school, ...(data.settings?.school || {}) };
    next.settings.health = { ...base.settings.health, ...(data.settings?.health || {}) };
    // guarantee array/object shapes even if a file was hand-edited
    for (const [k, v] of Object.entries(base)) {
      if (Array.isArray(v) && !Array.isArray(next[k])) next[k] = [];
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof next[k] !== 'object') next[k] = {};
    }
    return next;
  }

  /* --- reactivity --- */
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(meta = {}) { for (const fn of this.listeners) fn(this.state, meta); }

  /** Mutate state through a callback, then persist + notify. */
  commit(fn, meta = {}) {
    if (!meta.silentHistory) this.history.push(JSON.stringify(this.state));
    if (this.history.length > 40) this.history.shift();
    fn(this.state);
    if (!meta.fromRemote && !meta.seed) this.touch(meta.key);
    this.persist();
    this.emit(meta);
  }

  /** Record that a top-level key changed, so sync knows what to push.
   *  No key means "assume everything" (import, reset, seed). */
  touch(key) {
    const now = Date.now();
    this.state.syncMeta ??= { slices: {}, lastPull: 0 };
    const slices = key ? [key] : Object.keys(blankState()).filter(k => k !== 'syncMeta');
    for (const k of slices) this.state.syncMeta.slices[k] = now;
  }

  undo() {
    const prev = this.history.pop();
    if (!prev) return false;
    this.state = JSON.parse(prev);
    this.save();
    this.emit({ undo: true });
    return true;
  }

  /* --- generic collection helpers --- */
  list(key) { return this.state[key] || []; }
  find(key, id) { return (this.state[key] || []).find(x => x.id === id); }

  add(key, item, meta = {}) {
    const rec = { id: uid(key.slice(0, 3)), createdAt: Date.now(), ...item };
    this.commit(s => { s[key] = [rec, ...(s[key] || [])]; }, { key, action: 'add', ...meta });
    return rec;
  }

  update(key, id, patch, meta = {}) {
    this.commit(s => {
      const i = (s[key] || []).findIndex(x => x.id === id);
      if (i > -1) s[key][i] = { ...s[key][i], ...(typeof patch === 'function' ? patch(s[key][i]) : patch), updatedAt: Date.now() };
    }, { key, action: 'update', ...meta });
    return this.find(key, id);
  }

  remove(key, id, meta = {}) {
    const rec = this.find(key, id);
    this.commit(s => { s[key] = (s[key] || []).filter(x => x.id !== id); }, { key, action: 'remove', ...meta });
    return rec;
  }

  reorder(key, ids, meta = {}) {
    this.commit(s => {
      const map = new Map((s[key] || []).map(x => [x.id, x]));
      s[key] = ids.map(id => map.get(id)).filter(Boolean)
        .concat((s[key] || []).filter(x => !ids.includes(x.id)));
    }, { key, action: 'reorder', ...meta });
  }

  /* --- settings --- */
  setSetting(path, value) {
    this.commit(s => {
      const parts = path.split('.');
      let node = s.settings;
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
      node[parts.at(-1)] = value;
    }, { key: 'settings', action: 'set', silentHistory: true });
  }
  setProfile(patch) {
    this.commit(s => { s.profile = { ...s.profile, ...patch }; }, { key: 'profile', silentHistory: true });
  }

  /* --- activity feed --- */
  log(icon, text, view) {
    this.commit(s => {
      s.activity = [{ id: uid('act'), icon, text, view, ts: Date.now() }, ...(s.activity || [])].slice(0, 60);
    }, { key: 'activity', silentHistory: true });
  }

  /* --- import / export --- */
  toJSON() { return JSON.stringify({ ...this.state, exportedAt: new Date().toISOString(), app: 'GabikOS' }, null, 2); }

  importJSON(text, { merge = false } = {}) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') throw new Error('Not a valid GabikOS backup file.');
    if (merge) {
      const cur = this.state;
      const next = this.migrate(data);
      for (const [k, v] of Object.entries(next)) {
        if (Array.isArray(v) && Array.isArray(cur[k])) {
          const seen = new Set(cur[k].map(x => x.id));
          next[k] = [...cur[k], ...v.filter(x => !seen.has(x.id))];
        }
      }
      next.habitLog = { ...cur.habitLog, ...next.habitLog };
      next.records = { ...cur.records, ...next.records };
      this.commit(s => { Object.assign(s, next); }, { action: 'import' });
    } else {
      this.commit(s => { Object.assign(s, this.migrate(data)); }, { action: 'import' });
    }
    return true;
  }

  reset() {
    this.commit(s => {
      const keep = deep(s.profile);
      Object.assign(s, blankState());
      s.profile = { ...keep, onboarded: true };
    }, { action: 'reset' });
  }

  /* --- storage footprint --- */
  usage() {
    const bytes = new Blob([JSON.stringify(this.state)]).size;
    return { bytes, kb: Math.round(bytes / 1024), pct: Math.min(100, Math.round((bytes / 5_000_000) * 100)) };
  }
}

export const store = new Store();

/* Convenience accessors used across apps */
export const S = () => store.state;
export const settings = () => store.state.settings;
export const profile = () => store.state.profile;

/* ─── Starter content (opt-in on first run) ─── */
export function seedStarter({ onlyIfEmpty = false } = {}) {
  const skip = key => onlyIfEmpty && (store.state[key] || []).length > 0;
  const t = today();
  const p1 = { id: uid('prj'), name: 'Personal', color: '#7c5cff', createdAt: Date.now() };
  const p2 = { id: uid('prj'), name: 'Work', color: '#4cc4f0', createdAt: Date.now() };
  const p3 = { id: uid('prj'), name: 'Health', color: '#3ecf8e', createdAt: Date.now() };

  store.commit(s => {
    if (!skip('projects')) s.projects = [p1, p2, p3];
    if (!skip('tasks')) s.tasks = [
      { id: uid('tsk'), title: 'Plan the week ahead', done: false, priority: 2, due: t, projectId: p1.id, tags: ['planning'], createdAt: Date.now() },
      { id: uid('tsk'), title: 'Deep work block — 90 minutes', done: false, priority: 3, due: t, projectId: p2.id, tags: ['focus'], createdAt: Date.now() },
      { id: uid('tsk'), title: 'Meal prep for tomorrow', done: false, priority: 1, due: t, projectId: p3.id, tags: [], createdAt: Date.now() },
      { id: uid('tsk'), title: 'Read 20 pages', done: true, priority: 1, due: t, projectId: p1.id, tags: [], completedAt: Date.now(), createdAt: Date.now() },
    ];
    if (!skip('habits')) s.habits = [
      { id: uid('hab'), name: 'Workout', icon: 'dumbbell', color: '#3ecf8e', target: 1, unit: 'session', schedule: [1,2,3,4,5,6,0], linkedMetric: '', createdAt: Date.now() },
      { id: uid('hab'), name: 'Read', icon: 'book', color: '#f5b544', target: 20, unit: 'pages', schedule: [1,2,3,4,5,6,0], linkedMetric: '', createdAt: Date.now() },
      /* Linked from the start: this habit and the Water tile count the same
         glasses, and two tallies of one thing only ever disagree. */
      { id: uid('hab'), name: 'Drink water', icon: 'droplet', color: '#4cc4f0', target: 8, unit: 'glasses', schedule: [1,2,3,4,5,6,0], linkedMetric: 'water', createdAt: Date.now() },
      { id: uid('hab'), name: 'No phone in bed', icon: 'moon', color: '#a78bfa', target: 1, unit: 'day', schedule: [1,2,3,4,5,6,0], linkedMetric: '', createdAt: Date.now() },
    ];
    if (!skip('goals')) s.goals = [
      { id: uid('gol'), title: 'Get consistently fit', why: 'More energy, better mood, longer life.',
        target: 100, current: 35, unit: '%', deadline: '', category: 'Health', color: '#3ecf8e',
        milestones: [
          { id: uid('ms'), text: 'Train 3x a week for a month', done: true },
          { id: uid('ms'), text: 'Run 5k without stopping', done: false },
          { id: uid('ms'), text: 'Hit the gym 100 times this year', done: false },
        ], createdAt: Date.now() },
    ];
    if (!skip('notes')) s.notes = [
      { id: uid('not'), title: 'Welcome to GabikOS', folder: 'Inbox', tags: ['start-here'], pinned: true,
        body: `# Welcome to GabikOS 👋\n\nThis is **your** system. Everything lives on this device — no account, no cloud, no tracking.\n\n## Getting around\n- **Ctrl + K** opens the command palette. It is the fastest way to do anything.\n- **Ctrl + N** creates something new, wherever you are.\n- **Ctrl + B** collapses the sidebar.\n- Press **?** any time for the full shortcut list.\n\n## Make it yours\nGo to **Builder** and create your own tracker — plants, gear, recipes, clients, anything. It becomes a real module in your sidebar with its own table, filters and stats.\n\n## Keep your data safe\n**Settings → Data** exports everything to a single JSON file. Do that now and then.\n\n> Small steps, every day. That is the whole trick.`,
        createdAt: Date.now(), updatedAt: Date.now() },
    ];
    if (!skip('metrics')) s.metrics = [{ id: uid('met'), date: t, water: 3, steps: 4200, sleep: 7.5, weight: null }];
    if (!skip('activity')) s.activity = [{ id: uid('act'), icon: 'sparkles', text: 'GabikOS installed — welcome aboard', view: 'dashboard', ts: Date.now() }];
  }, { action: 'seed', seed: true });
}
