/* ═══════════════════════════════════════════════════════════════
   GabikOS — router: hash routing + view registry
   ═══════════════════════════════════════════════════════════════ */

const views = new Map();
let current = null;
let currentParams = {};
const afterRender = new Set();

/**
 * @param {string} id
 * @param {{title,icon,group,render,onMount,badge,hidden,order,desc,keywords}} def
 */
export function registerView(id, def) {
  const prev = views.get(id);
  views.set(id, { id, group: 'Workspace', order: 50, ...def });
  // A screen that has just arrived replaces its own placeholder, so draw it.
  if (prev?.lazy && current === id) render();
}

/**
 * Register a screen by its description alone, and fetch the code that draws
 * it the first time someone opens it.
 *
 * Everything the sidebar, the tab bar and the search need — name, icon,
 * group, badge — is in `meta`, so a screen can be listed, counted and found
 * without its module ever being downloaded. Thirteen of them used to arrive
 * on every boot to show one.
 */
export function registerLazy(id, meta, loader) {
  // A screen already here — boot may have fetched Health to read a Shortcut's
  // link — must not be demoted to a placeholder it can never come back from,
  // because its module is cached and will not register itself a second time.
  if (views.get(id) && !views.get(id).lazy) return;
  registerView(id, { ...meta, lazy: loader, render: () => SKELETON });
}

const SKELETON = `<div class="page-skeleton" aria-busy="true" aria-label="Loading">
  <div class="skeleton" style="height:34px;width:190px"></div>
  <div class="skeleton" style="height:15px;width:260px;margin-top:10px"></div>
  <div class="skeleton" style="height:120px;margin-top:22px"></div>
  <div class="skeleton" style="height:120px;margin-top:14px"></div>
</div>`;

const loading = new Set();
export const unregisterView = id => views.delete(id);
export const getView = id => views.get(id);
export const allViews = () => [...views.values()];
export const navViews = () => [...views.values()].filter(v => !v.hidden);
export const currentView = () => current;
export const params = () => currentParams;

/** Register a callback that runs after every render. */
export function onRender(fn) { afterRender.add(fn); return () => afterRender.delete(fn); }

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { id: 'dashboard', params: {} };
  const [path, query] = raw.split('?');
  const [id, ...rest] = path.split('/');
  const p = Object.fromEntries(new URLSearchParams(query || ''));
  if (rest.length) p.id = rest.join('/');
  return { id: id || 'dashboard', params: p };
}

let rendering = false;

/**
 * Moving between screens used to be a hard cut: the old markup vanished and
 * the new markup appeared in the same frame, which on a phone reads as a
 * flicker rather than a move. Where the browser can do it, the swap is
 * wrapped in a view transition and cross-fades instead.
 *
 * It is a wrapper, not a dependency: if the API is missing — or the reader
 * has asked for less motion — the same function runs unwrapped.
 */
const canTransition = () =>
  typeof document.startViewTransition === 'function' &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let drawn = false;
export function render() {
  // The first draw happens behind the boot screen, with nothing to move from.
  if (!drawn || !canTransition() || rendering) return draw();
  // A transition freezes the page until the callback returns, so it must only
  // ever wrap synchronous work — draw() is.
  document.startViewTransition(() => draw());
}

function draw() {
  drawn = true;
  const { id, params: p } = parseHash();
  const view = views.get(id) || views.get('dashboard');
  const host = document.getElementById('view');
  if (!view || !host) return;

  if (rendering) return;
  rendering = true;
  current = view.id;
  currentParams = p;

  // A screen still on its way draws a placeholder; registerView redraws it.
  if (view.lazy && !loading.has(view.id)) {
    loading.add(view.id);
    view.lazy()
      .catch(err => {
        console.error(`[GabikOS] could not load "${view.id}":`, err);
        views.set(view.id, { ...views.get(view.id), lazy: null, render: () => OFFLINE });
        render();
      })
      .finally(() => loading.delete(view.id));
  }

  try {
    const html = view.render(p) ?? '';
    host.innerHTML = `<div class="view__in">${html}</div>`;
    host.scrollTop = 0;
    document.title = view.title === 'Dashboard' ? 'GabikOS' : `${view.title} · GabikOS`;
    view.onMount?.(host.firstElementChild, p);
  } catch (err) {
    console.error(`[GabikOS] view "${view.id}" failed to render:`, err);
    host.innerHTML = `<div class="view__in"><div class="empty">
      <div class="empty__icon"><svg viewBox="0 0 24 24" class="ic"><path d="M12 8.5v5M12 17h.01" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M10.3 3.9 2.6 17.2a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/></svg></div>
      <h3>This screen hit an error</h3>
      <p>${String(err.message || err).replace(/[<>&]/g, '')}</p>
      <button class="btn mt-3" onclick="location.reload()">Reload GabikOS</button>
    </div></div>`;
  } finally {
    rendering = false;
  }
  for (const fn of afterRender) fn(view.id, p);
}

/** Re-render only if the given view is the one on screen. */
export function refreshIf(...ids) { if (ids.includes(current)) render(); }

export function navigate(id, p = {}) {
  const q = new URLSearchParams(p);
  const sub = p.id ? `/${p.id}` : '';
  q.delete('id');
  const qs = q.toString();
  const next = `#/${id}${sub}${qs ? '?' + qs : ''}`;
  if (location.hash === next) render();
  else location.hash = next;
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  render();
}

const OFFLINE = `<div class="empty">
  <div class="empty__icon"><svg viewBox="0 0 24 24" class="ic"><path d="M12 8.5v5M12 17h.01" stroke="currentColor"
    stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor"
    stroke-width="1.8" fill="none"/></svg></div>
  <h3>This screen could not be downloaded</h3>
  <p>You may be offline. Everything already on this device is safe — try again when you have a connection.</p>
  <button class="btn mt-3" onclick="location.reload()">Try again</button>
</div>`;
