/* ═══════════════════════════════════════════════════════════════
   GabikOS — cloud sync

   Two backends behind one interface:
     · Supabase — your account, any host, the normal case
     · Claude db — the claude.ai copy, which cannot reach Supabase
   Neither available (a plain static host, signed out) → localStorage
   only, and the app says so.

   State is sharded into domain slices, one row each, because a row is
   capped and writes are last-writer-wins: separate slices mean a task
   edited on a phone cannot clobber a note typed on a desktop.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, blankState } from './store.js';
import { render } from './router.js';
import { getSupabase, getSession, canUseSupabase, hasStoredSession, hasSessionInUrl } from './supabase.js';

export const SLICES = {
  core:    ['profile', 'settings', 'activity'],
  tasks:   ['projects', 'tasks'],
  habits:  ['habits', 'habitLog'],
  notes:   ['notes'],
  journal: ['journal'],
  plan:    ['events', 'goals'],
  school:  ['subjects', 'lessons'],
  health:  ['workouts', 'metrics', 'meals'],
  money:   ['transactions', 'budgets'],
  custom:  ['collections', 'records'],
  library: ['media', 'bookmarks', 'focusSessions'],
};
const SLICE_NAMES = Object.keys(SLICES);
const sliceOfKey = key => SLICE_NAMES.find(s => SLICES[s].includes(key));
const MAX_BODY = 240_000;
export const TABLE = 'gabikos_state';

export const sync = {
  status: 'starting',    // starting | local | connecting | synced | syncing | error
  detail: '',
  backend: null,         // 'supabase' | 'claude' | null
  user: null,            // { id, email } when signed in
  enabled: false,
  lastPull: 0,
  lastPush: 0,
  _p: null,              // the active provider
  _dirty: new Set(),
  _chain: new Map(),
  _timer: null,
  _applying: false,
  _poll: null,
};

const listeners = new Set();
export function onSyncChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function setStatus(status, detail = '') {
  sync.status = status; sync.detail = detail;
  for (const fn of listeners) { try { fn(sync); } catch (e) { console.warn('[GabikOS] sync listener:', e); } }
}

const deviceName = () => {
  const ua = navigator.userAgent;
  if (/iPhone|Android.*Mobile/i.test(ua)) return 'Phone';
  if (/iPad|Tablet|Android/i.test(ua)) return 'Tablet';
  return 'Computer';
};

/* ─── local bookkeeping ─── */
const meta = () => (S().syncMeta ??= { slices: {}, pulled: {}, lastPull: 0 });
const localStamp = slice => Math.max(0, ...SLICES[slice].map(k => meta().slices?.[k] || 0));
const hasPulled = slice => !!meta().pulled?.[slice];
const hasContent = slice =>
  SLICES[slice].some(k => { const v = S()[k]; return Array.isArray(v) ? v.length : v && Object.keys(v).length; });

function stampLocal(slice, ts, pulled = true) {
  store.commit(s => {
    s.syncMeta ??= { slices: {}, pulled: {}, lastPull: 0 };
    s.syncMeta.pulled ??= {};
    for (const k of SLICES[slice]) s.syncMeta.slices[k] = ts;
    if (pulled) s.syncMeta.pulled[slice] = true;
  }, { fromRemote: true, silentHistory: true, key: 'syncMeta' });
}

let backedUp = false;
function backupLocal(tag = 'before-sync') {
  if (backedUp) return;
  backedUp = true;
  try {
    const raw = localStorage.getItem('gabikos:v1');
    if (raw && raw.length > 2) localStorage.setItem(`gabikos:v1:${tag}`, raw);
  } catch { /* storage may refuse; the pull is still correct */ }
}

/* ═══ Providers ═══════════════════════════════════════════════ */

/** The claude.ai copy: a private per-viewer document store. */
async function claudeProvider() {
  if (typeof window === 'undefined' || !window.claude?.use) return null;
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  if (!db || !user) return null;
  const uid = await user.id();
  if (!uid) return null;
  const base = db.collection(`data/users/${uid}`);
  return {
    name: 'claude',
    user: { id: uid, email: '' },
    async read(slice) {
      const snap = await base.doc(slice).get();
      return snap.exists ? snap.data() : null;
    },
    async write(slice, body) { await base.doc(slice).set(body); },
    watch(slice, cb) {
      return base.doc(slice).onSnapshot(
        snap => cb(snap.exists ? snap.data() : null),
        err => { if (['revoked', 'not_granted'].includes(err.code)) shutDown(); },
      );
    },
  };
}

/** Supabase: the user's own account, reachable from any host. */
async function supabaseProvider() {
  if (!canUseSupabase()) return null;
  // Signed out, and no session coming back in a link: there is nothing for
  // the library to do, so it is never fetched.
  if (!hasStoredSession() && !hasSessionInUrl()) return null;
  const session = await getSession().catch(() => null);
  if (!session?.user) return null;
  const supabase = await getSupabase();
  const uid = session.user.id;

  const rowToBody = row => row ? {
    updatedAt: Date.parse(row.updated_at) || 0,
    device: row.device || '',
    payload: row.payload || {},
  } : null;

  return {
    name: 'supabase',
    user: { id: uid, email: session.user.email || '' },
    async read(slice) {
      const { data, error } = await supabase.from(TABLE)
        .select('payload, updated_at, device')
        .eq('user_id', uid).eq('slice', slice).maybeSingle();
      if (error) throw error;
      return rowToBody(data);
    },
    async write(slice, body) {
      const { error } = await supabase.from(TABLE).upsert({
        user_id: uid, slice,
        payload: body.payload,
        device: body.device,
        updated_at: new Date(body.updatedAt).toISOString(),
      }, { onConflict: 'user_id,slice' });
      if (error) throw error;
    },
    watch(slice, cb) {
      const channel = supabase.channel(`gabikos:${uid}:${slice}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: TABLE,
          filter: `user_id=eq.${uid}`,
        }, ({ new: row }) => { if (row?.slice === slice) cb(rowToBody(row)); })
        .subscribe();
      return () => { try { supabase.removeChannel(channel); } catch { /* already gone */ } };
    },
  };
}

/* ═══ Pull ════════════════════════════════════════════════════ */

function considerRemote(slice, body) {
  if (!body) {
    // nothing stored yet — seed it from here if this device has anything
    if (hasContent(slice)) { sync._dirty.add(slice); schedulePush(); }
    else stampLocal(slice, 0);      // an empty account is still "in step"
    return;
  }
  const remoteAt = Number(body.updatedAt) || 0;

  // A device that has never synced cannot hold the newer truth, whatever its
  // clock says — a fresh install stamps its starter content with "now", which
  // would otherwise out-rank the real data and then overwrite it.
  if (!hasPulled(slice)) { backupLocal(); applyRemote(slice, body, remoteAt || Date.now()); return; }
  if (!remoteAt || remoteAt <= localStamp(slice)) return;
  applyRemote(slice, body, remoteAt);
}

function applyRemote(slice, body, remoteAt) {
  const payload = body.payload || {};
  sync._applying = true;
  try {
    store.commit(s => {
      for (const k of SLICES[slice]) if (k in payload) s[k] = payload[k];
      s.syncMeta ??= { slices: {}, pulled: {}, lastPull: 0 };
      s.syncMeta.pulled ??= {};
      for (const k of SLICES[slice]) s.syncMeta.slices[k] = remoteAt;
      s.syncMeta.pulled[slice] = true;
      s.syncMeta.lastPull = Date.now();
    }, { fromRemote: true, silentHistory: true, key: slice });
  } finally { sync._applying = false; }

  sync.lastPull = Date.now();
  sync._dirty.delete(slice);
  setStatus('synced', body.device ? `updated from ${body.device}` : '');
  import('../apps/builder.js').then(m => m.registerCollections?.()).catch(() => {}).finally(() => {
    render();
    document.dispatchEvent(new CustomEvent('gabikos:chrome'));
  });
}

/* ═══ Push ════════════════════════════════════════════════════ */

function schedulePush() {
  clearTimeout(sync._timer);
  sync._timer = setTimeout(flush, 1100);       // one write per pause, not per keystroke
}

export function flush() {
  if (!sync.enabled || !sync._dirty.size) return Promise.resolve();
  const slices = [...sync._dirty];
  sync._dirty.clear();
  setStatus('syncing');
  return Promise.all(slices.map(pushSlice)).then(() => {
    sync.lastPush = Date.now();
    if (sync.status === 'syncing') setStatus('synced');
  });
}

function pushSlice(slice) {
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

  if (new Blob([JSON.stringify(body)]).size > MAX_BODY) {
    setStatus('error', `“${slice}” is too large to sync. Export a backup and trim it.`);
    return;
  }
  try {
    await sync._p.write(slice, body);
    stampLocal(slice, at);
  } catch (err) {
    const code = err?.code || '';
    if (['revoked', 'not_granted'].includes(code)) { shutDown(); return; }
    // one retry for a transient failure, then report it
    await new Promise(r => setTimeout(r, 700 + Math.random() * 800));
    try { await sync._p.write(slice, body); stampLocal(slice, at); }
    catch (e2) { setStatus('error', e2?.message || 'Could not save to the cloud'); }
  }
}

/* ═══ Lifecycle ═══════════════════════════════════════════════ */

let unwatchers = [];
let storeUnsub = null;

let initing = null;

/**
 * Signing in starts sync twice — once from the sign-in form, once from the
 * auth listener that sees the same event. Both used to run at once, and the
 * second one asked Supabase for realtime channels the first had already
 * subscribed, which throws instead of syncing. Queue them instead: the
 * second run then tears the first one's watchers down before making its own.
 */
export function initSync() {
  initing = (initing || Promise.resolve()).catch(() => {}).then(runInit);
  return initing;
}

async function runInit() {
  shutDown(true);
  setStatus('connecting');
  try {
    // the artifact copy cannot reach Supabase, so try its own store first
    const provider = (await claudeProvider()) || (await supabaseProvider());
    if (!provider) {
      setStatus('local', canUseSupabase() ? 'Sign in to sync across your devices' : '');
      return;
    }

    // A different account on this device must not inherit the last one's data —
    // neither on screen, nor pushed up into the new account.
    if (meta().userId && meta().userId !== provider.user.id) {
      backupLocal('before-account-switch');
      const fresh = blankState();
      store.commit(s => {
        for (const slice of SLICE_NAMES) for (const k of SLICES[slice]) s[k] = fresh[k];
        s.profile = { ...fresh.profile, onboarded: true };   // they just signed in; do not ask again
        s.syncMeta = { slices: {}, pulled: {}, lastPull: 0, userId: provider.user.id };
      }, { fromRemote: true, silentHistory: true, key: 'syncMeta' });
    }
    store.commit(s => { s.syncMeta ??= {}; s.syncMeta.userId = provider.user.id; },
      { fromRemote: true, silentHistory: true, key: 'syncMeta' });

    sync._p = provider;
    sync.backend = provider.name;
    sync.user = provider.user;
    sync.enabled = true;

    for (const slice of SLICE_NAMES) {
      const un = provider.watch(slice, body => { if (!sync._applying) considerRemote(slice, body); });
      if (typeof un === 'function') unwatchers.push(un);
      // a watch may only report changes, so read the current value once
      provider.read(slice).then(body => considerRemote(slice, body)).catch(() => {});
    }

    storeUnsub = store.subscribe((_s, m) => {
      if (sync._applying || !sync.enabled) return;
      if (m?.fromRemote || m?.seed || m?.key === 'syncMeta') return;
      const slice = m?.key ? sliceOfKey(m.key) : null;
      if (slice) sync._dirty.add(slice); else SLICE_NAMES.forEach(k => sync._dirty.add(k));
      schedulePush();
    });

    // realtime can drop silently; a slow poll makes sure a change still lands
    clearInterval(sync._poll);
    sync._poll = setInterval(() => {
      if (document.visibilityState !== 'visible' || !sync.enabled) return;
      for (const slice of SLICE_NAMES) provider.read(slice).then(b => considerRemote(slice, b)).catch(() => {});
    }, 45000);

    setStatus('synced');
  } catch (err) {
    console.error('[GabikOS] sync unavailable:', err);
    setStatus('error', err?.message || 'Cloud sync is unavailable');
  }
}

function shutDown(quiet = false) {
  clearTimeout(sync._timer); clearInterval(sync._poll);
  unwatchers.forEach(u => { try { u(); } catch { /* already gone */ } });
  unwatchers = [];
  storeUnsub?.(); storeUnsub = null;
  sync._p = null; sync.enabled = false; sync.backend = null; sync.user = null;
  sync._dirty.clear();
  if (!quiet) setStatus('local');
}

export function stopSync() { shutDown(); }

/**
 * Sign-out: stop syncing and drop what was pulled, but REMEMBER which
 * account this device last held. Forgetting it would leave the next person
 * to sign in inheriting this data — and pushing it into their account.
 */
export function forgetAccount() {
  shutDown();
  store.commit(s => {
    const last = s.syncMeta?.userId;
    s.syncMeta = { slices: {}, pulled: {}, lastPull: 0, userId: last };
  }, { fromRemote: true, silentHistory: true, key: 'syncMeta' });
  backedUp = false;
}

export function syncNow() {
  if (!sync.enabled) return false;
  SLICE_NAMES.forEach(k => sync._dirty.add(k));
  flush();
  for (const slice of SLICE_NAMES) sync._p.read(slice).then(b => considerRemote(slice, b)).catch(() => {});
  return true;
}

export function syncLabel() {
  switch (sync.status) {
    case 'synced':     return { text: 'Synced', tone: 'ok', icon: 'cloud' };
    case 'syncing':    return { text: 'Saving…', tone: 'info', icon: 'refresh' };
    case 'connecting': return { text: 'Connecting…', tone: '', icon: 'cloud' };
    case 'error':      return { text: 'Sync problem', tone: 'bad', icon: 'alert' };
    default:           return { text: canUseSupabase() ? 'Sign in to sync' : 'This device only', tone: '', icon: 'lock' };
  }
}
