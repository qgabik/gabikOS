/* ═══════════════════════════════════════════════════════════════
   GabikOS — Supabase client + authentication
   ═══════════════════════════════════════════════════════════════ */

const SUPABASE_URL = 'https://meuwvywebbvwaprumshm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_2aV_Wlxg-Rvj7t1zAfgX8w_dP906uxo';

let clientPromise = null;

/**
 * Load Supabase JS only when it is needed.
 * GabikOS has no build step, so the official client is loaded as an ESM module.
 */
export function getSupabase() {
  if (!clientPromise) {
    clientPromise = import(
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'
    ).then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    );
  }

  return clientPromise;
}

/* ─── Session ─── */

export async function getSession() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();

  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;
  return data.user;
}

/* ─── Authentication ─── */

export async function signUp(email, password) {
  const supabase = await getSupabase();

  return supabase.auth.signUp({
    email,
    password,
  });
}

export async function signIn(email, password) {
  const supabase = await getSupabase();

  return supabase.auth.signInWithPassword({
    email,
    password,
  });
}

export async function signOut() {
  const supabase = await getSupabase();
  return supabase.auth.signOut();
}

/* ─── Auth listener ─── */

export async function onAuthChange(callback) {
  const supabase = await getSupabase();

  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
