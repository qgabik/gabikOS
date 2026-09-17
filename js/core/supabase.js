/* ═══════════════════════════════════════════════════════════════
   GabikOS — Supabase client and authentication

   The official client is loaded from a CDN on first use; GabikOS has no
   build step, so it arrives as an ES module rather than a bundle.
   ═══════════════════════════════════════════════════════════════ */
import { supabaseConfig, isConfigured } from '../config.js';

let sdkPromise = null;
let clientPromise = null;
let clientFor = '';

/**
 * The Supabase library, vendored rather than pulled from a CDN, and loaded
 * only when sync is actually wanted — it costs nothing on first paint.
 * The URL is resolved against this module so it survives being served from
 * a sub-path (a project page at /gabikOS/, say).
 */
function loadSdk() {
  if (window.supabase?.createClient) return Promise.resolve(window.supabase);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = new URL('../vendor/supabase.js', import.meta.url).href;
    el.async = true;
    el.onload = () => window.supabase?.createClient
      ? resolve(window.supabase)
      : reject(new Error('The Supabase library loaded but did not initialise.'));
    el.onerror = () => reject(new Error('Could not load the Supabase library.'));
    document.head.appendChild(el);
  });
  return sdkPromise;
}

/** The client for the configured project, created once. */
export function getSupabase() {
  const cfg = supabaseConfig();
  const fingerprint = cfg.url + '|' + cfg.key;
  if (clientPromise && clientFor === fingerprint) return clientPromise;

  clientFor = fingerprint;
  clientPromise = loadSdk().then(({ createClient }) => createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 2 } },
  }));
  return clientPromise;
}

/** Forget the cached client — after the project is pointed somewhere else. */
export function resetSupabase() { clientPromise = null; clientFor = ''; }

export const canUseSupabase = () => isConfigured();

/* ─── Session ─── */
export async function getSession() {
  if (!isConfigured()) return null;
  const supabase = await getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/* ─── Authentication ─── */
export async function signUp(email, password) {
  const supabase = await getSupabase();
  return supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname },
  });
}

export async function signIn(email, password) {
  const supabase = await getSupabase();
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  const supabase = await getSupabase();
  return supabase.auth.signOut();
}

export async function resetPassword(email) {
  const supabase = await getSupabase();
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
}

/* ─── Auth listener ─── */
export async function onAuthChange(callback) {
  const supabase = await getSupabase();
  return supabase.auth.onAuthStateChange((event, session) => callback(session, event));
}

/* ─── Turn a Supabase error into something a person can act on ─── */
export function authMessage(err) {
  const raw = String(err?.message || err || '').toLowerCase();
  if (raw.includes('invalid login')) return 'That email and password do not match an account.';
  if (raw.includes('already registered') || raw.includes('already been registered'))
    return 'There is already an account with that email — try signing in.';
  if (raw.includes('password') && raw.includes('6')) return 'Use a password of at least 6 characters.';
  if (raw.includes('email') && raw.includes('invalid')) return 'That does not look like a valid email address.';
  if (raw.includes('confirm')) return 'Check your inbox and confirm your email first.';
  if (raw.includes('rate') || raw.includes('too many')) return 'Too many attempts — wait a minute and try again.';
  if (raw.includes('failed to fetch') || raw.includes('network'))
    return 'Could not reach the server. Check your connection.';
  return err?.message || 'Something went wrong. Try again.';
}
