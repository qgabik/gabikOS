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
import { esc, uid, today, iso, parseISO, dayName, plural, by, colorFor, pickFile, truncate } from '../core/util.js';
import { parseICS, toWeeklySlots, isoWeek } from '../core/ics.js';

/* ─── Period times: the layout most Czech schools use ─── */
export const DEFAULT_PERIODS = [
  { n: 0, start: '07:05', end: '07:50' }, { n: 1, start: '08:00', end: '08:45' },
  { n: 2, start: '08:55', end: '09:40' }, { n: 3, start: '10:00', end: '10:45' },
  { n: 4, start: '10:55', end: '11:40' }, { n: 5, start: '11:50', end: '12:35' },
  { n: 6, start: '12:45', end: '13:30' }, { n: 7, start: '13:40', end: '14:25' },
  { n: 8, start: '14:35', end: '15:20' }, { n: 9, start: '15:30', end: '16:15' },
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
  const timed = list.map(l => {
    const p = periods().find(x => Number(x.n) === Number(l.period));
    return { ...l, start: minutes(p?.start), end: minutes(p?.end), startStr: p?.start, endStr: p?.end };
  }).filter(l => !isNaN(l.start));
  const current = timed.find(l => now >= l.start && now < l.end) || null;
  const next = timed.find(l => l.start > now) || null;
  return { current, next, all: timed };
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
    if (Object.keys(patch).length) store.update('subjects', found.id, patch);
    return found.id;
  }
  const rec = store.add('subjects', {
    name: clean,
    short: short || abbreviate(clean),
    teacher: teacher || '',
    room: room || '',
    color: color || colorFor(clean),
  });
  return rec.id;
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
  { name: 'week', label: 'Which weeks', type: 'select', value: l.week || 'all',
    options: [{ value: 'all', label: 'Every week' }, { value: 'a', label: 'Odd weeks only (A)' }, { value: 'b', label: 'Even weeks only (B)' }] },
  { name: 'note', label: 'Note', type: 'text', value: l.note, placeholder: 'optional' },
];

export async function newLesson(preset = {}) {
  const v = await openForm({ title: 'Add lesson', size: 'wide', fields: lessonFields(preset), submitLabel: 'Add' });
  if (!v) return;
  const subjectId = ensureSubject(v.subject, { teacher: v.teacher, room: v.room });
  store.add('lessons', { day: Number(v.day), period: Number(v.period), subjectId,
    teacher: v.teacher, room: v.room, week: v.week, note: v.note });
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
    teacher: v.teacher, room: v.room, week: v.week, note: v.note });
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
    const subjectId = ensureSubject(slot.title, { teacher: slot.teacher, room: slot.room });
    const dup = lessons().some(l => l.day === slot.day && Number(l.period) === Number(best.n) && l.subjectId === subjectId);
    if (dup) { skipped++; continue; }
    store.add('lessons', {
      day: slot.day, period: best.n, subjectId,
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

function previewImport(slots, source) {
  modal.open({
    title: 'Review before importing', size: 'wide',
    body: `<p class="dim mb-4" style="font-size:13px">Found <strong>${plural(slots.length, 'lesson')}</strong>
      in ${esc(truncate(source, 40))}. Times are matched to your period numbers. Untick anything you do not want.</p>
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
        modal.close();
        if (!picked.length) { toast('Nothing selected', 'warn'); return; }
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

/* ─── Periods editor ─── */
async function editPeriods() {
  const cur = periods();
  const v = await openForm({
    title: 'Lesson times', size: 'wide', submitLabel: 'Save times',
    fields: cur.map(p => ({ name: `p${p.n}`, label: `Period ${p.n}`, type: 'text', half: true,
      value: `${p.start}-${p.end}`, placeholder: '08:00-08:45' })),
    validate: vals => {
      for (const [k, val] of Object.entries(vals)) {
        if (val && !/^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/.test(val)) return `"${val}" should look like 08:00-08:45`;
      }
      return null;
    },
  });
  if (!v) return;
  const next = cur.map(p => {
    const raw = v[`p${p.n}`];
    if (!raw) return p;
    const [start, end] = raw.split(/\s*[-–]\s*/);
    return { n: p.n, start: start.trim(), end: end.trim() };
  });
  store.setSetting('school.periods', next);
  toast('Lesson times saved', 'ok');
  render();
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

    const head = pageHead('School', ls.length
      ? `${plural(ls.length, 'lesson')} · ${plural(subjects().length, 'subject')} · ${parityLabel(weekParity())}`
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
    return head + weekHtml(parity, cfg);
  },

  onMount(root) {
    on(root, 'click', '[data-stab]', (e, el) => navigate('school', { ...params(), tab: el.dataset.stab }));
    on(root, 'click', '[data-new-lesson]', () => newLesson());
    on(root, 'click', '[data-import]', e => contextMenu(e, [
      { label: 'Import a calendar file (.ics)', icon: 'calendar', action: importICS },
      { label: 'Paste my timetable', icon: 'copy', action: importPaste },
      '-',
      { label: 'Set lesson times', icon: 'clock', action: editPeriods },
      { label: 'How do I get the file?', icon: 'info', action: howToExport },
    ]));
    on(root, 'click', '[data-ics]', importICS);
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
  return `<div class="card card--pad mb-4 callout">
      <div class="row gap-3">
        <span class="stat__icon">${icon('info')}</span>
        <div>
          <h3>About linking ŠkolaOnline directly</h3>
          <p class="dim mt-2" style="font-size:13.2px">GabikOS cannot log into ŠkolaOnline for you. It has no
          server to hold a password, and browsers block one website from reading another's private pages.
          What works instead is an export: most schools offer a calendar file, and that carries your whole
          timetable — subjects, rooms, teachers and times.</p>
        </div>
      </div>
    </div>
    <div class="grid grid--3">
      <button class="card card--pad card--hover import-card" data-ics>
        <span class="import-card__ic">${icon('calendar', 'ic ic--lg')}</span>
        <h3>Import a calendar file</h3>
        <p class="dim">Export <code>.ics</code> from ŠkolaOnline, Bakaláři or Google Calendar and drop it in.
          Subjects, rooms, teachers and alternating weeks all come across.</p>
        <span class="chip chip--accent mt-3">Best result</span>
      </button>
      <button class="card card--pad card--hover import-card" data-paste>
        <span class="import-card__ic">${icon('copy', 'ic ic--lg')}</span>
        <h3>Paste it in</h3>
        <p class="dim">Copy the timetable off the page and paste it. It reads day, period, subject and room
          as best it can — you fix the rest in the grid.</p>
      </button>
      <button class="card card--pad card--hover import-card" data-new-lesson>
        <span class="import-card__ic">${icon('plus', 'ic ic--lg')}</span>
        <h3>Type it once</h3>
        <p class="dim">Thirty lessons takes about five minutes, and then it is exactly right and never
          goes stale.</p>
      </button>
    </div>
    <div class="row gap-2 mt-4">
      <button class="btn btn--ghost btn--sm" data-howto>${icon('info')}Where is the export in ŠkolaOnline?</button>
      <button class="btn btn--ghost btn--sm" data-periods>${icon('clock')}Set lesson times</button>
    </div>`;
}

function weekHtml(parity, cfg) {
  const ps = periods();
  const days = DAYS.slice(0, cfg.days || 5);
  const used = ps.filter(p => lessons().some(l => Number(l.period) === Number(p.n)));
  const show = used.length ? ps.filter(p => Number(p.n) >= Math.min(...used.map(u => u.n)) && Number(p.n) <= Math.max(...used.map(u => u.n))) : ps.slice(1, 8);
  const hasAB = lessons().some(l => l.week && l.week !== 'all');
  const todayNum = new Date().getDay();

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
        ${show.map(p => `<tr>
          <th class="tt__ph"><strong>${p.n}.</strong><small>${esc(p.start)}<br/>${esc(p.end)}</small></th>
          ${days.map(d => {
            const here = lessonsOn(d.n, parity).filter(l => Number(l.period) === Number(p.n));
            return `<td class="tt__cell ${d.n === todayNum ? 'is-today' : ''}" data-cell="${d.n}-${p.n}">
              ${here.map(l => {
                const s = subjectOf(l.subjectId);
                return `<button class="tt__lesson" data-lesson="${l.id}" style="--sc:${esc(s?.color || 'var(--accent)')}">
                  <strong>${esc(s?.short || s?.name || '?')}</strong>
                  <small>${esc(l.room || s?.room || '')}</small>
                  ${l.week && l.week !== 'all' ? `<i class="tt__ab">${l.week.toUpperCase()}</i>` : ''}
                </button>`;
              }).join('') || '<span class="tt__empty">+</span>'}
            </td>`;
          }).join('')}
        </tr>`).join('')}
      </tbody>
    </table></div></div>`;
}

function todayHtml() {
  const { current, next, all } = currentAndNext();
  const d = new Date();
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
      ${statTile({ label: 'Home at', value: esc(last?.endStr || '—'), sub: `after ${plural(all.length, 'lesson')}`, icon: 'home' })}
    </div>

    <div class="card"><div class="card__head">${icon('list')}<h3>${esc(dayName(d))}</h3>
      <span class="chip">${esc(parityLabel(weekParity()))}</span></div>
      <div class="list">
        ${all.map(l => {
          const s = subjectOf(l.subjectId);
          const isNow = current && current.id === l.id;
          const past = nowMins() >= l.end;
          return `<button class="list__row list__row--btn tt__row ${isNow ? 'is-now' : ''} ${past ? 'is-past' : ''}"
            data-lesson="${l.id}" style="--sc:${esc(s?.color || 'var(--accent)')}">
            <span class="tt__time"><strong>${esc(l.startStr)}</strong><small>${esc(l.endStr)}</small></span>
            <span class="tt__badge">${esc(s?.short || '?')}</span>
            <div class="list__main">
              <div class="list__title">${esc(s?.name || 'Lesson')}${isNow ? ' <span class="chip chip--ok">now</span>' : ''}</div>
              <div class="list__sub">${l.room || s?.room ? `${icon('compass', 'ic ic--sm')}${esc(l.room || s.room)}` : ''}
                ${l.teacher || s?.teacher ? `· ${esc(l.teacher || s.teacher)}` : ''}
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
    title: 'Getting your timetable out of ŠkolaOnline', size: '',
    body: `<div class="md" style="font-size:13.4px">
      <p>Systems differ between schools, so look for whichever of these your account has:</p>
      <ol>
        <li><strong>Calendar export</strong> — look for <em>Kalendář</em>, then an <em>Export</em>,
          <em>iCal</em> or <em>Publikovat</em> option. That produces an <code>.ics</code> file: the best
          result, since it carries rooms, teachers and alternating weeks.</li>
        <li><strong>Print / PDF the timetable</strong> (<em>Rozvrh → Tisk</em>) — then copy the text out
          of the PDF and use <em>Paste my timetable</em>.</li>
        <li><strong>Select the table on screen</strong> and copy it, then paste it in the same way.</li>
      </ol>
      <p>If your school's ŠkolaOnline offers none of these, typing a week in by hand takes about five
        minutes and never expires. Click any empty square in the grid to fill it.</p>
      <blockquote><p>A calendar export is a file — it is a snapshot, not a live link. If your school
        changes the timetable, export again and tick <em>Replace my current timetable</em>.</p></blockquote>
    </div>`,
    footer: `<div class="grow"></div><button class="btn btn--primary" data-ok>Got it</button>`,
    onMount: (_b, foot) => { foot.querySelector('[data-ok]').onclick = () => modal.close(); },
  });
}
