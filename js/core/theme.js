/* ═══════════════════════════════════════════════════════════════
   GabikOS — themes

   Six full palettes rather than one dark and one light. Each is tuned
   for long sessions: no pure black, no pure white, and text contrast
   held around 11:1 — comfortably past the 7:1 accessibility bar, but
   short of the ~19:1 glare of #fff on #000.
   ═══════════════════════════════════════════════════════════════ */
import { store, settings } from './store.js';

export const THEMES = [
  { id: 'midnight', name: 'Midnight', mode: 'dark',  swatch: ['#12141c', '#1b1f2b'],
    hint: 'Deep blue-black. The default.' },
  { id: 'carbon',   name: 'Carbon',   mode: 'dark',  swatch: ['#17171a', '#212126'],
    hint: 'Neutral grey, lowest contrast — easiest at night.' },
  { id: 'forest',   name: 'Forest',   mode: 'dark',  swatch: ['#101815', '#18231f'],
    hint: 'Green-tinted dark, calm and warm.' },
  { id: 'plum',     name: 'Plum',     mode: 'dark',  swatch: ['#16111d', '#201929'],
    hint: 'Purple dusk, soft and moody.' },
  { id: 'daylight', name: 'Daylight', mode: 'light', swatch: ['#f7f8fc', '#ffffff'],
    hint: 'Clean and cool for bright rooms.' },
  { id: 'paper',    name: 'Paper',    mode: 'light', swatch: ['#f6f2e9', '#fffdf8'],
    hint: 'Warm cream, gentlest light theme.' },
];
export const themeById = id => THEMES.find(t => t.id === id) || THEMES[0];

export const ACCENTS = [
  { name: 'Violet', hex: '#8b6dff' },
  { name: 'Ocean',  hex: '#3fb6e8' },
  { name: 'Mint',   hex: '#3fc98d' },
  { name: 'Amber',  hex: '#e8a33d' },
  { name: 'Coral',  hex: '#f2726f' },
  { name: 'Rose',   hex: '#e070b0' },
  { name: 'Teal',   hex: '#2fb8b8' },
  { name: 'Lime',   hex: '#8fc457' },
  { name: 'Sky',    hex: '#5b8def' },
  { name: 'Sand',   hex: '#c9a227' },
];

/* ─── colour helpers ─── */
const hexToRgb = hex => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]) => '#' + [r, g, b].map(c =>
  Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hexToRgb(a).map((c, i) => c + (hexToRgb(b)[i] - c) * t);

/** Relative luminance, for the contrast guard below. */
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Nudge an accent until it reads clearly on the theme's ground. */
export function readableOn(accent, ground, target = 4.5) {
  const toward = luminance(ground) > 0.5 ? '#0a0a0c' : '#ffffff';
  let c = accent;
  for (let i = 0; i < 24 && contrast(c, ground) < target; i++) c = toHex(mix(c, toward, 0.06));
  return c;
}

export function applyTheme() {
  const s = settings();
  const root = document.documentElement;

  let id = s.theme || 'midnight';
  if (id === 'auto') id = window.matchMedia('(prefers-color-scheme: light)').matches ? 'daylight' : 'midnight';
  if (id === 'dark') id = 'midnight';          // migrate the old two-value setting
  if (id === 'light') id = 'daylight';

  const theme = themeById(id);
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.style.colorScheme = theme.mode;

  const ground = theme.swatch[0];
  const accent = s.accent || '#8b6dff';
  const safe = readableOn(accent, ground, 4.5);
  const [r, g, b] = hexToRgb(safe);

  root.style.setProperty('--accent', safe);
  root.style.setProperty('--accent-2', toHex(mix(safe, theme.mode === 'dark' ? '#ffffff' : '#ffffff', 0.3)));
  root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},${theme.mode === 'light' ? 0.12 : 0.16})`);
  root.style.setProperty('--accent-line', `rgba(${r},${g},${b},.34)`);

  // comfort controls
  root.dataset.density = s.density || 'normal';
  root.style.setProperty('--ui-scale', s.textScale || 1);

  document.querySelector('meta[name=theme-color]')?.setAttribute('content', ground);
}

/** Cycle to the next theme of the opposite mode — what the topbar button does. */
export function toggleTheme() {
  const cur = themeById(settings().theme === 'auto' ? 'midnight' : settings().theme);
  const next = cur.mode === 'dark'
    ? (settings().lastLight || 'daylight')
    : (settings().lastDark || 'midnight');
  store.setSetting(cur.mode === 'dark' ? 'lastDark' : 'lastLight', cur.id);
  store.setSetting('theme', next);
  applyTheme();
  return themeById(next);
}

export function setTheme(id) {
  store.setSetting('theme', id);
  applyTheme();
}

export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => { if (settings().theme === 'auto') applyTheme(); });
}

/* ─── Per-module hues ───────────────────────────────────────────
   Every module carries its own colour so the sidebar and page heads
   read as a set of places rather than one flat list. */
export const VIEW_HUES = {
  dashboard: '#8b6dff', tasks: '#5b8def', habits: '#3fc98d', focus: '#f2726f',
  calendar: '#3fb6e8', notes: '#e8a33d', journal: '#e070b0', goals: '#2fb8b8',
  health: '#4fc38a', finance: '#c9a227', builder: '#a07cff', settings: '#8a93a6',
};
export const hueFor = (id, fallback = 'var(--accent)') => VIEW_HUES[id] || fallback;
