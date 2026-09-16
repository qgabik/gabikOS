/* ═══════════════════════════════════════════════════════════════
   GabikOS — cross-device sync

   When the page runs somewhere that can identify you (the claude.ai
   host), your data lives in a private per-viewer document store and
   follows you between phone and desktop. Everywhere else this module
   does nothing at all and localStorage remains the whole story.

   State is sharded into domain slices, one document each, because:
     · a document is capped at 256 KiB — one blob would eventually fail
     · writes are last-writer-wins, so smaller slices collide less
       (a task edited on the phone cannot clobber a note typed on the PC)
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from './store.js';
import { render } from './router.js';

/** Which top-level state keys travel together in one document. */
export const SLICES = {
  core:    ['profile', 'settings', 'activity'],
  tasks:   ['projects', 'tasks'],
  habits:  ['habits', 'habitLog'],
  notes:   ['notes'],
  journal: ['journal'],
  plan:    ['events', 'goals'],
  health:  ['workouts', 'metrics', 'meals'],
  money:   ['transactions', 'budgets'],
  custom:  ['collections', 'records'],
  library: ['media', 'bookmarks', 'focusSessions'],
};
const sliceOfKey = key => Object.keys(SLICES).find(s => SLICES[s].includes(key));

/* a document body must stay under 256 KiB; leave room for overhead */
const MAX_BODY = 240_000;

export const sync = {
  status: 'starting',   // starting | local | connecting | synced | syncing | error
  detail: '',
  lastPull: 0,
  lastPush: 0,
  enabled: false,
  _db: null, _base: null, _uid: null,
  _unsubs: [],
  _applying: false,
  _dirty: new Set(),
  _chain: new Map(),    // slice -> promise, so writes to one doc are serial
  _timer: null,
};

const listeners = new Set();
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(status, detail = '') {
  sync.status = status;
  sync.detail = detail;
  for (const fn of listeners) fn(sync);
}

const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone|Android.*Mobile/i.test(ua)) return 'Phone';
  if (/iPad|Tablet|Android/i.test(ua)) return 'Tablet';
  return 'Computer';
};

/** Local timestamp for a slice — the newest of its keys. */
function localStamp(slice) {
  const marks = S().syncMeta?.slices || {};
  return Math.max(0, ...SLICES[slice].map(k => marks[k] || 0));
}
function stampLocal(slice, ts) {
  store.commit(s => {
    s.syncMeta ??= { slices: {}, lastPull: 0 };
    for (const k of SLICES[slice]) s.syncMeta.slices[k] = ts;
  }, { fromRemote: true, silentHistory: true, key: 'syncMeta' });
}
const hasContent = slice =>
  SLICES[slice].some(k => { const v = S()[k]; return Array.isArray(v) ? v.length : v && Object.keys(v).length; });

/* ─── Boot ─── */
export async function initSync() {
  if (typeof window === 'undefined' || !window.claude?.use) { setStatus('local'); return; }
  setStatus('connecting');
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) { setStatus('local'); return; }

    const uid = await user.id();
    if (!uid) { setStatus('local'); return; }   // no private subtree for this viewer

    sync._db = db;
    sync._uid = uid;
    sync._base = db.collection(`data/users/${uid}`);
    sync.enabled = true;

    for (const slice of Object.keys(SLICES)) subscribeSlice(slice);

    store.subscribe((_s, meta) => {
      if (sync._applying || !sync.enabled) return;
      if (meta?.fromRemote || meta?.key === 'syncMeta') return;
      const slice = meta?.key ? sliceOfKey(meta.key) : null;
      if (slice) sync._dirty.add(slice);
      else for (const k of Object.keys(SLICES)) sync._dirty.add(k);  // import/reset/seed
      schedulePush();
    });

    setStatus('synced');
  } catch (err) {
    console.warn('[GabikOS] sync unavailable:', err);
    setStatus('local');
  }
}

/* ─── Pull ─── */
function subscribeSlice(slice) {
  const unsub = sync._base.doc(slice).onSnapshot(
    snap => {
      if (!snap.exists) {
        // nothing stored yet — seed it from this device if we have anything
        if (hasContent(slice)) { sync._dirty.add(slice); schedulePush(); }
        return;
      }
      const body = snap.data();
      const remoteAt = Number(body?.updatedAt) || 0;
      if (!remoteAt || remoteAt <= localStamp(slice)) return;  // ours is newer or equal
      applyRemote(slice, body, remoteAt);
    },
    err => {
      if (err.code === 'revoked' || err.code === 'not_granted') { sync.enabled = false; setStatus('local'); }
      else setStatus('error', err.message || err.code);
    },
  );
  sync._unsubs.push(unsub);
}

function applyRemote(slice, body, remoteAt) {
  const payload = body.payload || {};
  sync._applying = true;
  try {
    store.commit(s => {
      for (const k of SLICES[slice]) if (k in payload) s[k] = payload[k];
      s.syncMeta ??= { slices: {}, lastPull: 0 };
      for (const k of SLICES[slice]) s.syncMeta.slices[k] = remoteAt;
      s.syncMeta.lastPull = Date.now();
    }, { fromRemote: true, silentHistory: true, key: slice });
  } finally {
    sync._applying = false;
  }
  sync.lastPull = Date.now();
  sync._dirty.delete(slice);
  setStatus('synced', `updated from ${body.device || 'another device'}`);
  // custom trackers may have arrived — rebuild their views, then repaint
  import('../apps/builder.js').then(m => m.registerCollections()).finally(() => {
    render();
    document.dispatchEvent(new CustomEvent('gabikos:chrome'));
  });
}

/* ─── Push ─── */
function schedulePush() {
  clearTimeout(sync._timer);
  sync._timer = setTimeout(flush, 1200);   // coalesce a burst of edits into one write
}

export function flush() {
  if (!sync.enabled || !sync._dirty.size) return;
  const slices = [...sync._dirty];
  sync._dirty.clear();
  setStatus('syncing');
  Promise.all(slices.map(pushSlice)).then(() => {
    sync.lastPush = Date.now();
    if (sync.status === 'syncing') setStatus('synced');
  });
}

function pushSlice(slice) {
  // one write at a time per document
  const prev = sync._chain.get(slice) || Promise.resolve();
  const next = prev.then(() => writeSlice(slice)).catch(() => {});
  sync._chain.set(slice, next);
  return next;
}

async function writeSlice(slice) {
  const payload = {};
  for (const k of SLICES[slice]) payload[k] = S()[k];
  const at = Date.now();
  const body = { updatedAt: at, device: deviceName(), payload };

  const size = new Blob([JSON.stringify(body)]).size;
  if (size > MAX_BODY) {
    setStatus('error', `“${slice}” is ${Math.round(size / 1024)} KB — too large to sync. Export a backup and trim it.`);
    return;
  }
  try {
    await sync._base.doc(slice).set(body);
    stampLocal(slice, at);
  } catch (err) {
    if (err?.code === 'revoked' || err?.code === 'not_granted') { sync.enabled = false; setStatus('local'); return; }
    if (err?.code === 'unavailable') {                       // transient — one retry
      await new Promise(r => setTimeout(r, 600 + Math.random() * 900));
      try { await sync._base.doc(slice).set(body); stampLocal(slice, at); return; } catch { /* fall through */ }
    }
    setStatus('error', err?.message || err?.code || 'could not save to the cloud');
  }
}

/** Push everything now, regardless of what changed. */
export function syncNow() {
  if (!sync.enabled) return false;
  for (const k of Object.keys(SLICES)) sync._dirty.add(k);
  flush();
  return true;
}

export function stopSync() {
  sync._unsubs.forEach(u => { try { u(); } catch { /* already gone */ } });
  sync._unsubs = [];
  sync.enabled = false;
  setStatus('local');
}

/** Human-readable state for the UI. */
export function syncLabel() {
  switch (sync.status) {
    case 'synced':     return { text: 'Synced', tone: 'ok', icon: 'cloud' };
    case 'syncing':    return { text: 'Saving…', tone: 'info', icon: 'refresh' };
    case 'connecting': return { text: 'Connecting…', tone: '', icon: 'cloud' };
    case 'error':      return { text: 'Sync problem', tone: 'bad', icon: 'alert' };
    default:           return { text: 'This device only', tone: '', icon: 'lock' };
  }
}
