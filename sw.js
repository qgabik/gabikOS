/* ═══════════════════════════════════════════════════════════════
   GabikOS — service worker

   What this is for: opening GabikOS from the home screen on a phone
   with no signal, and having it start anyway. Everything it holds is
   already on the device; there was no reason for the app itself to
   need the network to appear.

   What it deliberately does NOT do: serve yesterday's code. This app
   has been frozen on an old build before, and a cache-first worker is
   the most reliable way to do it again. So every request for code goes
   to the network first and only falls back to the cache when the
   network does not answer. Online you always run the newest build;
   offline you run the last one that reached you.

   Fonts and icons are the exception — they never change under the same
   name, so they come from the cache and are refreshed in the background.
   ═══════════════════════════════════════════════════════════════ */

/* The registration carries the build, so a new build is a new worker. */
const BUILD = new URL(location.href).searchParams.get('v') || 'dev';
const CACHE = `gabikos-${BUILD}`;
const NET_TIMEOUT = 4000;

const SCOPE = new URL('./', location.href);
const at = path => new URL(path, SCOPE).href;

/* Enough to draw the first screen with no network at all. Everything else
   is cached as you visit it. */
const BOOT = [
  './', 'index.html', 'manifest.webmanifest',
  'styles/base.css', 'styles/shell.css', 'styles/components.css', 'styles/apps.css',
  'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2',
  'js/main.js', 'js/config.js',
  'js/core/store.js', 'js/core/util.js', 'js/core/router.js', 'js/core/icons.js',
  'js/core/theme.js', 'js/core/ui.js', 'js/core/data.js', 'js/core/views.js',
  'js/core/rows.js', 'js/core/charts.js', 'js/core/palette.js', 'js/core/markdown.js',
  'js/core/sync.js', 'js/core/supabase.js', 'js/apps/dashboard.js',
].map(at);

/* A hand-written list of modules goes stale the moment an import moves, and a
   list that has gone stale means an app that will not open offline. So once
   the first screen is on, the page reports what it actually loaded and that
   is what gets kept. */
self.addEventListener('message', e => {
  if (e.data?.type !== 'cache-these' || !Array.isArray(e.data.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const have = new Set((await cache.keys()).map(r => r.url));
    const want = e.data.urls
      .filter(u => { try { return new URL(u).origin === location.origin; } catch { return false; } })
      .filter(u => !have.has(u));
    await Promise.all(want.map(u => cache.add(new Request(u, { cache: 'no-cache' })).catch(() => {})));
  })());
});

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One missing file must not fail the whole install.
    await Promise.all(BOOT.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gabikos-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isCode = url => /\.(js|css|html)$/.test(url.pathname) || url.pathname.endsWith('/');
const isAsset = url => /\.(woff2?|png|svg|ico|webmanifest)$/.test(url.pathname);

/** Network, but not forever — a phone on one bar should still open the app. */
function fromNetwork(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('slow')), ms);
    fetch(request).then(r => { clearTimeout(timer); resolve(r); }, err => { clearTimeout(timer); reject(err); });
  });
}

const put = (request, response) => {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then(c => c.put(request, copy)).catch(() => {});
  }
  return response;
};

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Someone else's server — the account, the health inbox — is never ours to cache.
  if (url.origin !== location.origin) return;
  if (request.headers.has('range')) return;

  // A navigation is a request for the app itself, wherever the address points.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try { return put(request, await fromNetwork(request, NET_TIMEOUT)); }
      catch { return (await caches.match(at('index.html'))) || (await caches.match(request)) || Response.error(); }
    })());
    return;
  }

  if (isAsset(url)) {
    e.respondWith((async () => {
      const hit = await caches.match(request);
      if (hit) { fetch(request).then(r => put(request, r)).catch(() => {}); return hit; }
      try { return put(request, await fetch(request)); } catch { return Response.error(); }
    })());
    return;
  }

  if (isCode(url)) {
    e.respondWith((async () => {
      try { return put(request, await fromNetwork(request, NET_TIMEOUT)); }
      catch {
        const hit = await caches.match(request);
        if (hit) return hit;
        // A screen you have never opened, asked for with no connection.
        return new Response('/* offline */', { status: 504, headers: { 'content-type': 'text/javascript' } });
      }
    })());
  }
});
