/* ═══════════════════════════════════════════════════════════════
   GabikOS — theme: dark/light/auto + accent colour
   ═══════════════════════════════════════════════════════════════ */
import { store, settings } from './store.js';

export const ACCENTS = [
  { name: 'Violet', hex: '#7c5cff' },
  { name: 'Ocean',  hex: '#4cc4f0' },
  { name: 'Mint',   hex: '#3ecf8e' },
  { name: 'Amber',  hex: '#f5b544' },
  { name: 'Coral',  hex: '#ff6b6b' },
  { name: 'Rose',   hex: '#ec6ead' },
  { name: 'Teal',   hex: '#26c6da' },
  { name: 'Lime',   hex: '#9ccc65' },
];

const hexToRgb = hex => {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Lighten a hex colour toward white by `amt` (0–1). */
function lighten(hex, amt = 0.28) {
  const [r, g, b] = hexToRgb(hex);
  const mix = c => Math.round(c + (255 - c) * amt);
  return `#${[mix(r), mix(g), mix(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

export function applyTheme() {
  const s = settings();
  const root = document.documentElement;

  const mode = s.theme === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : (s.theme || 'dark');
  root.dataset.theme = mode;

  const accent = s.accent || '#7c5cff';
  const [r, g, b] = hexToRgb(accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', lighten(accent, 0.3));
  root.style.setProperty('--accent-soft', `rgba(${r},${g},${b},${mode === 'light' ? 0.12 : 0.15})`);
  root.style.setProperty('--accent-line', `rgba(${r},${g},${b},.34)`);

  document.querySelector('meta[name=theme-color]')
    ?.setAttribute('content', mode === 'light' ? '#f6f7fb' : '#08090d');
}

export function toggleTheme() {
  const cur = settings().theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  store.setSetting('theme', next);
  applyTheme();
  return next;
}

export function watchSystemTheme() {
  window.matchMedia('(prefers-color-scheme: light)')
    .addEventListener('change', () => { if (settings().theme === 'auto') applyTheme(); });
}
