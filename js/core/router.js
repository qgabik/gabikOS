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
  views.set(id, { id, group: 'Workspace', order: 50, ...def });
}
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
export function render() {
  const { id, params: p } = parseHash();
  const view = views.get(id) || views.get('dashboard');
  const host = document.getElementById('view');
  if (!view || !host) return;

  if (rendering) return;
  rendering = true;
  current = view.id;
  currentParams = p;

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
