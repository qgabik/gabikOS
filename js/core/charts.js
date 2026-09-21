/* ═══════════════════════════════════════════════════════════════
   GabikOS — charts: dependency-free inline SVG
   Design rules: one accent hue for single series, muted gridlines,
   direct labelling over legends, tabular numerals, theme-aware.
   ═══════════════════════════════════════════════════════════════ */
import { esc, clamp, round } from './util.js';

/* ─── Categorical series colours ───────────────────────────────
   Eight hues in a fixed order, stepped once for light surfaces and
   again for dark ones — a dark theme gets its own steps rather than
   the light ones dimmed.

   The order is the safety mechanism, not decoration: neighbouring
   slots are the ones that end up side by side in a donut or a stack.
   The set this replaces put #ec6ead beside #ff6b6b, 9.7 apart in
   OKLab — two slices of a pie that even full colour vision struggles
   to separate. These clear 19.3 (dark) and 19.6 (light) on the worst
   adjacent pair, and 8.4 / 9.1 simulated for colour blindness.
   Verified with the dataviz validator against this app's own
   surfaces; three light slots sit under 3:1, which the legend beside
   every chart covers by naming each category outright. */
const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const SERIES_DARK  = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** The set for the theme on screen right now. */
export const series = () =>
  (document.documentElement.dataset.mode === 'light' ? SERIES_LIGHT : SERIES_DARK);

/** The colour for slot `i`, folding back to the start past eight. */
export const seriesColor = i => { const s = series(); return s[i % s.length]; };

/* Kept so existing call sites read naturally; prefer seriesColor(i). */
export const SERIES = new Proxy([], {
  get: (_t, k) => (k === 'length' ? 8 : series()[k]),
});

/* ─── Sparkline ─── */
export function sparkline(values = [], { w = 120, h = 34, stroke = 'var(--accent)', fill = true } = {}) {
  const vals = values.map(v => Number(v) || 0);
  if (vals.length < 2) return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none"></svg>`;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => [round(i * step, 2), round(h - 3 - ((v - min) / span) * (h - 6), 2)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none" aria-hidden="true">
    ${fill ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${stroke}" stop-opacity=".28"/>
      <stop offset="100%" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>` : ''}
    <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ─── Bar chart ─── */
export function barChart(data = [], { height = 170, color = 'var(--accent)', format = v => v, showValues = false } = {}) {
  if (!data.length) return '<div class="chart-empty">No data yet</div>';
  const max = Math.max(...data.map(d => Math.abs(Number(d.value) || 0)), 1);
  return `<div class="bars" style="--chart-h:${height}px">
    ${data.map(d => {
      const v = Number(d.value) || 0;
      const pctH = clamp((Math.abs(v) / max) * 100, v ? 2 : 0, 100);
      return `<div class="bars__col" title="${esc(d.label)}: ${esc(String(format(v)))}">
        <div class="bars__track">
          ${showValues && v ? `<span class="bars__val">${esc(String(format(v)))}</span>` : ''}
          <div class="bars__fill" style="height:${pctH}%;--bc:${d.color || color}"></div>
        </div>
        <span class="bars__label">${esc(d.label)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ─── Grouped / stacked bars (income vs expense etc.) ─── */
export function groupedBars(data = [], series = [], { height = 180, format = v => v } = {}) {
  if (!data.length) return '<div class="chart-empty">No data yet</div>';
  const max = Math.max(1, ...data.flatMap(d => series.map(s => Math.abs(Number(d[s.key]) || 0))));
  return `<div>
    <div class="chart-legend">${series.map(s =>
      `<span class="chart-legend__item"><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>
    <div class="bars bars--grouped" style="--chart-h:${height}px">
      ${data.map(d => `<div class="bars__col">
        <div class="bars__track bars__track--group">
          ${series.map(s => {
            const v = Math.abs(Number(d[s.key]) || 0);
            return `<div class="bars__fill" style="height:${clamp((v / max) * 100, v ? 2 : 0, 100)}%;--bc:${s.color}"
              title="${esc(d.label)} · ${esc(s.label)}: ${esc(String(format(d[s.key] || 0)))}"></div>`;
          }).join('')}
        </div>
        <span class="bars__label">${esc(d.label)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

/* ─── Donut ─── */
export function donut(segments = [], { size = 148, thickness = 17, centerTop = '', centerSub = '' } = {}) {
  const total = segments.reduce((a, s) => a + (Number(s.value) || 0), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = total
    ? segments.filter(s => Number(s.value) > 0).map((s, i) => {
        const frac = (Number(s.value) || 0) / total;
        const dash = `${round(frac * c, 2)} ${round(c - frac * c, 2)}`;
        const el = `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none"
          stroke="${s.color || seriesColor(i)}" stroke-width="${thickness}"
          stroke-dasharray="${dash}" stroke-dashoffset="${round(-offset * c, 2)}" stroke-linecap="butt">
          <title>${esc(s.label)}: ${round(frac * 100, 1)}%</title></circle>`;
        offset += frac;
        return el;
      }).join('')
    : `<circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"/>`;

  return `<div class="donut" style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"/>
      ${arcs}
    </svg>
    ${centerTop ? `<div class="donut__mid"><strong>${centerTop}</strong>${centerSub ? `<small>${esc(centerSub)}</small>` : ''}</div>` : ''}
  </div>`;
}

export const legend = (segments, { format = v => v } = {}) => `
  <ul class="legend">${segments.map((s, i) => `
    <li><i style="background:${s.color || seriesColor(i)}"></i>
      <span class="grow truncate">${esc(s.label)}</span>
      <strong class="mono">${esc(String(format(s.value)))}</strong></li>`).join('')}
  </ul>`;

/* ─── Line chart with axis ─── */
export function lineChart(points = [], { height = 190, color = 'var(--accent)', format = v => v, unit = '' } = {}) {
  const vals = points.map(p => Number(p.value)).filter(v => !isNaN(v));
  if (vals.length < 2) return '<div class="chart-empty">Log at least two entries to see a trend</div>';
  const W = 640, H = height, padL = 42, padR = 12, padT = 14, padB = 26;
  const min = Math.min(...vals), max = Math.max(...vals);
  const pad = (max - min) * 0.14 || Math.abs(max * 0.1) || 1;
  const lo = min - pad, hi = max + pad;
  const x = i => padL + (i / (points.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);

  const valid = points.map((p, i) => ({ ...p, i, v: Number(p.value) })).filter(p => !isNaN(p.v));
  const line = valid.map((p, k) => `${k ? 'L' : 'M'}${round(x(p.i),1)} ${round(y(p.v),1)}`).join(' ');
  const area = `${line} L${round(x(valid.at(-1).i),1)} ${H - padB} L${round(x(valid[0].i),1)} ${H - padB} Z`;
  const gid = 'lg' + Math.random().toString(36).slice(2, 8);
  const ticks = [lo, (lo + hi) / 2, hi];

  return `<svg viewBox="0 0 ${W} ${H}" class="linechart" preserveAspectRatio="xMidYMid meet">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".26"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    ${ticks.map(t => `<g>
      <line x1="${padL}" x2="${W - padR}" y1="${round(y(t),1)}" y2="${round(y(t),1)}" stroke="var(--grid-line)" stroke-width="1"/>
      <text x="${padL - 7}" y="${round(y(t),1) + 3.5}" text-anchor="end" class="chart-tick">${esc(String(format(round(t, 1))))}</text>
    </g>`).join('')}
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    ${valid.map(p => `<circle cx="${round(x(p.i),1)}" cy="${round(y(p.v),1)}" r="3" fill="var(--surface)" stroke="${color}" stroke-width="2">
      <title>${esc(p.label)}: ${esc(String(format(p.v)))}${esc(unit)}</title></circle>`).join('')}
    ${[valid[0], valid.at(-1)].map(p =>
      `<text x="${round(clamp(x(p.i), padL + 14, W - padR - 14),1)}" y="${H - 8}" text-anchor="middle" class="chart-tick">${esc(p.label)}</text>`).join('')}
  </svg>`;
}

/* ─── Contribution heatmap (habits / activity) ─── */
export function heatmap(cells = [], { cols = 26, title = '' } = {}) {
  return `<div class="heatmap" style="--cols:${cols}" ${title ? `aria-label="${esc(title)}"` : ''}>
    ${cells.map(c => `<i class="heat heat--${c.level}" title="${esc(c.title || '')}"
      ${c.color && c.level ? `style="--hc:${c.color}"` : ''}></i>`).join('')}
  </div>`;
}
