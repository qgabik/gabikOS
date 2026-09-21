/* ═══════════════════════════════════════════════════════════════
   GabikOS — deployment configuration

   The publishable (anon) key is meant to live in client code: it only
   identifies the project. What actually protects the data is row-level
   security in Postgres, which is set up in supabase/schema.sql and
   restricts every row to the user who owns it.

   Point this at your own project by editing the values, or at run time
   from the app (Settings → Account → Use a different project), which
   stores an override in this browser only.
   ═══════════════════════════════════════════════════════════════ */

/** Bumped with each release, so a screenshot says which copy is running. */
export const BUILD = '2026-09-21 · 12';

export const DEFAULT_SUPABASE = {
  url: 'https://meuwvywebbvwaprumshm.supabase.co',
  key: 'sb_publishable_2aV_Wlxg-Rvj7t1zAfgX8w_dP906uxo',
};

const OVERRIDE_KEY = 'gabikos:supabase';

/** The project this browser should talk to. */
export function supabaseConfig() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o?.url && o?.key) return { url: String(o.url).replace(/\/+$/, ''), key: String(o.key) };
    }
  } catch { /* fall through to the built-in project */ }
  return DEFAULT_SUPABASE;
}

export function setSupabaseConfig(url, key) {
  if (!url || !key) { localStorage.removeItem(OVERRIDE_KEY); return DEFAULT_SUPABASE; }
  const cfg = { url: String(url).trim().replace(/\/+$/, ''), key: String(key).trim() };
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(cfg));
  return cfg;
}

export const isConfigured = () => {
  const c = supabaseConfig();
  return !!(c.url && c.key && /^https?:\/\//.test(c.url));
};
