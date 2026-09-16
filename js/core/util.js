/* ═══════════════════════════════════════════════════════════════
   GabikOS — utilities: ids, dates, formatting, math
   ═══════════════════════════════════════════════════════════════ */

/* ─── IDs ─── */
export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/* ─── Dates ─── */
export const MS_DAY = 86400000;

/** Local YYYY-MM-DD (never UTC-shifted). */
export function iso(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export const today = () => iso();
/** Parse YYYY-MM-DD as a *local* date at midnight. */
export function parseISO(s) {
  if (!s) return new Date(NaN);
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(dateOrIso, n) {
  const d = typeof dateOrIso === 'string' ? parseISO(dateOrIso) : new Date(dateOrIso);
  d.setDate(d.getDate() + n);
  return d;
}
export const addDaysISO = (s, n) => iso(addDays(s, n));
export function diffDays(a, b) {
  const A = typeof a === 'string' ? parseISO(a) : new Date(a);
  const B = typeof b === 'string' ? parseISO(b) : new Date(b);
  A.setHours(0, 0, 0, 0); B.setHours(0, 0, 0, 0);
  return Math.round((A - B) / MS_DAY);
}
export const isToday = s => s === today();
export const isPast = s => !!s && diffDays(s, today()) < 0;
export const isFuture = s => !!s && diffDays(s, today()) > 0;

export function startOfWeek(dateOrIso = new Date(), weekStartsOn = 1) {
  const d = typeof dateOrIso === 'string' ? parseISO(dateOrIso) : new Date(dateOrIso);
  const diff = (d.getDay() - weekStartsOn + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
export function startOfMonth(d = new Date()) { const x = new Date(d); x.setDate(1); x.setHours(0,0,0,0); return x; }
export function endOfMonth(d = new Date()) { const x = new Date(d); x.setMonth(x.getMonth()+1, 0); x.setHours(23,59,59,999); return x; }
export const monthKey = (d = new Date()) => iso(d).slice(0, 7);

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const dayName = (d, short) => { const n = DAY_NAMES[(typeof d==='string'?parseISO(d):d).getDay()]; return short ? n.slice(0,3) : n; };
export const monthName = (m, short) => short ? MONTHS[m].slice(0,3) : MONTHS[m];

/** "Today" / "Tomorrow" / "Mon 4 Mar" */
export function fmtDate(s, opts = {}) {
  if (!s) return '';
  const d = typeof s === 'string' ? parseISO(s) : new Date(s);
  if (isNaN(d)) return '';
  const delta = diffDays(d, new Date());
  if (!opts.absolute) {
    if (delta === 0) return 'Today';
    if (delta === 1) return 'Tomorrow';
    if (delta === -1) return 'Yesterday';
    if (delta > 1 && delta < 7) return dayName(d);
    if (delta < -1 && delta > -7) return `${Math.abs(delta)}d ago`;
  }
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${dayName(d, true)} ${d.getDate()} ${monthName(d.getMonth(), true)}${sameYear ? '' : ' ' + d.getFullYear()}`;
}
export function fmtTime(mins) {
  if (mins == null) return '';
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
/** seconds -> m:ss or h:mm:ss */
export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
           : `${m}:${String(s).padStart(2,'0')}`;
}
/** minutes -> "2h 15m" */
export function fmtMins(mins) {
  mins = Math.round(mins || 0);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
export function relTime(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d/7)}w ago`;
  if (d < 365) return `${Math.floor(d/30)}mo ago`;
  return `${Math.floor(d/365)}y ago`;
}
export function greeting(h = new Date().getHours()) {
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 22) return 'Good evening';
  return 'Good night';
}

/* ─── Numbers ─── */
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sum = arr => arr.reduce((a, b) => a + (Number(b) || 0), 0);
export const avg = arr => arr.length ? sum(arr) / arr.length : 0;
export const round = (n, p = 0) => { const f = 10 ** p; return Math.round((Number(n) || 0) * f) / f; };
export const pct = (a, b) => (!b ? 0 : clamp(Math.round((a / b) * 100), 0, 100));

export function fmtNum(n, decimals = 0) {
  const v = Number(n) || 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function fmtMoney(n, currency = '€', decimals = 2) {
  const v = Number(n) || 0;
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${v < 0 ? '−' : ''}${currency}${s}`;
}
export function compactNum(n) {
  const v = Math.abs(Number(n) || 0);
  if (v >= 1e9) return round(n / 1e9, 1) + 'B';
  if (v >= 1e6) return round(n / 1e6, 1) + 'M';
  if (v >= 1e4) return round(n / 1e3, 1) + 'k';
  return fmtNum(n, v % 1 ? 1 : 0);
}

/* ─── Strings ─── */
export const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '');
export const initials = s => String(s || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const truncate = (s, n = 90) => (String(s || '').length > n ? String(s).slice(0, n).trimEnd() + '…' : String(s || ''));
export const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

/** Lightweight fuzzy match — returns score or -1. */
export function fuzzy(needle, haystack) {
  if (!needle) return 0;
  const n = needle.toLowerCase(), h = String(haystack || '').toLowerCase();
  const direct = h.indexOf(n);
  if (direct === 0) return 1000;
  if (direct > 0) return 700 - direct;
  let i = 0, score = 0, streak = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) { i++; streak++; score += 10 + streak * 4; }
    else streak = 0;
  }
  return i === n.length ? score : -1;
}

/* ─── Arrays ─── */
export const by = (key, dir = 1) => (a, b) => {
  const x = typeof key === 'function' ? key(a) : a[key];
  const y = typeof key === 'function' ? key(b) : b[key];
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return (x > y ? 1 : x < y ? -1 : 0) * dir;
};
export function groupBy(arr, keyFn) {
  const out = new Map();
  for (const item of arr) {
    const k = typeof keyFn === 'function' ? keyFn(item) : item[keyFn];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return out;
}
export const unique = arr => [...new Set(arr)];
export const move = (arr, from, to) => { const a = [...arr]; a.splice(to, 0, ...a.splice(from, 1)); return a; };

/* ─── Misc ─── */
export function debounce(fn, ms = 220) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms = 200) {
  let last = 0, timer;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}
export const deep = o => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));

/** Deterministic pleasant colour from any string. */
export function colorFor(str) {
  let h = 0;
  for (let i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) % 360;
  return `hsl(${h} 68% 60%)`;
}
export function download(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function pickFile(accept = 'application/json') {
  return new Promise(resolve => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return resolve(null);
      const r = new FileReader();
      r.onload = () => resolve({ name: f.name, content: r.result });
      r.onerror = () => resolve(null);
      r.readAsText(f);
    };
    inp.click();
  });
}
