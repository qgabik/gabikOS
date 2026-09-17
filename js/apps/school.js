/* ═══════════════════════════════════════════════════════════════
   GabikOS — School: timetable, subjects, next lesson

   Built for Czech school systems (ŠkolaOnline, Bakaláři): numbered
   periods, alternating odd/even weeks, subject abbreviations.
   Fills from an .ics export, from pasted text, or by hand.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile, modal, qs } from '../core/ui.js';
import { esc, uid, today, iso, parseISO, dayName, plural, by, colorFor, pickFile, truncate, fmtMins } from '../core/util.js';
import { parseICS, toWeeklySlots, isoWeek } from '../core/ics.js';

/* ─── Period times: the layout most Czech schools use ─── */
export const DEFAULT_PERIODS = [
  { n: 0,  start: '07:10', end: '07:55' }, { n: 1,  start: '08:00', end: '08:45' },
  { n: 2,  start: '08:55', end: '09:40' }, { n: 3,  start: '09:50', end: '10:35' },
  { n: 4,  start: '10:45', end: '11:30' }, { n: 5,  start: '11:40', end: '12:25' },
  { n: 6,  start: '12:30', end: '13:15' }, { n: 7,  start: '13:20', end: '14:05' },
  { n: 8,  start: '14:10', end: '14:55' }, { n: 9,  start: '15:00', end: '15:45' },
  { n: 10, start: '15:50', end: '16:35' }, { n: 11, start: '16:50', end: '17:35' },
  { n: 12, start: '17:40', end: '18:25' }, { n: 13, start: '18:30', end: '19:15' },
];
export const periods = () => settings().school?.periods?.length ? settings().school.periods : DEFAULT_PERIODS;
export const schoolCfg = () => ({ weekMode: 'single', days: 5, ...(settings().school || {}) });

const DAYS = [
  { n: 1, cs: 'Pondělí', en: 'Monday' }, { n: 2, cs: 'Úterý', en: 'Tuesday' },
  { n: 3, cs: 'Středa', en: 'Wednesday' }, { n: 4, cs: 'Čtvrtek', en: 'Thursday' },
  { n: 5, cs: 'Pátek', en: 'Friday' }, { n: 6, cs: 'Sobota', en: 'Saturday' },
];

/* ─── Week parity ─── */
export const weekParity = (d = new Date()) => (isoWeek(d) % 2 ? 'a' : 'b');
export const parityLabel = p => (p === 'a' ? 'Week A (odd)' : 'Week B (even)');

/* ─── Queries ─── */
export const subjects = () => S().subjects || [];
export const lessons = () => S().lessons || [];
export const subjectOf = id => subjects().find(s => s.id === id);

const minutes = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + m; };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** Lessons for a weekday, in period order, respecting week parity. */
export function lessonsOn(day, parity = weekParity()) {
  return lessons()
    .filter(l => l.day === day && (l.week === 'all' || !l.week || l.week === parity))
    .sort(by(l => Number(l.period)));
}
export const todayLessons = () => lessonsOn(new Date().getDay());

/** What is on right now, and what is next. */
export function currentAndNext() {
  const list = todayLessons();
  const now = nowMins();
  const ps = periods();
  const timed = list.map(l => {
    const p = ps.find(x => Number(x.n) === Number(l.period));
    if (!p) return null;
    const span = Math.max(1, Number(l.span) || 1);
    const idx = ps.findIndex(x => Number(x.n) === Number(p.n));
    const last = ps[Math.min(idx + span - 1, ps.length - 1)] || p;
    return { ...l, span, start: minutes(p.start), end: minutes(last.end), startStr: p.start, endStr: last.end };
  }).filter(l => l && !isNaN(l.start));
  const current = timed.find(l => now >= l.start && now < l.end) || null;
  const next = timed.find(l => l.start > now) || null;
  return { current, next, all: timed };
}

/**
 * A day as you actually live it: lessons, and the empty periods between
 * them. A five-minute changeover is not free time; a whole empty period
 * is, and that is the thing worth seeing.
 */
export function dayTimeline(day, parity = weekParity()) {
  const ps = periods();
  const idxOf = n => ps.findIndex(x => Number(x.n) === Number(n));

  const lessons = lessonsOn(day, parity).map(l => {
    const from = idxOf(l.period);
    if (from < 0) return null;
    const span = Math.max(1, Number(l.span) || 1);
    const to = Math.min(from + span - 1, ps.length - 1);
    return { ...l, span, fromIdx: from, toIdx: to,
      startStr: ps[from].start, endStr: ps[to].end,
      start: minutes(ps[from].start), end: minutes(ps[to].end) };
  }).filter(Boolean).sort((a, b) => a.fromIdx - b.fromIdx);

  const out = [];
  lessons.forEach((l, i) => {
    out.push({ type: 'lesson', ...l });
    const next = lessons[i + 1];
    if (!next) return;
    const gapIdx = [];
    for (let k = l.toIdx + 1; k < next.fromIdx; k++) gapIdx.push(k);
    if (!gapIdx.length) return;            // back-to-back, only a changeover
    const from = ps[gapIdx[0]], to = ps[gapIdx.at(-1)];
    out.push({
      type: 'free',
      startStr: from.start, endStr: to.end,
      start: minutes(from.start), end: minutes(to.end),
      mins: minutes(to.end) - minutes(from.start),
      periodNums: gapIdx.map(k => ps[k].n),
    });
  });
  return out;
}

/** Totals for a day: lessons, free minutes, first in, last out. */
export function dayShape(day, parity = weekParity()) {
  const line = dayTimeline(day, parity);
  const lessons = line.filter(x => x.type === 'lesson');
  const frees = line.filter(x => x.type === 'free');
  return {
    line, lessons, frees,
    freeMins: frees.reduce((a, f) => a + f.mins, 0),
    longest: frees.reduce((a, f) => (f.mins > (a?.mins || 0) ? f : a), null),
    firstIn: lessons[0]?.startStr || '',
    lastOut: lessons.at(-1)?.endStr || '',
  };
}

/* ─── Subjects ─── */
function ensureSubject(name, { short, teacher, room, color } = {}) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const found = subjects().find(s => s.name.toLowerCase() === clean.toLowerCase());
  if (found) {
    const patch = {};
    if (teacher && !found.teacher) patch.teacher = teacher;
    if (room && !found.room) patch.room = room;
    if (short && !found.shortLocked) { patch.short = uniqueShort(short, found.id); patch.shortLocked = true; }
    if (Object.keys(patch).length) store.update('subjects', found.id, patch);
    return found.id;
  }
  const rec = store.add('subjects', {
    name: clean,
    short: uniqueShort(short || abbreviate(clean)),
    shortLocked: !!short,
    teacher: teacher || '',
    room: room || '',
    color: color || colorFor(clean),
  });
  return rec.id;
}

/** Two subjects must never share a code — Ma and Mat are not one subject. */
function uniqueShort(code, selfId = null) {
  const taken = new Set(subjects().filter(s => s.id !== selfId).map(s => String(s.short || '').toLowerCase()));
  const base = String(code || '?').trim() || '?';
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 40; i++) if (!taken.has(`${base}${i}`.toLowerCase())) return `${base}${i}`;
  return base;
}

/** "Český jazyk a literatura" → "ČJL" */
function abbreviate(name) {
  const skip = new Set(['a', 'i', 'the', 'and', 'of', 'do', 'na', 'v', 'z', 'ze']);
  const words = String(name).split(/[\s\-–]+/).filter(w => w && !skip.has(w.toLowerCase()));
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map(w => w[0]).join('').toUpperCase();
}

/* ─── Lesson editing ─── */
const lessonFields = (l = {}) => [
  { name: 'subject', label: 'Subject', type: 'text', required: true, placeholder: 'e.g. Matematika',
    value: l.subjectId ? subjectOf(l.subjectId)?.name : (l.subject || '') },
  { name: 'day', label: 'Day', type: 'select', half: true, value: l.day ?? 1,
    options: DAYS.map(d => ({ value: d.n, label: `${d.cs} · ${d.en}` })) },
  { name: 'period', label: 'Period', type: 'select', half: true, value: l.period ?? 1,
    options: periods().map(p => ({ value: p.n, label: `${p.n}. — ${p.start}–${p.end}` })) },
  { name: 'teacher', label: 'Teacher', type: 'text', half: true, value: l.teacher },
  { name: 'room', label: 'Room', type: 'text', half: true, value: l.room },
  { name: 'span', label: 'Length', type: 'select', half: true, value: l.span || 1,
    options: [1,2,3,4,5,6,7,8].map(n => ({ value: n, label: n === 1 ? 'One period' : `${n} periods in a row` })) },
  { name: 'week', label: 'Which weeks', type: 'select', value: l.week || 'all',
    options: [{ value: 'all', label: 'Every week' }, { value: 'a', label: 'Odd weeks only (A)' }, { value: 'b', label: 'Even weeks only (B)' }] },
  { name: 'note', label: 'Note', type: 'text', value: l.note, placeholder: 'optional' },
];

export async function newLesson(preset = {}) {
  const v = await openForm({ title: 'Add lesson', size: 'wide', fields: lessonFields(preset), submitLabel: 'Add' });
  if (!v) return;
  const subjectId = ensureSubject(v.subject, { teacher: v.teacher, room: v.room });
  store.add('lessons', { day: Number(v.day), period: Number(v.period), subjectId,
    teacher: v.teacher, room: v.room, week: v.week, note: v.note, span: Number(v.span) || 1 });
  toast('Lesson added', 'ok');
  render();
}

async function editLesson(id) {
  const l = store.find('lessons', id);
  if (!l) return;
  const v = await openForm({
    title: 'Edit lesson', size: 'wide', fields: lessonFields(l), values: l, submitLabel: 'Save',
    extraFooter: `<button class="btn btn--danger btn--sm" data-act="del" type="button">Delete</button>`,
    onMount: (_b, foot) => {
      foot.querySelector('[data-act=del]').onclick = async () => {
        qs('#modal').hidden = true;
        if (await confirmDialog({ title: 'Delete lesson?', message: 'It will be removed from your timetable.', confirmLabel: 'Delete', danger: true })) {
          store.remove('lessons', id); toast('Lesson removed', 'ok'); render();
        } else qs('#modal').hidden = false;
      };
    },
  });
  if (!v) return;
  const subjectId = ensureSubject(v.subject, { teacher: v.teacher, room: v.room });
  store.update('lessons', id, { day: Number(v.day), period: Number(v.period), subjectId,
    teacher: v.teacher, room: v.room, week: v.week, note: v.note, span: Number(v.span) || 1 });
  toast('Lesson updated', 'ok');
  render();
}

/* ─── Import ─── */
function applySlots(slots, { replace }) {
  if (replace) store.commit(s => { s.lessons = []; }, { key: 'lessons' });
  let added = 0, skipped = 0;
  const ps = periods();
  for (const slot of slots) {
    if (slot.day < 1 || slot.day > 6) { skipped++; continue; }
    // nearest period by start time, within 20 minutes
    const target = minutes(slot.start);
    let best = null, bestDiff = 1e9;
    for (const p of ps) {
      const diff = Math.abs(minutes(p.start) - target);
      if (diff < bestDiff) { bestDiff = diff; best = p; }
    }
    if (!best || bestDiff > 20) { skipped++; continue; }
    const subjectId = ensureSubject(slot.title, { teacher: slot.teacher, room: slot.room, short: slot.short });
    const dup = lessons().some(l => l.day === slot.day && Number(l.period) === Number(best.n) && l.subjectId === subjectId);
    if (dup) { skipped++; continue; }
    // a block lesson covers every period that starts inside it
    const span = slot.span || (slot.end
      ? Math.max(1, ps.filter(x => minutes(x.start) >= minutes(best.start) && minutes(x.start) < minutes(slot.end)).length)
      : 1);
    store.add('lessons', {
      day: slot.day, period: best.n, subjectId, span,
      teacher: slot.teacher || '', room: slot.room || '',
      week: slot.everyWeek ? 'all' : (slot.weekParity || 'all'),
    });
    added++;
  }
  store.log('graduation', `Imported ${plural(added, 'lesson')} into the timetable`, 'school');
  toast(`${plural(added, 'lesson')} imported${skipped ? `, ${skipped} skipped` : ''}`, added ? 'ok' : 'warn', { duration: 5200 });
  render();
}

async function importICS() {
  const file = await pickFile('.ics,text/calendar');
  if (!file) return;
  let slots;
  try {
    const events = parseICS(file.content);
    if (!events.length) { toast('No events found in that file', 'warn'); return; }
    slots = toWeeklySlots(events);
  } catch (err) {
    toast(`Could not read that file: ${err.message}`, 'bad', { duration: 6000 });
    return;
  }
  if (!slots.length) { toast('No lessons found — the file had only all-day entries', 'warn'); return; }
  previewImport(slots, file.name);
}

/** Distinct start times in the file that no configured period matches. */
function unmatchedTimes(slots) {
  const ps = periods();
  const seen = new Set();
  for (const s of slots) {
    if (!s.start) continue;
    const t = minutes(s.start);
    const near = ps.some(p => Math.abs(minutes(p.start) - t) <= 5);
    if (!near) seen.add(s.start);
  }
  return [...seen].sort();
}

/** Rebuild the period list from the times the file actually uses.
 *  School periods run consecutively, so the whole numbering follows from
 *  where the FIRST time lands — matching each time independently would
 *  mix matched numbers with guessed ones and collide. */
function periodsFromSlots(slots) {
  const starts = [...new Set(slots.map(s => s.start).filter(Boolean))].sort((a, b) => minutes(a) - minutes(b));
  if (!starts.length) return [];

  // A block lesson shares its start with a single-period one but ends much
  // later, so the SHORTEST duration seen for a start time is the period's.
  const endFor = new Map();
  for (const s of slots) {
    if (!s.start || !s.end || minutes(s.end) <= minutes(s.start)) continue;
    const cur = endFor.get(s.start);
    if (cur == null || minutes(s.end) < minutes(cur)) endFor.set(s.start, s.end);
  }

  const existing = periods();
  const anchor = existing.find(p => Math.abs(minutes(p.start) - minutes(starts[0])) <= 5);
  const base = anchor ? Number(anchor.n) : 1;

  const built = starts.map((start, i) => {
    const n = base + i;
    const old = existing.find(p => Number(p.n) === n);
    return { n, start, end: endFor.get(start) || old?.end || '' };
  });

  // periods the file says nothing about (an early slot, a late one) stay as they were
  const covered = new Set(built.map(p => p.n));
  const kept = existing.filter(p => !covered.has(Number(p.n)) &&
    !built.some(b => Math.abs(minutes(b.start) - minutes(p.start)) <= 5));
  return [...built, ...kept].sort((a, b) => Number(a.n) - Number(b.n));
}

function previewImport(slots, source) {
  const odd = unmatchedTimes(slots);
  modal.open({
    title: 'Review before importing', size: 'wide',
    body: `<p class="dim mb-4" style="font-size:13px">Found <strong>${plural(slots.length, 'lesson')}</strong>
      in ${esc(truncate(source, 40))}. Times are matched to your period numbers. Untick anything you do not want.</p>
      ${odd.length ? `<label class="check callout-inline">
        <input type="checkbox" data-adopt checked />
        <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
        <span><strong>Use this file's lesson times</strong><br/>
          <small class="dim">Your school starts ${plural(odd.length, 'lesson')} at ${esc(odd.slice(0, 3).join(', '))}${odd.length > 3 ? '…' : ''},
            which the current period times do not cover. Leave this ticked and they will be set from the file.</small></span>
      </label>` : ''}
      <div class="import-list">
        ${slots.map((s, i) => `<label class="check import-row">
          <input type="checkbox" data-slot="${i}" checked />
          <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
          <span class="import-row__body">
            <strong>${esc(s.title)}</strong>
            <small>${esc(DAYS.find(d => d.n === s.day)?.cs || dayName(new Date(2026, 8, 13 + s.day)))}
              · ${esc(s.start)}–${esc(s.end || '?')}${s.room ? ` · ${esc(s.room)}` : ''}${s.teacher ? ` · ${esc(s.teacher)}` : ''}
              ${s.everyWeek ? '' : ' · alternating weeks'}</small>
          </span>
        </label>`).join('')}
      </div>`,
    footer: `<label class="check" style="margin-right:auto">
        <input type="checkbox" data-replace />
        <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
        <span>Replace my current timetable</span>
      </label>
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--primary" data-act="ok">Import</button>`,
    onMount: (body, foot) => {
      foot.querySelector('[data-act=cancel]').onclick = () => modal.close();
      foot.querySelector('[data-act=ok]').onclick = () => {
        const picked = [...body.querySelectorAll('[data-slot]')]
          .filter(c => c.checked).map(c => slots[Number(c.dataset.slot)]);
        const replace = foot.querySelector('[data-replace]').checked;
        const adopt = body.querySelector('[data-adopt]')?.checked;
        modal.close();
        if (!picked.length) { toast('Nothing selected', 'warn'); return; }
        if (adopt) {
          const next = periodsFromSlots(picked);
          if (next.length) store.setSetting('school.periods', next);
        }
        applySlots(picked, { replace });
      };
    },
  });
}

async function importPaste() {
  const v = await openForm({
    title: 'Paste your timetable', size: 'wide', submitLabel: 'Read it',
    fields: [{ name: 'text', label: 'One lesson per line', type: 'textarea', rows: 12, required: true,
      placeholder: 'Mon 1 Matematika U2 Nováková\nMon 2 Čeština U5\nTue 3 Fyzika Lab1',
      hint: 'Day, period, subject, then room and teacher if you have them. Order is flexible — anything it gets wrong you can fix in the grid.' }],
  });
  if (!v) return;
  const slots = parsePasted(v.text);
  if (!slots.length) { toast('Could not find any lessons in that text', 'warn', { duration: 5000 }); return; }
  previewImport(slots, 'pasted text');
}

/** Best-effort line reader: day token + period number + the rest. */
function parsePasted(text) {
  const dayWords = {
    po: 1, pondeli: 1, pondělí: 1, mon: 1, monday: 1,
    ut: 2, 'út': 2, utery: 2, úterý: 2, tue: 2, tuesday: 2,
    st: 3, streda: 3, středa: 3, wed: 3, wednesday: 3,
    ct: 4, 'čt': 4, ctvrtek: 4, čtvrtek: 4, thu: 4, thursday: 4,
    pa: 5, 'pá': 5, patek: 5, pátek: 5, fri: 5, friday: 5,
    so: 6, sobota: 6, sat: 6, saturday: 6,
  };
  const ps = periods();
  const out = [];
  let lastDay = 1;

  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tokens = line.split(/[\t,;]+|\s{2,}|\s/).filter(Boolean);
    if (!tokens.length) continue;

    let day = null, period = null;
    const rest = [];
    for (const tok of tokens) {
      const low = tok.toLowerCase().replace(/[.:]$/, '');
      if (day === null && dayWords[low] != null) { day = dayWords[low]; continue; }
      if (period === null && /^\d{1,2}$/.test(low) && Number(low) <= 9) { period = Number(low); continue; }
      const time = low.match(/^(\d{1,2}):(\d{2})$/);
      if (period === null && time) {
        const mins = Number(time[1]) * 60 + Number(time[2]);
        const near = ps.reduce((a, p) => Math.abs(minutes(p.start) - mins) < Math.abs(minutes(a.start) - mins) ? p : a, ps[0]);
        period = near.n; continue;
      }
      rest.push(tok);
    }
    if (day === null) day = lastDay; else lastDay = day;
    if (period === null || !rest.length) continue;

    const p = ps.find(x => Number(x.n) === period) || ps[0];
    // a trailing short token that looks like a room
    let room = '';
    if (rest.length > 1 && /^[A-ZŠČŘŽ]?\d{1,3}[A-Za-z]?$|^(lab|tv|dil|díl)/i.test(rest.at(-1))) room = rest.pop();
    out.push({ day, start: p.start, end: p.end, title: rest.join(' '), room, teacher: '', count: 1, everyWeek: true, weekParity: 'all' });
  }
  return out;
}

/* ─── Read a photo of the timetable ───────────────────────────────
   The fastest route by far: point a camera at the paper or the screen
   and let Claude read it. Only available where the page is served by a
   Claude viewer; everywhere else the affordance stays hidden. */
let _ai = null;
export async function ensureAI() {
  if (_ai !== null) return _ai;
  try {
    const sample = await window.claude?.use?.('sample');
    if (!sample) return (_ai = false);
    const limits = await sample.limits().catch(() => null);
    _ai = limits?.images ? { sample, limits: limits.images } : false;
  } catch { _ai = false; }
  return _ai;
}

async function photoImport() {
  const ai = await ensureAI();
  if (!ai) { toast('Reading photos is only available on the claude.ai copy', 'warn', { duration: 5000 }); return; }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ai.limits.mediaTypes.join(',');
  input.multiple = ai.limits.maxCount > 1;
  input.onchange = async () => {
    const files = [...(input.files || [])].slice(0, ai.limits.maxCount);
    if (!files.length) return;
    const tooBig = files.find(f => f.size > ai.limits.maxInputBytes);
    if (tooBig) { toast(`${tooBig.name} is too large to read`, 'warn'); return; }
    runPhotoRead(files, ai);
  };
  input.click();
}

function runPhotoRead(files, ai) {
  const ctl = new AbortController();
  let settled = false;

  modal.open({
    title: 'Reading your timetable', size: 'slim', closable: false,
    body: `<div class="ai-reading">
        <div class="ai-reading__spin"><span class="spinner"></span></div>
        <strong id="aiStatus">Looking at ${plural(files.length, 'photo')}…</strong>
        <p class="dim">This takes a few seconds. Nothing is saved until you have checked it.</p>
      </div>`,
    footer: `<div class="grow"></div><button class="btn" data-stop>Cancel</button>`,
    onMount: (_b, foot) => { foot.querySelector('[data-stop]').onclick = () => { ctl.abort(); }; },
    onClose: () => { if (!settled) ctl.abort(); },
  });

  const ps = periods();
  const prompt = [
    'This photo shows a school timetable (a Czech "rozvrh hodin", or similar).',
    'Read every lesson you can see.',
    '',
    'Reply with ONLY a JSON array. One object per lesson:',
    '{"day":1,"period":1,"start":"08:00","subject":"Matematika","room":"U2","teacher":"","week":"all"}',
    '',
    'Rules:',
    '- day: 1=Monday … 5=Friday (6=Saturday, 7=Sunday).',
    '- period: the lesson number the table shows, if it shows one.',
    '- start: the start time "HH:MM", if times are shown. Give period or start — both if both are visible.',
    '- subject: exactly as printed. Keep Czech spelling and diacritics.',
    '- room / teacher: "" when not shown. Never invent them.',
    '- week: "all" normally. Use "a" for an odd/lichý-week-only lesson and "b" for an even/sudý-week-only one.',
    '- Skip breaks, lunch, headers and empty cells.',
    '- If a cell is unreadable, leave it out rather than guessing.',
    '',
    'For reference, this app uses these lesson times:',
    ps.map(p => `${p.n} = ${p.start}–${p.end}`).join(', '),
  ].join('\n');

  ai.sample.json(prompt, { images: files, modelTier: 'default', signal: ctl.signal, cache: false,
    onText: () => { const el = qs('#aiStatus'); if (el) el.textContent = 'Writing out the lessons…'; } })
    .then(rows => {
      settled = true;
      modal.close();
      const slots = rowsToSlots(Array.isArray(rows) ? rows : []);
      if (!slots.length) { toast('Could not find any lessons in that photo — try a sharper, straighter shot', 'warn', { duration: 6500 }); return; }
      previewImport(slots, plural(files.length, 'photo'));
    })
    .catch(err => {
      settled = true;
      modal.close();
      const say = {
        cancelled: null,
        not_granted: 'You declined, so the photo was not read.',
        rate_limited: 'Too many requests just now — try again in a minute.',
        image_rejected: 'That image could not be read. Try a JPEG or PNG under 20 MB.',
        images_unavailable: 'This copy of GabikOS cannot read photos.',
        invalid_json: 'The timetable came back unreadable. Try a straighter, better-lit photo.',
        refused: 'That image could not be processed.',
      };
      const msg = err?.code in say ? say[err.code] : 'Something went wrong reading the photo.';
      if (msg) toast(msg, 'bad', { duration: 6000 });
    });
}

/** Rows from the photo reader → the same slot shape the .ics path produces. */
function rowsToSlots(rows) {
  const ps = periods();
  const out = [];
  for (const r of rows) {
    const day = Number(r?.day);
    const subject = String(r?.subject || '').trim();
    if (!day || day < 1 || day > 7 || !subject) continue;

    let p = null;
    if (r.period != null && r.period !== '') p = ps.find(x => Number(x.n) === Number(r.period)) || null;
    if (!p && r.start) {
      const target = minutes(String(r.start));
      p = ps.reduce((a, x) => Math.abs(minutes(x.start) - target) < Math.abs(minutes(a.start) - target) ? x : a, ps[0]);
    }
    if (!p) continue;

    const week = ['a', 'b'].includes(String(r.week).toLowerCase()) ? String(r.week).toLowerCase() : 'all';
    out.push({
      day, start: p.start, end: p.end, title: subject,
      room: String(r.room || '').trim(), teacher: String(r.teacher || '').trim(),
      count: 1, everyWeek: week === 'all', weekParity: week,
    });
  }
  return out.sort((a, b) => (a.day - b.day) || a.start.localeCompare(b.start));
}

/* ─── Periods editor ───────────────────────────────────────────── */
async function editPeriods() {
  const draw = list => `
    <p class="dim mb-4" style="font-size:13px">These are the times your school rings the bell. Everything
      else — the timetable, free time, what is on now — is worked out from them.</p>
    <div class="periodgrid">
      <div class="periodgrid__head"><span>Period</span><span>Starts</span><span>Ends</span><span></span></div>
      ${list.map(p => `<div class="periodrow" data-pn="${p.n}">
        <span class="periodrow__n">${p.n}.</span>
        <input class="input" type="time" value="${esc(p.start || '')}" data-start="${p.n}" />
        <input class="input" type="time" value="${esc(p.end || '')}" data-end="${p.n}" />
        <button class="icon-btn icon-btn--sm icon-btn--danger" data-drop="${p.n}" title="Remove">${icon('trash')}</button>
      </div>`).join('')}
    </div>
    <div class="row gap-2 mt-4 row--wrap">
      <button class="btn btn--sm" data-add>${icon('plus')}Add a period</button>
      <button class="btn btn--sm btn--ghost" data-reset>${icon('refresh')}Czech standard</button>
    </div>`;

  let list = periods().map(p => ({ ...p }));

  const rewire = body => {
    body.querySelector('[data-add]').onclick = () => {
      const last = list.at(-1);
      const n = last ? Number(last.n) + 1 : 1;
      list.push({ n, start: '', end: '' });
      body.innerHTML = draw(list); rewire(body);
    };
    body.querySelector('[data-reset]').onclick = () => {
      list = DEFAULT_PERIODS.map(p => ({ ...p }));
      body.innerHTML = draw(list); rewire(body);
    };
    body.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
      list = list.filter(p => String(p.n) !== b.dataset.drop);
      body.innerHTML = draw(list); rewire(body);
    });
    body.querySelectorAll('[data-start],[data-end]').forEach(inp => {
      inp.oninput = () => {
        const n = inp.dataset.start ?? inp.dataset.end;
        const row = list.find(p => String(p.n) === String(n));
        if (row) row[inp.dataset.start ? 'start' : 'end'] = inp.value;
      };
    });
  };

  modal.open({
    title: 'Lesson times', size: 'wide', body: draw(list),
    footer: `<div class="grow"></div>
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--primary" data-act="save">Save times</button>`,
    onMount: (body, foot) => {
      rewire(body);
      foot.querySelector('[data-act=cancel]').onclick = () => modal.close();
      foot.querySelector('[data-act=save]').onclick = () => {
        const clean = list
          .filter(p => p.start && p.end)
          .map(p => ({ n: Number(p.n), start: p.start, end: p.end }))
          .sort((a, b) => minutes(a.start) - minutes(b.start));
        if (!clean.length) { toast('Give at least one period a start and an end', 'warn'); return; }
        const bad = clean.find(p => minutes(p.end) <= minutes(p.start));
        if (bad) { toast(`Period ${bad.n} ends before it starts`, 'warn'); return; }
        store.setSetting('school.periods', clean);
        modal.close();
        toast('Lesson times saved', 'ok');
        render();
      };
    },
  });
}

/* ═══ View ═══ */
registerView('school', {
  title: 'School', icon: 'graduation', group: 'Do', order: 45,
  desc: 'Your timetable, subjects and next lesson',
  keywords: ['school', 'timetable', 'rozvrh', 'lessons', 'skolaonline', 'škola', 'subjects', 'class'],
  badge: () => { const n = todayLessons().length; return n || null; },

  render(p) {
    const tab = p.tab || 'week';
    const parity = p.week || weekParity();
    const cfg = schoolCfg();
    const ls = lessons();

    const viewing = tab === 'week' && lessons().some(l => l.week && l.week !== 'all')
      ? `Showing ${parityLabel(parity)}${parity === weekParity() ? ' — this week' : ''}`
      : parityLabel(weekParity()) + ' this week';
    const head = pageHead('School', ls.length
      ? `${plural(ls.length, 'lesson')} · ${plural(subjects().length, 'subject')} · ${viewing}`
      : 'Your timetable lives here', `
      <div class="seg">
        <button class="${tab === 'week' ? 'is-on' : ''}" data-stab="week">${icon('grid')}<span class="hide-sm">Week</span></button>
        <button class="${tab === 'today' ? 'is-on' : ''}" data-stab="today">${icon('zap')}<span class="hide-sm">Today</span></button>
        <button class="${tab === 'subjects' ? 'is-on' : ''}" data-stab="subjects">${icon('book')}<span class="hide-sm">Subjects</span></button>
      </div>
      <button class="btn" data-import>${icon('upload')}<span class="hide-sm">Import</span></button>
      <button class="btn btn--primary" data-new-lesson>${icon('plus')}<span class="hide-sm">Lesson</span></button>`, 'graduation');

    if (!ls.length) return head + importIntro();

    if (tab === 'today') return head + todayHtml();
    if (tab === 'subjects') return head + subjectsHtml();
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches;
    return head + (phone ? dayStripHtml(parity, cfg, p) : weekHtml(parity, cfg));
  },

  onMount(root) {
    on(root, 'click', '[data-stab]', (e, el) => navigate('school', { ...params(), tab: el.dataset.stab }));
    on(root, 'click', '[data-new-lesson]', () => newLesson());
    on(root, 'click', '[data-import]', e => contextMenu(e, [
      ...(_ai ? [{ label: 'Read a photo of my timetable', icon: 'image', action: photoImport }] : []),
      { label: 'Import a calendar file (.ics)', icon: 'calendar', action: importICS },
      { label: 'Paste my timetable', icon: 'copy', action: importPaste },
      '-',
      { label: 'Set lesson times', icon: 'clock', action: editPeriods },
      { label: 'How do I get the file?', icon: 'info', action: howToExport },
    ]));
    on(root, 'click', '[data-photo]', photoImport);
    on(root, 'click', '[data-ics]', importICS);
    ensureAI().then(ai => { if (ai) root.querySelector('[data-ai-card]')?.removeAttribute('hidden'); });
    on(root, 'click', '[data-paste]', importPaste);
    on(root, 'click', '[data-howto]', howToExport);
    on(root, 'click', '[data-periods]', editPeriods);
    on(root, 'click', '[data-lesson]', (e, el) => editLesson(el.dataset.lesson));
    on(root, 'click', '[data-cell]', (e, el) => {
      if (e.target.closest('[data-lesson]')) return;
      const [day, period] = el.dataset.cell.split('-').map(Number);
      newLesson({ day, period });
    });
    on(root, 'click', '[data-week]', (e, el) => navigate('school', { ...params(), week: el.dataset.week }));
    on(root, 'click', '[data-day]', (e, el) => navigate('school', { ...params(), d: el.dataset.day }));

    // swipe across the day, the way a calendar app does
    const swipe = root.querySelector('[data-swipe]');
    if (swipe) {
      let x0 = null, y0 = null;
      swipe.addEventListener('touchstart', ev => {
        const t = ev.changedTouches[0]; x0 = t.clientX; y0 = t.clientY;
      }, { passive: true });
      swipe.addEventListener('touchend', ev => {
        if (x0 == null) return;
        const t = ev.changedTouches[0];
        const dx = t.clientX - x0, dy = t.clientY - y0;
        x0 = null;
        if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;  // a scroll, not a swipe
        const cfg2 = schoolCfg();
        const days = DAYS.slice(0, cfg2.days || 5).map(d => d.n);
        const cur = Number(params().d) || (days.includes(new Date().getDay()) ? new Date().getDay() : days[0]);
        const i = days.indexOf(cur);
        const next = days[Math.min(days.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))];
        if (next !== cur) navigate('school', { ...params(), d: next });
      }, { passive: true });
    }
    on(root, 'click', '[data-hw]', (e, el) => {
      const l = store.find('lessons', el.dataset.hw);
      const subj = subjectOf(l?.subjectId);
      import('./tasks.js').then(m => m.newTask({ title: '', tags: [subj?.short?.toLowerCase() || 'school'] }));
    });
    on(root, 'click', '[data-subj]', (e, el) => editSubject(el.dataset.subj));
  },
});

/* ─── Renderers ─── */
function importIntro() {
  return `
    <div class="addways">
      <button class="addway addway--hero" data-photo hidden data-ai-card>
        <span class="addway__ic">${icon('image', 'ic ic--lg')}</span>
        <span class="addway__txt">
          <strong>Photograph your timetable</strong>
          <small>Point your camera at the paper or the screen. It gets read and filled in for you —
            subjects, rooms, periods and all.</small>
        </span>
        <span class="chip chip--accent addway__tag">Fastest</span>
      </button>

      <button class="addway" data-ics>
        <span class="addway__ic">${icon('calendar', 'ic ic--lg')}</span>
        <span class="addway__txt">
          <strong>Import a calendar file</strong>
          <small>Export <code>.ics</code> from ŠkolaOnline or Bakaláři. Carries teachers and
            alternating weeks exactly.</small>
        </span>
        <span class="chip addway__tag">Most exact</span>
      </button>

      <button class="addway" data-paste>
        <span class="addway__ic">${icon('copy', 'ic ic--lg')}</span>
        <span class="addway__txt">
          <strong>Paste it in</strong>
          <small>Copy the timetable off the page and paste the text.</small>
        </span>
      </button>

      <button class="addway" data-new-lesson>
        <span class="addway__ic">${icon('plus', 'ic ic--lg')}</span>
        <span class="addway__txt">
          <strong>Type it in</strong>
          <small>A week takes about five minutes and is always right.</small>
        </span>
      </button>
    </div>

    <div class="row gap-2 mt-4 row--wrap" style="justify-content:center">
      <button class="btn btn--ghost btn--sm" data-periods>${icon('clock')}Set lesson times</button>
      <button class="btn btn--ghost btn--sm" data-howto>${icon('info')}Why not connect to ŠkolaOnline directly?</button>
    </div>`;
}

/** Phone layout: a day picker and that day as a vertical timeline. */
function dayStripHtml(parity, cfg, p) {
  const days = DAYS.slice(0, cfg.days || 5);
  const todayNum = new Date().getDay();
  const pick = Number(p.d) || (days.some(d => d.n === todayNum) ? todayNum : days[0].n);
  const hasAB = lessons().some(l => l.week && l.week !== 'all');
  const ps = periods();
  const list = lessonsOn(pick, parity);

  const shape = dayShape(pick, parity);
  const rows = shape.line.map(item => {
    if (item.type === 'free') return freeRow(item);
    const l = item;
    const sub = subjectOf(l.subjectId);
    return `<button class="dayrow" data-lesson="${l.id}" style="--sc:${esc(sub?.color || 'var(--accent)')}">
      <span class="dayrow__time"><strong>${esc(l.startStr)}</strong><small>${esc(l.endStr)}</small></span>
      <span class="dayrow__badge">${esc(sub?.short || '?')}</span>
      <span class="dayrow__main">
        <strong>${esc(sub?.name || 'Lesson')}</strong>
        <small>${[l.room || sub?.room, l.teacher || sub?.teacher, l.span > 1 ? `${l.span} periods` : '']
          .filter(Boolean).map(esc).join(' · ') || `Period ${l.period}`}</small>
      </span>
      <span class="dayrow__per">${l.period}.</span>
    </button>`;
  }).join('');

  return `${hasAB ? `<div class="filterbar">
      <div class="seg grow" data-weekpick>
        <button class="${parity === 'a' ? 'is-on' : ''}" data-week="a">Week A</button>
        <button class="${parity === 'b' ? 'is-on' : ''}" data-week="b">Week B</button>
      </div>
      ${parity === weekParity() ? '<span class="chip chip--accent">now</span>' : ''}
    </div>` : ''}

    <div class="daystrip" data-daystrip>
      ${days.map(d => {
        // count periods, not records — a four-period block is four periods at school
        const n = lessonsOn(d.n, parity).reduce((a, l) => a + Math.max(1, Number(l.span) || 1), 0);
        return `<button class="daychip ${d.n === pick ? 'is-on' : ''} ${d.n === todayNum ? 'is-today' : ''}"
          data-day="${d.n}">
          <span class="daychip__d">${esc(d.cs.slice(0, 2))}</span>
          <span class="daychip__n">${n || '–'}</span>
        </button>`;
      }).join('')}
    </div>

    ${list.length ? `<div class="dayfacts">
      <span>${icon('clock', 'ic ic--sm')}${esc(shape.firstIn)}–${esc(shape.lastOut)}</span>
      <span>${icon('graduation', 'ic ic--sm')}${plural(
        shape.lessons.reduce((a, l) => a + Math.max(1, Number(l.span) || 1), 0), 'period')}</span>
      ${shape.freeMins ? `<span class="dayfacts__free">${icon('coffee', 'ic ic--sm')}${fmtMins(shape.freeMins)} free</span>`
        : `<span class="dim">no gaps</span>`}
    </div>` : ''}

    <div class="card" data-swipe>
      ${list.length ? `<div class="dayrows">${rows}</div>`
        : emptyState('coffee', 'Nothing on', `${DAYS.find(d => d.n === pick)?.cs} is free in ${parityLabel(parity).replace('Week ', 'week ')}.`)}
    </div>
    <p class="dim tc mt-3" style="font-size:11.6px">Swipe left or right to change day</p>`;
}

/** An empty stretch between two lessons. */
function freeRow(f) {
  const label = f.periodNums.length === 1
    ? `Period ${f.periodNums[0]} free`
    : `Periods ${f.periodNums[0]}–${f.periodNums.at(-1)} free`;
  return `<div class="freerow">
    <span class="freerow__time"><strong>${esc(f.startStr)}</strong><small>${esc(f.endStr)}</small></span>
    <span class="freerow__body">
      <strong>${esc(fmtMins(f.mins))} free</strong>
      <small>${esc(label)}</small>
    </span>
    ${icon('coffee', 'ic ic--sm')}
  </div>`;
}

function weekHtml(parity, cfg) {
  const ps = periods();
  const days = DAYS.slice(0, cfg.days || 5);
  const used = ps.filter(p => lessons().some(l => Number(l.period) === Number(p.n)));
  const show = used.length ? ps.filter(p => Number(p.n) >= Math.min(...used.map(u => u.n)) && Number(p.n) <= Math.max(...used.map(u => u.n))) : ps.slice(1, 8);
  const hasAB = lessons().some(l => l.week && l.week !== 'all');
  const todayNum = new Date().getDay();
  // Labelling every cell "A" on the Week A tab says nothing. Mark the smaller
  // group instead: in a mostly-alternating timetable the every-week lessons
  // are the news, and vice versa.
  const shown = days.flatMap(d => lessonsOn(d.n, parity));
  const everyCount = shown.filter(l => !l.week || l.week === 'all').length;
  const markEveryWeek = everyCount <= shown.length - everyCount;

  return `${hasAB ? `<div class="filterbar">
      <div class="seg" data-weekpick>
        <button class="${parity === 'a' ? 'is-on' : ''}" data-week="a">Week A (odd)</button>
        <button class="${parity === 'b' ? 'is-on' : ''}" data-week="b">Week B (even)</button>
      </div>
      <span class="chip chip--accent">This week is ${parityLabel(weekParity()).replace('Week ', '')}</span>
      <div class="grow"></div>
      <button class="btn btn--sm" data-periods>${icon('clock')}Lesson times</button>
    </div>` : `<div class="filterbar"><div class="grow"></div>
      <button class="btn btn--sm" data-periods>${icon('clock')}Lesson times</button></div>`}

    <div class="card"><div class="table__wrap"><table class="table timetable">
      <thead><tr>
        <th class="tt__ph">Period</th>
        ${days.map(d => `<th class="${d.n === todayNum ? 'is-today' : ''}">
          <span class="tt__day">${esc(d.cs)}</span><span class="tt__dayen">${esc(d.en)}</span></th>`).join('')}
      </tr></thead>
      <tbody>
        ${(() => {
          // a block lesson occupies the rows below it, which must not be drawn
          const covered = new Set();
          // an empty slot between a day's first and last lesson is free time,
          // not just an unused row — worth seeing at a glance
          const free = new Set();
          for (const d of days) {
            const busy = new Set();
            for (const l of lessonsOn(d.n, parity)) {
              const from = show.findIndex(x => Number(x.n) === Number(l.period));
              if (from < 0) continue;
              for (let k = 0; k < Math.max(1, Number(l.span) || 1) && from + k < show.length; k++) busy.add(from + k);
            }
            if (busy.size) {
              const lo = Math.min(...busy), hi = Math.max(...busy);
              for (let k = lo + 1; k < hi; k++) if (!busy.has(k)) free.add(`${d.n}-${show[k].n}`);
            }
          }
          for (const d of days) {
            for (const l of lessonsOn(d.n, parity)) {
              const span = Math.max(1, Number(l.span) || 1);
              const from = show.findIndex(x => Number(x.n) === Number(l.period));
              if (from < 0) continue;
              for (let k = 1; k < span && from + k < show.length; k++) covered.add(`${d.n}-${show[from + k].n}`);
            }
          }
          return show.map(p => `<tr>
            <th class="tt__ph"><strong>${p.n}.</strong><small>${esc(p.start)}<br/>${esc(p.end)}</small></th>
            ${days.map(d => {
              if (covered.has(`${d.n}-${p.n}`)) return '';
              const here = lessonsOn(d.n, parity).filter(l => Number(l.period) === Number(p.n));
              const span = Math.max(1, ...here.map(l => Number(l.span) || 1));
              const rows = Math.min(span, show.length - show.findIndex(x => Number(x.n) === Number(p.n)));
              const isFree = !here.length && free.has(`${d.n}-${p.n}`);
              return `<td class="tt__cell ${d.n === todayNum ? 'is-today' : ''} ${rows > 1 ? 'tt__cell--block' : ''} ${isFree ? 'is-free' : ''}"
                ${rows > 1 ? `rowspan="${rows}"` : ''} data-cell="${d.n}-${p.n}"
                ${isFree ? `title="Free — ${p.start}–${p.end}"` : ''}>
                ${here.map(l => {
                  const s = subjectOf(l.subjectId);
                  const n = Math.max(1, Number(l.span) || 1);
                  return `<button class="tt__lesson ${n > 1 ? 'is-block' : ''}" data-lesson="${l.id}"
                    style="--sc:${esc(s?.color || 'var(--accent)')}">
                    <strong>${esc(s?.short || s?.name || '?')}</strong>
                    <small>${esc(l.room || s?.room || '')}</small>
                    ${n > 1 ? `<em class="tt__span">${n} periods</em>` : ''}
                    ${hasAB && (markEveryWeek
                      ? (!l.week || l.week === 'all') && '<i class="tt__ab tt__ab--both" title="Runs in both weeks">=</i>'
                      : l.week && l.week !== 'all' && `<i class="tt__ab">${l.week.toUpperCase()}</i>`) || ''}
                  </button>`;
                }).join('') || (isFree ? '<span class="tt__free">free</span>' : '<span class="tt__empty">+</span>')}
              </td>`;
            }).join('')}
          </tr>`).join('');
        })()}
      </tbody>
    </table></div></div>`;
}

function todayHtml() {
  const { current, next, all } = currentAndNext();
  const d = new Date();
  const shape = dayShape(d.getDay());
  if (!all.length) return `<div class="card">${emptyState('coffee', 'No lessons today',
    `${dayName(d)} is clear. Enjoy it.`)}</div>`;

  const last = all.at(-1);
  const done = all.filter(l => nowMins() >= l.end).length;

  return `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Lessons today', value: all.length, sub: `${done} finished`, icon: 'graduation', tone: 'info' })}
      ${statTile({ label: 'Now', value: current ? esc(subjectOf(current.subjectId)?.short || '—') : '—',
        sub: current ? `until ${current.endStr}` : 'free right now', icon: 'clock', tone: current ? 'ok' : '' })}
      ${statTile({ label: 'Next', value: next ? esc(subjectOf(next.subjectId)?.short || '—') : '—',
        sub: next ? `at ${next.startStr}${next.room ? ` · ${next.room}` : ''}` : 'nothing left today', icon: 'arrowRight', tone: 'warn' })}
      ${statTile({ label: 'Free today', value: shape.freeMins ? fmtMins(shape.freeMins) : 'none',
        sub: shape.longest ? `longest ${fmtMins(shape.longest.mins)} at ${shape.longest.startStr}` : `home at ${last?.endStr || '—'}`,
        icon: 'coffee', tone: shape.freeMins ? 'warn' : '' })}
    </div>

    <div class="card"><div class="card__head">${icon('list')}<h3>${esc(dayName(d))}</h3>
      <span class="chip">${esc(parityLabel(weekParity()))}</span></div>
      <div class="list">
        ${shape.line.map(item => {
          if (item.type === 'free') {
            const soon = nowMins() < item.end && nowMins() >= item.start;
            return `<div class="list__row freerow ${soon ? 'is-now' : ''}">
              <span class="freerow__time"><strong>${esc(item.startStr)}</strong><small>${esc(item.endStr)}</small></span>
              <span class="freerow__body">
                <strong>${esc(fmtMins(item.mins))} free${soon ? ' — right now' : ''}</strong>
                <small>${item.periodNums.length === 1 ? `Period ${item.periodNums[0]}`
                  : `Periods ${item.periodNums[0]}–${item.periodNums.at(-1)}`} · nothing scheduled</small>
              </span>
              ${icon('coffee', 'ic ic--sm')}
            </div>`;
          }
          const l = item;
          const sub = subjectOf(l.subjectId);
          const isNow = current && current.id === l.id;
          const past = nowMins() >= l.end;
          return `<button class="list__row list__row--btn tt__row ${isNow ? 'is-now' : ''} ${past ? 'is-past' : ''}"
            data-lesson="${l.id}" style="--sc:${esc(sub?.color || 'var(--accent)')}">
            <span class="tt__time"><strong>${esc(l.startStr)}</strong><small>${esc(l.endStr)}</small></span>
            <span class="tt__badge">${esc(sub?.short || '?')}</span>
            <div class="list__main">
              <div class="list__title">${esc(sub?.name || 'Lesson')}${isNow ? ' <span class="chip chip--ok">now</span>' : ''}</div>
              <div class="list__sub">${l.room || sub?.room ? `${icon('compass', 'ic ic--sm')}${esc(l.room || sub.room)}` : ''}
                ${l.teacher || sub?.teacher ? `· ${esc(l.teacher || sub.teacher)}` : ''}
                ${l.note ? `· ${esc(l.note)}` : ''}</div>
            </div>
            <span class="dim" style="font-size:11.5px">${l.period}.</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
}

function subjectsHtml() {
  const list = [...subjects()].sort(by('name'));
  if (!list.length) return `<div class="card">${emptyState('book', 'No subjects yet',
    'They appear automatically as you add lessons.')}</div>`;
  return `<div class="grid grid--3">${list.map(s => {
    const count = lessons().filter(l => l.subjectId === s.id).length;
    return `<button class="card card--pad card--hover subj-card" data-subj="${s.id}" style="--sc:${esc(s.color)}">
      <span class="subj-card__badge">${esc(s.short || abbreviate(s.name))}</span>
      <h3>${esc(s.name)}</h3>
      <p class="dim">${plural(count, 'lesson')} a week${s.teacher ? ` · ${esc(s.teacher)}` : ''}${s.room ? ` · ${esc(s.room)}` : ''}</p>
    </button>`;
  }).join('')}</div>`;
}

async function editSubject(id) {
  const s = subjectOf(id);
  if (!s) return;
  const v = await openForm({
    title: `Subject · ${s.name}`, submitLabel: 'Save',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, value: s.name },
      { name: 'short', label: 'Short code', type: 'text', half: true, value: s.short },
      { name: 'color', label: 'Colour', type: 'color', value: s.color },
      { name: 'teacher', label: 'Teacher', type: 'text', half: true, value: s.teacher },
      { name: 'room', label: 'Usual room', type: 'text', half: true, value: s.room },
    ],
  });
  if (!v) return;
  store.update('subjects', id, v);
  toast('Subject updated', 'ok');
  render();
}

function howToExport() {
  modal.open({
    title: 'Getting your timetable in', size: '',
    body: `<div class="md" style="font-size:13.4px">
      <p><strong>Photographing it is the quickest way</strong> — no export, no login, no hunting through
        menus. Take a clear, straight-on shot and it gets read for you.</p>
      <p>If you would rather have it exact, look for whichever of these your school offers:</p>
      <ol>
        <li><strong>Calendar export</strong> — <em>Kalendář</em>, then <em>Export</em>, <em>iCal</em> or
          <em>Publikovat</em>. That gives an <code>.ics</code> file carrying rooms, teachers and
          alternating weeks precisely.</li>
        <li><strong>Print / PDF</strong> (<em>Rozvrh → Tisk</em>), then copy the text out and paste it.</li>
      </ol>
      <h3>Why can't it just log in?</h3>
      <p>Two reasons, neither of which a password would solve. GabikOS has no server — it is only files in
        your browser, so there is nowhere safe to keep a login. And browsers deliberately stop one website
        from reading another's private pages; that rule is enforced by Safari itself, not by this app.</p>
      <p>So a photo or an export is not a workaround — it is the only honest way to do it without handing
        your school account to a third party.</p>
      <blockquote><p>Either way it is a snapshot. When the timetable changes, do it again and tick
        <em>Replace my current timetable</em>.</p></blockquote>
    </div>`,
    footer: `<div class="grow"></div><button class="btn btn--primary" data-ok>Got it</button>`,
    onMount: (_b, foot) => { foot.querySelector('[data-ok]').onclick = () => modal.close(); },
  });
}
