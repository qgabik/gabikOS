/* ═══════════════════════════════════════════════════════════════
   GabikOS — Supabase cloud sync
   LocalStorage remains the offline/local cache.
   ═══════════════════════════════════════════════════════════════ */

import { store, S } from './store.js';
import { render } from './router.js';
import { getSupabase, getSession } from './supabase.js';

export const sync = {
  status: 'starting',
  detail: '',
  lastPull: 0,
  lastPush: 0,
  enabled: false,
  user: null,
  _applying: false,
  _timer: null,
  _channel: null,
  _unsubscribeStore: null,
};

const listeners = new Set();

export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setStatus(status, detail = '') {
  sync.status = status;
  sync.detail = detail;

  for (const fn of listeners) {
    try {
      fn(sync);
    } catch (err) {
      console.warn('[GabikOS] sync listener failed:', err);
    }
  }
}

/* ─── Helpers ─── */

function cloneState() {
  const state = JSON.parse(JSON.stringify(S()));

  // Local bookkeeping should never be uploaded.
  delete state.syncMeta;

  return state;
}

function hasUsefulLocalData() {
  const s = S();

  const arrays = [
    'projects',
    'tasks',
    'habits',
    'notes',
    'events',
    'goals',
    'subjects',
    'lessons',
    'journal',
    'workouts',
    'metrics',
    'meals',
    'transactions',
    'budgets',
    'media',
    'bookmarks',
    'focusSessions',
    'collections',
  ];

  return (
    s.profile?.onboarded ||
    arrays.some(key => Array.isArray(s[key]) && s[key].length > 0) ||
    Object.keys(s.habitLog || {}).length > 0 ||
    Object.keys(s.records || {}).length > 0
  );
}

function backupBeforeFirstCloudPull() {
  try {
    const backupKey = 'gabikos:v1:before-supabase';

    if (localStorage.getItem(backupKey)) return;

    const raw = localStorage.getItem('gabikos:v1');

    if (raw && raw.length > 2) {
      localStorage.setItem(backupKey, raw);
    }
  } catch (err) {
    console.warn('[GabikOS] could not create pre-sync backup:', err);
  }
}

function applyRemote(remoteData) {
  if (!remoteData || typeof remoteData !== 'object') return;

  backupBeforeFirstCloudPull();

  sync._applying = true;

  try {
    const migrated = store.migrate(remoteData);

    store.commit(
      state => {
        Object.assign(state, migrated);

        state.syncMeta ??= {
          slices: {},
          pulled: {},
          lastPull: 0,
        };

        state.syncMeta.lastPull = Date.now();
      },
      {
        fromRemote: true,
        silentHistory: true,
        key: 'cloud',
      }
    );
  } finally {
    sync._applying = false;
  }

  sync.lastPull = Date.now();

  // Custom Builder modules may have changed.
  import('../apps/builder.js')
    .then(module => module.registerCollections?.())
    .catch(() => {})
    .finally(() => {
      render();
      document.dispatchEvent(new CustomEvent('gabikos:chrome'));
    });
}

/* ─── Cloud read ─── */

async function readCloud() {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from('gabikos_data')
    .select('data, updated_at')
    .eq('user_id', sync.user.id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

/* ─── Cloud write ─── */

async function pushCloud() {
  if (!sync.enabled || !sync.user || sync._applying) {
    return false;
  }

  clearTimeout(sync._timer);
  sync._timer = null;

  setStatus('syncing');

  try {
    const supabase = await getSupabase();

    const { error } = await supabase
      .from('gabikos_data')
      .upsert(
        {
          user_id: sync.user.id,
          data: cloneState(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id',
        }
      );

    if (error) throw error;

    sync.lastPush = Date.now();
    setStatus('synced');

    return true;
  } catch (err) {
    console.error('[GabikOS] cloud save failed:', err);

    setStatus(
      'error',
      err?.message || 'Could not save data to the cloud.'
    );

    return false;
  }
}

function schedulePush() {
  if (!sync.enabled || sync._applying) return;

  clearTimeout(sync._timer);

  sync._timer = setTimeout(() => {
    pushCloud();
  }, 900);
}

/* ─── Realtime ─── */

async function startRealtime() {
  const supabase = await getSupabase();

  if (sync._channel) {
    await supabase.removeChannel(sync._channel);
  }

  sync._channel = supabase
    .channel(`gabikos-${sync.user.id}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'gabikos_data',
        filter: `user_id=eq.${sync.user.id}`,
      },
      payload => {
        const remote = payload.new;

        if (!remote?.data) return;

        /*
         * Ignore our own realtime echo when the cloud row is not newer
         * than our latest successful push.
         */
        const remoteTime = Date.parse(remote.updated_at || '') || 0;

        if (
          sync.lastPush &&
          Math.abs(remoteTime - sync.lastPush) < 2000
        ) {
          return;
        }

        applyRemote(remote.data);
        setStatus('synced', 'Updated from another device');
      }
    )
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('[GabikOS] realtime channel error');
      }
    });
}

/* ─── Store listener ─── */

function startStoreListener() {
  if (sync._unsubscribeStore) return;

  sync._unsubscribeStore = store.subscribe((_state, meta) => {
    if (!sync.enabled || sync._applying) return;

    if (meta?.fromRemote) return;
    if (meta?.key === 'syncMeta') return;
    if (meta?.seed) return;

    schedulePush();
  });
}

/* ─── Boot ─── */

export async function initSync() {
  setStatus('connecting');

  try {
    const session = await getSession();

    if (!session?.user) {
      sync.enabled = false;
      sync.user = null;

      setStatus('local', 'Sign in to enable cloud sync');
      return;
    }

    sync.user = session.user;
    sync.enabled = true;

    const cloud = await readCloud();

    if (cloud?.data && Object.keys(cloud.data).length > 0) {
      /*
       * Existing cloud data wins when a device joins the account.
       * A backup of this device is made before replacing anything.
       */
      applyRemote(cloud.data);
    } else if (hasUsefulLocalData()) {
      /*
       * First device/account login:
       * upload existing GabikOS local data.
       */
      await pushCloud();
    } else {
      /*
       * Even a blank state gets a cloud row so the account is initialized.
       */
      await pushCloud();
    }

    startStoreListener();
    await startRealtime();

    setStatus('synced');
  } catch (err) {
    console.error('[GabikOS] Supabase sync initialization failed:', err);

    sync.enabled = false;

    setStatus(
      'error',
      err?.message || 'Cloud sync is unavailable.'
    );
  }
}

/* ─── Public controls ─── */

export async function flush() {
  return pushCloud();
}

export async function syncNow() {
  return pushCloud();
}

export async function stopSync() {
  clearTimeout(sync._timer);
  sync._timer = null;

  if (sync._unsubscribeStore) {
    sync._unsubscribeStore();
    sync._unsubscribeStore = null;
  }

  if (sync._channel) {
    try {
      const supabase = await getSupabase();
      await supabase.removeChannel(sync._channel);
    } catch (err) {
      console.warn('[GabikOS] could not close realtime channel:', err);
    }
  }

  sync._channel = null;
  sync.enabled = false;
  sync.user = null;

  setStatus('local');
}

/* ─── UI status ─── */

export function syncLabel() {
  switch (sync.status) {
    case 'synced':
      return {
        text: 'Synced',
        tone: 'ok',
        icon: 'cloud',
      };

    case 'syncing':
      return {
        text: 'Saving…',
        tone: 'info',
        icon: 'refresh',
      };

    case 'connecting':
      return {
        text: 'Connecting…',
        tone: '',
        icon: 'cloud',
      };

    case 'error':
      return {
        text: 'Sync problem',
        tone: 'bad',
        icon: 'alert',
      };

    default:
      return {
        text: 'This device only',
        tone: '',
        icon: 'lock',
      };
  }
}
