/* ═══════════════════════════════════════════════════════════════
   GabikOS — Apple Health bridge

   A web page cannot read HealthKit: Safari exposes no API for it, so
   nothing a website does can open the Health app and take the numbers
   out. What iOS *does* give you is Shortcuts, which reads Health and
   can send the values somewhere. So GabikOS meets it halfway with two
   routes, and a Shortcut on the phone does the reading:

     · Link    — the Shortcut opens a GabikOS URL carrying the numbers.
                 Nothing to install, works signed out, but the page has
                 to open for the values to land.
     · Cloud   — the Shortcut posts straight to Supabase and GabikOS
                 picks the numbers up on every device by itself. Needs
                 an account and the SQL in supabase/health-inbox.sql.

   This module is only transport: reading the link, and talking to the
   inbox table. What the numbers mean is health.js's business.
   ═══════════════════════════════════════════════════════════════ */
import { getSupabase, getSession, canUseSupabase } from './supabase.js';
import { supabaseConfig } from '../config.js';
import { today, addDaysISO, clamp, round } from './util.js';

export const KEY_TABLE = 'gabikos_health_keys';
export const INBOX_TABLE = 'gabikos_health_inbox';
export const PUSH_FN = 'gabikos_health_push';

/* ═══ Samples ═════════════════════════════════════════════════
   One day of readings. Every field is optional but `date`; a missing
   field means "the phone had nothing", never "zero".               */

const num = v => {
  if (v == null || v === '' || typeof v === 'boolean') return null;   // Number(null) is 0, which is a reading
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const pad2 = n => String(n).padStart(2, '0');

/**
 * 'HH:MM', or a timestamp → 'HH:MM'.
 *
 * The digits in a timestamp are taken literally rather than run through
 * `Date`, because every timestamp that reaches here is already written
 * in the clock time it happened at: Apple's export stamps local time
 * with the offset beside it, and Shortcuts sends the phone's own clock.
 * Converting those into the browser's timezone would shift a 23:10
 * bedtime by however far the two disagree.
 */
export function toClock(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(?:\d{4}-\d{2}-\d{2}[T ])?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${pad2(mi)}`;
}

/**
 * Sleep arrives as minutes from Shortcuts and as hours from a person.
 * Nothing sleeps 24 minutes and nobody sleeps 400 hours, so the two
 * ranges never overlap and the unit can be read off the number.
 */
export function sleepMinutes(v) {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return Math.round(n <= 24 ? n * 60 : n);
}

/** Normalise anything sample-shaped into the one shape the app uses. */
export function normalizeSample(raw = {}) {
  const pick = (...keys) => { for (const k of keys) if (raw[k] != null && raw[k] !== '') return raw[k]; return null; };
  const date = String(pick('date', 'day', 'd') || today()).slice(0, 10);
  if (!isDate(date)) return null;

  const bed = toClock(pick('bed', 'bedtime', 'sleep_start', 'sleepStart', 'b'));
  const wake = toClock(pick('wake', 'wakeup', 'sleep_end', 'sleepEnd', 'w'));
  const mins = sleepMinutes(pick('sleepMinutes', 'sleep_minutes', 'sleep', 'sl'));

  const out = {
    date,
    steps: num(pick('steps', 'st')),
    sleepMinutes: mins ?? (bed && wake ? minutesBetween(bed, wake) : null),
    bedtime: bed,
    wake,
    restingHr: num(pick('restingHr', 'resting_hr', 'hr')),
    weight: num(pick('weight', 'kg')),
    activeEnergy: num(pick('activeEnergy', 'active_energy', 'cal', 'calories')),
    exerciseMinutes: num(pick('exerciseMinutes', 'exercise_minutes', 'ex', 'move')),
  };
  if (out.steps != null) out.steps = clamp(Math.round(out.steps), 0, 200_000);
  if (out.sleepMinutes != null) out.sleepMinutes = clamp(Math.round(out.sleepMinutes), 0, 1440);
  if (out.restingHr != null) out.restingHr = clamp(Math.round(out.restingHr), 20, 250);
  if (out.weight != null) out.weight = round(clamp(out.weight, 0, 400), 1);
  if (out.activeEnergy != null) out.activeEnergy = clamp(Math.round(out.activeEnergy), 0, 30_000);
  if (out.exerciseMinutes != null) out.exerciseMinutes = clamp(Math.round(out.exerciseMinutes), 0, 1440);

  const hasAny = Object.entries(out).some(([k, v]) => k !== 'date' && v != null);
  return hasAny ? out : null;
}

/** Bed 23:10 → wake 06:42 crosses midnight; that is the normal case. */
export function minutesBetween(bed, wake) {
  const b = clockMins(bed), w = clockMins(wake);
  if (b == null || w == null) return null;
  return w >= b ? w - b : (1440 - b) + w;
}
export function clockMins(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

/* ═══ Route 1 — the link ══════════════════════════════════════
   #/health?ah=1&steps=8321&sleep=452&bed=23:10&wake=06:42       */

const LINK_KEYS = ['ah', 'steps', 'st', 'sleep', 'sl', 'bed', 'wake', 'hr', 'kg', 'cal', 'ex',
                   'date', 'day', 'd', 'health'];

/** Read health values out of the current URL, hash or query alike. */
export function readLink(href = location.href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  const found = [];
  const fromParams = sp => {
    const raw = Object.fromEntries(sp);
    if (!('ah' in raw) && !('health' in raw)) return;
    if (raw.data) {                       // several days at once, as JSON
      try {
        const parsed = JSON.parse(raw.data);
        for (const s of (Array.isArray(parsed) ? parsed : [parsed])) {
          const n = normalizeSample(s);
          if (n) found.push(n);
        }
      } catch { /* a malformed batch should not lose the single-day values */ }
    }
    const one = normalizeSample(raw);
    if (one) found.push(one);
  };

  fromParams(url.searchParams);
  const q = url.hash.indexOf('?');
  if (q >= 0) fromParams(new URLSearchParams(url.hash.slice(q + 1)));
  return found.length ? found : null;
}

/** Take the health values back out of the address bar once they are in. */
export function stripLink() {
  const url = new URL(location.href);
  let touched = false;
  for (const k of LINK_KEYS) if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; }
  url.searchParams.delete('data');

  const q = url.hash.indexOf('?');
  if (q >= 0) {
    const sp = new URLSearchParams(url.hash.slice(q + 1));
    const path = url.hash.slice(0, q);
    let hit = false;
    for (const k of [...LINK_KEYS, 'data']) if (sp.has(k)) { sp.delete(k); hit = true; }
    if (hit) { const rest = sp.toString(); url.hash = path + (rest ? '?' + rest : ''); touched = true; }
  }
  if (touched) history.replaceState(null, '', url.toString());
}

/** The URL a Shortcut should open, with the values left as placeholders. */
export function linkTemplate(base = location.origin + location.pathname) {
  return `${base.replace(/[?#].*$/, '')}#/health?ah=1&date=DATE&steps=STEPS&bed=BED&wake=WAKE`;
}

/* ═══ Route 2 — the cloud inbox ═══════════════════════════════ */

async function sb() {
  if (!canUseSupabase()) return null;
  const session = await getSession().catch(() => null);
  if (!session?.user) return null;
  return { client: await getSupabase(), uid: session.user.id };
}

export async function cloudReady() { return !!(await sb()); }

const randomKey = () => {
  const bytes = new Uint8Array(24);
  (crypto.getRandomValues ? crypto : window.crypto).getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** The phone's key for this account, made on first ask. */
export async function healthKey({ create = false, rotate = false } = {}) {
  const ctx = await sb();
  if (!ctx) return null;
  const { client, uid } = ctx;

  if (!rotate) {
    const { data, error } = await client.from(KEY_TABLE).select('key, last_used_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    if (data?.key) return data;
    if (!create) return null;
  }
  const key = randomKey();
  const { error } = await client.from(KEY_TABLE)
    .upsert({ user_id: uid, key, last_used_at: null }, { onConflict: 'user_id' });
  if (error) throw error;
  return { key, last_used_at: null };
}

/** Everything the phone has posted since `days` ago. */
export async function pullInbox(days = 60) {
  const ctx = await sb();
  if (!ctx) return [];
  const { client, uid } = ctx;
  const { data, error } = await client.from(INBOX_TABLE)
    .select('day, steps, sleep_minutes, bedtime, wake, resting_hr, weight, active_energy, exercise_minutes, updated_at')
    .eq('user_id', uid).gte('day', addDaysISO(today(), -days)).order('day');
  if (error) throw error;
  return (data || []).map(r => normalizeSample({
    date: r.day,
    steps: r.steps,
    sleep_minutes: r.sleep_minutes,
    bed: r.bedtime,
    wake: r.wake,
    resting_hr: r.resting_hr,
    weight: r.weight,
    active_energy: r.active_energy,
    exercise_minutes: r.exercise_minutes,
  })).filter(Boolean);
}

/** The exact request the Shortcut has to make, ready to be copied. */
export function cloudRecipe(key) {
  const cfg = supabaseConfig();
  return {
    url: `${cfg.url}/rest/v1/rpc/${PUSH_FN}`,
    method: 'POST',
    headers: {
      apikey: cfg.key,
      Authorization: `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
    },
    body: {
      p_key: key || 'YOUR-KEY',
      p_day: 'DATE',
      p_steps: 'STEPS',
      p_sleep_minutes: 'SLEEP-MINUTES',
      p_bedtime: 'BEDTIME',
      p_wake: 'WAKE',
    },
  };
}

/** Post a sample the way the Shortcut will — used by "Send a test". */
export async function cloudPush(key, sample) {
  const cfg = supabaseConfig();
  const s = normalizeSample(sample) || { date: today() };
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${PUSH_FN}`, {
    method: 'POST',
    headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_key: key,
      p_day: s.date,
      p_steps: s.steps,
      p_sleep_minutes: s.sleepMinutes,
      p_bedtime: s.bedtime,
      p_wake: s.wake,
      p_resting_hr: s.restingHr,
      p_weight: s.weight,
      p_active_energy: s.activeEnergy,
      p_exercise_minutes: s.exerciseMinutes,
    }),
  });
  if (!res.ok) throw new Error((await res.text().catch(() => '')) || `HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}

/* ═══ Backfill — Apple's own export ═══════════════════════════ */

/**
 * Health → profile → Export All Health Data gives a zip of export.xml.
 * Unzipped, the step and sleep records are plain elements; totalling
 * them per day is all the app needs, and it keeps the parse to one
 * pass so a 200 MB export does not freeze the phone for a minute.
 */
export function parseAppleExport(xml) {
  const days = new Map();
  const at = date => {
    const d = date.slice(0, 10);
    if (!days.has(d)) days.set(d, { date: d, steps: 0, sleepMinutes: 0, first: null, last: null });
    return days.get(d);
  };
  const re = /<Record[^>]*?type="([^"]+)"[^>]*?startDate="([^"]+)"[^>]*?endDate="([^"]+)"[^>]*?value="([^"]*)"/g;
  let m;
  while ((m = re.exec(xml))) {
    const [, type, start, end, value] = m;
    if (type === 'HKQuantityTypeIdentifierStepCount') {
      at(start).steps += Number(value) || 0;
    } else if (type === 'HKCategoryTypeIdentifierSleepAnalysis' && !/InBed/i.test(value)) {
      // A night is filed under the morning it ends on, the way a person tells it.
      const s = Date.parse(start), e = Date.parse(end);
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) continue;
      const row = at(end);
      row.sleepMinutes += Math.round((e - s) / 60000);
      // Records are not guaranteed to be in order, so keep the outer edges
      // of the night rather than whichever segment happened to come last.
      if (!row.first || s < row.first.at) row.first = { at: s, clock: toClock(start) };
      if (!row.last || e > row.last.at) row.last = { at: e, clock: toClock(end) };
    }
  }
  return [...days.values()].map(d => normalizeSample({
    date: d.date,
    steps: d.steps || null,
    sleepMinutes: d.sleepMinutes || null,
    bed: d.first?.clock, wake: d.last?.clock,
  })).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
}

/** A pasted table: one day per line, `date, steps, sleep`. */
export function parsePasted(text) {
  const out = [];
  for (const line of String(text || '').split(/[\r\n]+/)) {
    const t = line.trim();
    if (!t || /^(date|day)\b/i.test(t)) continue;
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        const parsed = JSON.parse(t);
        for (const s of (Array.isArray(parsed) ? parsed : [parsed])) {
          const n = normalizeSample(s); if (n) out.push(n);
        }
      } catch { /* not JSON after all — fall through to the column reader */ }
      continue;
    }
    const [date, steps, sleep, bed, wake] = t.split(/[,;\t]+/).map(x => x.trim());
    const n = normalizeSample({ date, steps, sleep, bed, wake });
    if (n) out.push(n);
  }
  return out;
}
