/* ═══════════════════════════════════════════════════════════════
   GabikOS — boot
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings, profile, seedStarter, barTabs } from './core/store.js';
import { startRouter, render, navigate, navViews, currentView, onRender } from './core/router.js';
import { applyTheme, toggleTheme, watchSystemTheme, hueFor } from './core/theme.js';
import { icon } from './core/icons.js';
import { qs, qsa, on, toast, openForm, modal, confirmDialog, closeMenu } from './core/ui.js';
import { initPalette, openPalette, closePalette, isOpen as paletteOpen, setCommands } from './core/palette.js';
import { initSync, sync, syncLabel, onSyncChange, syncNow, flush } from './core/sync.js';
import { hasStoredSession, hasSessionInUrl, canUseSupabase } from './core/supabase.js';
import { esc, initials, plural, today, debounce, throttle } from './core/util.js';
import { BUILD } from './config.js';
import { linkKnownHabits } from './core/data.js';

/* ─── The screens ─────────────────────────────────────────────
   Described in core/views.js and downloaded one at a time, when one is
   opened. Only the dashboard is here at boot, because it is what you
   land on; `run()` fetches any other screen's module for an action that
   needs it — creating a task, writing a journal entry — without opening
   that screen first. */
import { registerScreens, registerCollections, run, loadApp } from './core/views.js';
import './apps/dashboard.js';

/* ─── Sidebar ─── */
const GROUP_ORDER = ['Do', 'Think', 'Life', 'Grow', 'Custom', 'System'];

function renderNav() {
  const nav = qs('#nav');
  if (!nav) return;
  const views = navViews();
  const groups = new Map();
  for (const v of views) {
    const g = v.group || 'Workspace';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a[0]), ib = GROUP_ORDER.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  nav.innerHTML = ordered.map(([group, items]) => `
    <div class="nav__group">
      <div class="nav__label">${esc(group)}</div>
      ${items.sort((a, b) => a.order - b.order).map(v => {
        const badge = v.badge?.();
        const hue = settings().colorfulNav ? (v.hue || hueFor(v.id)) : 'var(--accent)';
        return `<button class="nav__item ${currentView() === v.id ? 'is-active' : ''}" data-nav="${v.id}"
          style="--hue:${esc(hue)}" title="${esc(v.title)}">
          ${icon(v.icon || 'chevronRight')}
          <span>${esc(v.title)}</span>
          ${badge ? `<span class="nav__badge ${v.id === 'tasks' && Number(badge) ? 'nav__badge--hot' : ''}">${esc(String(badge))}</span>` : ''}
        </button>`;
      }).join('')}
    </div>`).join('');
}

function renderTabs() {
  const bar = qs('#tabbar');
  if (!bar) return;
  const want = barTabs();
  const views = want.map(id => navViews().find(v => v.id === id)).filter(Boolean);
  const cur = currentView();

  bar.innerHTML = views.map(v => {
    const badge = v.badge?.();
    return `<button class="tab ${cur === v.id ? 'is-on' : ''}" data-nav="${v.id}"
      style="--hue:${esc(settings().colorfulNav ? (v.hue || hueFor(v.id)) : 'var(--accent)')}">
      <span class="tab__ic">${icon(v.icon || 'chevronRight')}${badge ? `<i class="tab__dot"></i>` : ''}</span>
      <span class="tab__lbl">${esc(v.title)}</span>
    </button>`;
  }).join('') + `<button class="tab ${views.every(v => v.id !== cur) ? 'is-on' : ''}" id="tabMore">
      <span class="tab__ic">${icon('grid')}</span><span class="tab__lbl">More</span>
    </button>`;
}

function renderChrome() {
  const p = profile();
  qs('#navName').textContent = p.name || 'Gabik';
  qs('#navAvatar').textContent = initials(p.name || 'G');
  qs('#brandSub').textContent = p.tagline ? p.tagline.slice(0, 26) : 'personal system';
  const openCount = S().tasks.filter(t => !t.done).length;
  qs('#navStreak').textContent = openCount ? `${plural(openCount, 'open task')}` : 'all clear ✓';
  qs('#themeBtn').innerHTML = icon(document.documentElement.dataset.mode === 'light' ? 'moon' : 'sun');
  paintSync();
  qs('#focusBtn').innerHTML = icon('timer');
  qs('#collapseBtn').innerHTML = icon('panelLeft');
  if (qs('#menuBtn')) qs('#menuBtn').innerHTML = icon('list');
  qs('#modalClose').innerHTML = icon('x');
}

function paintSync() {
  const el = qs('#syncChip');
  if (!el) return;
  const sl = syncLabel();
  el.className = `sync-chip sync-chip--${sl.tone || 'idle'} ${sync.status === 'syncing' ? 'is-busy' : ''}`;
  el.innerHTML = `${icon(sl.icon, 'ic ic--sm')}<span class="hide-sm">${esc(sl.text)}</span>`;
  el.title = sync.enabled
    ? `${sl.text}${sync.detail ? ' — ' + sync.detail : ''} · your data follows you between devices`
    : 'Saved in this browser only — open Settings → Data to export a backup';
}

/* ─── Global commands for the palette ───────────────────────────
   Each one names the screen it belongs to, so choosing it fetches that
   screen's module and calls into it. Nothing is downloaded for a command
   you never run. */
function buildCommands() {
  setCommands([
    { title: 'New task', icon: 'checkSquare', sub: 'Add something to do', meta: 'create', keywords: 'add todo create', run: () => run('tasks', 'newTask', { due: today() }) },
    { title: 'New note', icon: 'note', sub: 'Capture an idea', meta: 'create', keywords: 'add write markdown', run: () => run('notes', 'newNote') },
    { title: 'Start a focus session', icon: 'timer', sub: 'Pomodoro', meta: 'action', keywords: 'pomodoro deep work concentrate', run: () => run('focus', 'quickStart') },
    { title: "Write today's journal", icon: 'journal', sub: 'Reflect on your day', meta: 'create', keywords: 'diary mood reflect', run: () => run('journal', 'writeEntry') },
    { title: 'New habit', icon: 'flame', sub: 'Start a streak', meta: 'create', keywords: 'routine streak daily', run: () => run('habits', 'newHabit') },
    { title: 'New event', icon: 'calendar', sub: 'Put it in the diary', meta: 'create', keywords: 'schedule appointment', run: () => run('calendar', 'newEvent', { date: today() }) },
    { title: 'Add a lesson', icon: 'graduation', sub: 'Build your timetable', meta: 'create', keywords: 'school timetable rozvrh lesson class subject', run: () => run('school', 'newLesson') },
    { title: 'New goal', icon: 'target', sub: 'Something bigger', meta: 'create', keywords: 'objective ambition', run: () => run('goals', 'newGoal') },
    { title: 'Log a workout', icon: 'dumbbell', sub: 'Training session', meta: 'create', keywords: 'gym exercise fitness', run: () => run('health', 'newWorkout') },
    { title: 'Connect Apple Health', icon: 'heart', sub: 'Let your iPhone send steps and sleep', meta: 'system', keywords: 'apple health iphone steps sleep shortcuts healthkit fitness', run: () => run('health', 'openHealthBridge') },
    { title: 'Record a transaction', icon: 'wallet', sub: 'Money in or out', meta: 'create', keywords: 'expense income spend', run: () => run('finance', 'newTransaction', { date: today() }) },
    { title: 'Build a new tracker', icon: 'layers', sub: 'Create your own module', meta: 'create', keywords: 'custom collection database make', run: () => run('builder', 'newCollection') },
    { title: 'Toggle dark / light', icon: 'sun', sub: 'Switch the theme', meta: 'system', keywords: 'theme dark light appearance', run: () => { toggleTheme(); renderChrome(); toast(`${document.documentElement.dataset.mode === 'light' ? 'Light' : 'Dark'} mode`, 'info', { duration: 1400 }); } },
    { title: 'Sign in or create an account', icon: 'user', sub: 'Sync across your devices', meta: 'system', keywords: 'login register account sign in sync supabase', run: () => (sync.user ? run('account', 'doSignOut') : run('account', 'openAuth', 'in')) },
    { title: 'Sync now', icon: 'refresh', sub: 'Push everything to your other devices', meta: 'system', keywords: 'sync cloud devices upload push', run: () => { syncNow() ? toast('Syncing…', 'info') : toast('Sync is not available on this copy', 'warn'); } },
    { title: 'Change theme', icon: 'palette', sub: 'Six palettes, tuned for long sessions', meta: 'system', keywords: 'theme colour color palette dark light appearance', run: () => navigate('settings', { tab: 'appearance' }) },
    { title: 'Export a backup', icon: 'download', sub: 'Download all your data', meta: 'system', keywords: 'backup save json data', run: () => navigate('settings', { tab: 'data' }) },
    { title: 'Keyboard shortcuts', icon: 'keyboard', sub: 'See every shortcut', meta: 'system', keywords: 'help keys hotkeys', run: () => run('settings', 'showShortcuts') },
    { title: 'Settings', icon: 'settings', sub: 'Preferences and data', meta: 'system', keywords: 'preferences config', run: () => navigate('settings') },
  ]);
}

/* ─── Quick create menu ─── */
function quickCreate() {
  const opts = [
    ['Task', 'checkSquare', ['tasks', 'newTask', { due: today() }]],
    ['Note', 'note', ['notes', 'newNote']],
    ['Habit', 'flame', ['habits', 'newHabit']],
    ['Event', 'calendar', ['calendar', 'newEvent', { date: today() }]],
    ['Lesson', 'graduation', ['school', 'newLesson']],
    ['Journal entry', 'journal', ['journal', 'writeEntry']],
    ['Goal', 'target', ['goals', 'newGoal']],
    ['Workout', 'dumbbell', ['health', 'newWorkout']],
    ['Transaction', 'wallet', ['finance', 'newTransaction', { date: today() }]],
    ['Project', 'folder', ['tasks', 'newProject']],
    ['Custom tracker', 'layers', ['builder', 'newCollection']],
  ];
  modal.open({
    title: 'Create something',
    size: 'slim',
    body: `<div class="createmenu">${opts.map(([label, ic], i) => `
      <button class="createmenu__item" data-c="${i}">
        <span class="createmenu__ic">${icon(ic)}</span>
        <span>${esc(label)}</span>
      </button>`).join('')}</div>`,
    onMount: body => {
      body.addEventListener('click', e => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        modal.close();
        setTimeout(() => run(...opts[Number(b.dataset.c)][2]), 10);
      });
    },
  });
}

/* ─── Keyboard ─── */
let gPressed = false, gTimer = null;
const GOTO = { d: 'dashboard', t: 'tasks', h: 'habits', n: 'notes', f: 'focus', c: 'calendar',
  j: 'journal', g: 'goals', m: 'finance', b: 'builder', s: 'settings', l: 'health', k: 'school' };

function initKeys() {
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    const mod = e.metaKey || e.ctrlKey;

    // palette
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return; }

    if (e.key === 'Escape') {
      if (paletteOpen()) { closePalette(); return; }
      closeMenu();
      if (modal.isOpen && modal.closable) { qs('#modalClose').click(); return; }
      const sb = qs('#sidebar');
      if (sb?.classList.contains('is-open')) closeSidebar();
      return;
    }

    if (mod && e.key.toLowerCase() === 'n' && !e.shiftKey) { e.preventDefault(); quickCreate(); return; }
    if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); toggleCollapse(); return; }
    if (mod && e.key === '/') { e.preventDefault(); toggleTheme(); renderChrome(); return; }
    if (mod && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      if (store.undo()) { toast('Undone', 'info', { duration: 1600 }); render(); renderNav(); }
      else toast('Nothing to undo', 'warn', { duration: 1600 });
      return;
    }

    if (typing || modal.isOpen || paletteOpen()) return;

    if (e.key === '?') { e.preventDefault(); run('settings', 'showShortcuts'); return; }
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }

    // "g then x" navigation
    if (e.key.toLowerCase() === 'g' && !mod) {
      gPressed = true;
      clearTimeout(gTimer);
      gTimer = setTimeout(() => { gPressed = false; }, 900);
      return;
    }
    if (gPressed && GOTO[e.key.toLowerCase()]) {
      e.preventDefault();
      gPressed = false;
      navigate(GOTO[e.key.toLowerCase()]);
    }
  });
}

/* ─── Sidebar behaviour ─── */
const openSidebar = () => { qs('#sidebar').classList.add('is-open'); qs('#scrim').classList.add('is-on'); };
const closeSidebar = () => { qs('#sidebar').classList.remove('is-open'); qs('#scrim').classList.remove('is-on'); };
function toggleCollapse() {
  const shell = qs('#shell');
  const next = shell.dataset.collapsed !== 'true';
  shell.dataset.collapsed = String(next);
  store.setSetting('sidebarCollapsed', next);
}

/* ─── Onboarding ─── */
function onboard() {
  return new Promise(resolve => {
    modal.open({
      title: '', size: 'slim', closable: false,
      body: `<div class="onboard">
        <div class="onboard__logo">G</div>
        <h2>Welcome to GabikOS</h2>
        <p class="dim">A private operating system for your whole life. Nothing leaves this device.</p>
        <div class="field mt-6"><label class="field__label">What should I call you?</label>
          <input class="input input--lg" id="obName" placeholder="Your name" value="Gabik" /></div>
        <label class="check mt-4">
          <input type="checkbox" id="obSeed" checked />
          <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
          <span>Start me off with a few example habits, tasks and a welcome note</span>
        </label>
      </div>`,
      footer: `<div class="grow"></div><button class="btn btn--primary btn--lg" id="obGo">Let's go ${icon('arrowRight', 'ic ic--sm')}</button>`,
      onMount: (body, foot) => {
        const go = () => {
          const name = (qs('#obName').value || 'Gabik').trim();
          const seed = qs('#obSeed').checked;
          store.setProfile({ name, onboarded: true });
          // the cloud may already have this account's data on the way in
          if (seed) { seedStarter({ onlyIfEmpty: true }); linkKnownHabits(); }
          modal.close();
          resolve();
        };
        foot.querySelector('#obGo').onclick = go;
        body.querySelector('#obName').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
        requestAnimationFrame(() => { const i = qs('#obName'); i.focus(); i.select(); });
      },
    });
  });
}

/* A Shortcut's link carries its readings in the hash. Testing for one costs
   nothing; reading it properly costs the whole Health module. */
const HEALTH_LINK = /[?&](ah|health|steps|st|sleep|sl|bed|wake|hr|kg|cal|ex)=/;
const hasHealthLink = () => HEALTH_LINK.test(location.hash);

/* ─── Boot ─── */
async function boot() {
  store.load();

  // Every screen goes into the nav first, so that anything below which
  // happens to fetch one finds it already described rather than replacing it.
  registerScreens();

  // A Shortcut may have opened GabikOS carrying today's steps and sleep in
  // the address. Take them in before the first render so the numbers are
  // already there, and before the router reads a hash that still has them.
  // Reading it needs the Health module, so look for one cheaply first —
  // an ordinary boot must not pay for a link that is not there.
  const healthLink = hasHealthLink() ? await run('health', 'consumeHealthLink') : null;

  linkKnownHabits();   // joins "Drink water" to the Water tile, once
  applyTheme();
  watchSystemTheme();
  registerCollections();
  buildCommands();

  const shell = qs('#shell');
  shell.dataset.collapsed = String(!!settings().sidebarCollapsed);

  // chrome events
  qs('#collapseBtn').addEventListener('click', toggleCollapse);
  qs('#menuBtn')?.addEventListener('click', openSidebar);
  qs('#scrim').addEventListener('click', closeSidebar);
  qs('#searchBtn').addEventListener('click', () => openPalette());
  qs('#quickAddBtn').addEventListener('click', quickCreate);
  qs('#themeBtn').addEventListener('click', () => {
    toggleTheme(); renderChrome();
    render();   // chart colours are written into the SVG, so they need repainting
  });
  qs('#profileChip').addEventListener('click', () => navigate('settings'));
  qs('#focusBtn').addEventListener('click', () => run('focus', 'openFocus'));

  // Signing in, signing out and syncing are offered on more than one screen,
  // so they are wired once here and fetch the account module on the tap.
  on(document, 'click', '[data-signin]', () => run('account', 'openAuth', 'in'));
  on(document, 'click', '[data-signout]', () => run('account', 'doSignOut'));
  on(document, 'click', '[data-project]', () => run('account', 'openProjectSetup'));
  on(document, 'click', '[data-sync-now]', () =>
    (syncNow() ? toast('Syncing…', 'info') : toast('Sync is not available here', 'warn')));
  qs('#modalClose').addEventListener('click', () => modal.close());
  qs('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal' && modal.closable) modal.close(); });
  on(qs('#sidebar'), 'click', '[data-nav]', (e, el) => {
    navigate(el.dataset.nav);
    if (window.innerWidth <= 1000) closeSidebar();
  });

  initPalette();
  initKeys();

  qs('#syncChip')?.addEventListener('click', () => navigate('settings', { tab: 'data' }));
  on(qs('#tabbar'), 'click', '[data-nav]', (e, el) => navigate(el.dataset.nav));
  qs('#tabbar').addEventListener('click', e => { if (e.target.closest('#tabMore')) openSidebar(); });

  // the timetable lays out differently on a phone, so re-render when the
  // breakpoint is actually crossed (not on every pixel of a resize)
  const phone = window.matchMedia('(max-width: 720px)');
  phone.addEventListener('change', () => render());
  onSyncChange(() => { paintSync(); if (currentView() === 'settings') render(); });
  initSync();                                   // resolves on its own; never blocks first paint
  // A token expiring elsewhere must not look like a bug — but there is
  // nothing to watch, and no account module to fetch, until there is a session.
  if (canUseSupabase() && (hasStoredSession() || hasSessionInUrl())) run('account', 'watchAuth');
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);

  // The same link, arriving while GabikOS is already open on the phone.
  addEventListener('hashchange', async () => {
    if (!hasHealthLink()) return;
    const res = await run('health', 'consumeHealthLink');
    if (!res) return;
    if (res.days) render();
    if (res.message) toast(res.message, res.tone || 'ok', { duration: 5000 });
  });

  // And the readings the phone posted to the account on its own.
  const pullHealth = throttle(() => {
    if (settings().health?.linked) run('health', 'syncAppleHealth', { quiet: true });
  }, 60_000);
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullHealth(); });
  setTimeout(pullHealth, 2500);

  // keep nav badges + chrome in sync with state
  const syncChrome = debounce(() => { renderNav(); renderChrome(); renderTabs(); }, 80);
  store.subscribe(syncChrome);
  document.addEventListener('gabikos:chrome', () => { renderNav(); renderChrome(); renderTabs(); });
  onRender(() => { renderNav(); renderChrome(); renderTabs(); });

  window.addEventListener('gabikos:save-error', () => {
    toast('Storage is full — export a backup and clear some old data', 'bad', { duration: 9000 });
  });

  startRouter();
  renderNav();
  renderChrome();
  renderTabs();

  // Reveal as soon as the first view is on screen. This used to wait a
  // flat 620ms for the splash animation, which was most of the time to
  // usable on a phone — the DOM is ready in about a third of that.
  const bootEl = qs('#boot');
  shell.hidden = false;
  await new Promise(r => requestAnimationFrame(r));
  bootEl.classList.add('boot--out');
  setTimeout(() => bootEl.remove(), 240);

  // A Shortcut that opened GabikOS deserves an answer, whether or not it worked.
  if (healthLink?.message) {
    setTimeout(() => toast(healthLink.message, healthLink.tone || 'ok', { duration: 5000 }), 400);
  }

  registerWorker();

  if (!profile().onboarded) {
    await onboard();
    registerCollections();
    render();
    renderNav();
    renderChrome();
    const touch = matchMedia('(pointer: coarse)').matches;
    toast(touch ? 'Tap the bar at the bottom to move around — “More” has everything else'
                : 'Press Ctrl + K any time to get anywhere fast',
      'info', { duration: 6000 });
  }
}

/* ─── Offline ─────────────────────────────────────────────────
   Registered after the first screen is drawn, so installing it never
   competes with drawing. The build stamp is in the address, which is
   what makes a new build a new worker. */
function registerWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const go = () => navigator.serviceWorker
    .register(new URL(`sw.js?v=${encodeURIComponent(BUILD)}`, document.baseURI))
    .then(() => navigator.serviceWorker.ready)
    .then(reg => {
      const urls = performance.getEntriesByType('resource')
        .map(r => r.name)
        .filter(u => u.startsWith(location.origin) && /\.(js|css|woff2)(\?|$)/.test(u));
      (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'cache-these', urls });
    })
    .catch(err => console.warn('[GabikOS] offline support unavailable:', err.message));
  // Boot can finish either side of the load event, so cover both.
  if (document.readyState === 'complete') setTimeout(go, 0);
  else addEventListener('load', go, { once: true });
}

boot().catch(err => {
  console.error('[GabikOS] boot failed:', err);
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:100vh;font-family:system-ui;
    text-align:center;padding:24px;color:#e9ebf2;background:#08090d">
    <div><h1 style="font-size:1.25rem;margin-bottom:8px">GabikOS could not start</h1>
    <p style="color:#a2a9bb;font-size:0.875rem;max-width:420px">${String(err.message || err)}</p>
    <button onclick="location.reload()" style="margin-top:16px;padding:10px 18px;border-radius:10px;
      background:#7c5cff;color:#fff;border:0;font-size:0.875rem;cursor:pointer">Reload</button></div></div>`;
});
