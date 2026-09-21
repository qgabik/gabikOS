/* ═══════════════════════════════════════════════════════════════
   GabikOS — Health: sleep, steps, training, body

   Steps and sleep come from the iPhone through the Apple Health
   bridge (core/health-link.js). Anything typed by hand outranks them:
   a reading the phone sends never overwrites a number you set
   yourself, it only fills what is still empty.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, refreshIf } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, statTile, modal } from '../core/ui.js';
import { esc, today, addDaysISO, fmtDate, fmtMins, by, sum, avg, round, pct, clamp,
         plural, dayName, parseISO, download, pickFile } from '../core/util.js';
import { lineChart, barChart } from '../core/charts.js';
import { BUILD } from '../config.js';
import { readLink, stripLink, normalizeSample, minutesBetween, clockMins,
         healthKey, pullInbox, cloudReady, cloudRecipe, linkTemplate,
         parseAppleExport, parsePasted, diagnose, simpleLink, cloudPing, clearInbox } from '../core/health-link.js';

/* ─── Small formatters ─── */
const pad2 = n => String(n).padStart(2, '0');
const nowClock = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtSleep = mins => {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h}h ${pad2(m)}m` : `${m}m`;      // "28m short", not "0h 28m short"
};
const clockLabel = c => (c ? c : '—');
/** A night belongs to the morning it ends on, the way people tell it. */
const nightOf = (d = new Date()) => (d.getHours() >= 18 ? addDaysISO(today(), 1) : today());

/* ─── Daily metrics ─── */
export const metricFor = (date = today()) => S().metrics.find(m => m.date === date);

/** Sleep is kept in minutes; the old `sleep` hours field still reads. */
export function sleepMinsOf(m) {
  if (!m) return null;
  if (m.sleepMins != null) return m.sleepMins;
  if (m.bedtime && m.wake) return minutesBetween(m.bedtime, m.wake);
  if (m.sleep != null) return Math.round(m.sleep * 60);
  return null;
}

/** Keep the derived fields honest whatever route wrote the patch. */
function derive(next) {
  if (next.bedtime && next.wake && next.sleepMins == null) next.sleepMins = minutesBetween(next.bedtime, next.wake);
  if (next.sleepMins != null) next.sleep = round(next.sleepMins / 60, 2);
  else if (next.sleep != null && next.sleepMins == null) next.sleepMins = Math.round(next.sleep * 60);
  return next;
}

export function setMetric(patch, date = today()) {
  const existing = metricFor(date);
  if (existing) {
    const merged = derive({ ...existing, ...patch });
    store.update('metrics', existing.id, merged);
  } else {
    store.add('metrics', derive({ date, ...patch }));
  }
}

/** Mark the fields in a patch as typed by hand, so the phone leaves them be. */
function setManual(patch, date = today()) {
  const cur = metricFor(date) || {};
  const src = { ...(cur.src || {}) };
  const srcAt = { ...(cur.srcAt || {}) };
  const now = Date.now();
  for (const k of Object.keys(patch)) {
    if (patch[k] == null || patch[k] === '') continue;
    src[k] = 'manual';
    srcAt[k] = now;
  }
  setMetric({ ...patch, src, srcAt }, date);
}

export const waterToday = () => metricFor()?.water || 0;
export function addWater(n = 1) {
  const goal = settings().goals.water || 8;
  const next = clamp(waterToday() + n, 0, 30);
  setMetric({ water: next });
  if (next === goal) toast('Water goal reached 💧', 'ok');
  render();
}

/* ═══ Apple Health ingest ═════════════════════════════════════ */

const hs = () => settings().health || {};
const AUTO_FIELDS = {
  steps: 'steps', sleepMinutes: 'sleepMins', bedtime: 'bedtime', wake: 'wake',
  restingHr: 'restingHr', weight: 'weight', activeEnergy: 'activeEnergy',
  exerciseMinutes: 'exerciseMinutes',
};

/**
 * Fold readings into the daily metrics. A field you typed yourself is
 * never overwritten — the phone only fills the blanks and updates what
 * it wrote before.
 */
export function ingestSamples(samples, source = 'apple') {
  let days = 0, values = 0;
  for (const raw of samples || []) {
    const s = normalizeSample(raw);
    if (!s) continue;
    const cur = metricFor(s.date) || {};
    const src = { ...(cur.src || {}) };
    const srcAt = { ...(cur.srcAt || {}) };
    const at = Number(s.at) || Date.now();
    const patch = {};
    for (const [from, to] of Object.entries(AUTO_FIELDS)) {
      const v = s[from];
      if (v == null) continue;
      if (src[to] === 'manual' && cur[to] != null) continue;
      // Two sources write the same field: the Shortcut's link, and whatever
      // the cloud inbox still holds. Without this the older of the two wins
      // whenever it happens to be read last — a stale reading from this
      // morning would overwrite the count that just arrived.
      if (cur[to] != null && srcAt[to] && at < srcAt[to]) continue;
      if (cur[to] === v) { srcAt[to] = Math.max(srcAt[to] || 0, at); continue; }
      patch[to] = v;
      src[to] = source;
      srcAt[to] = at;
      values++;
    }
    if (!Object.keys(patch).length) continue;
    if (patch.sleepMins != null || patch.bedtime || patch.wake) patch.sleep = undefined;
    setMetric(derive({ ...cur, ...patch, src, srcAt }), s.date);
    days++;
  }
  if (days) {
    store.setSetting('health.lastAt', Date.now());
    store.setSetting('health.lastSource', source);
    store.setSetting('health.lastDays', days);
  }
  return { days, values };
}

/** Values handed over in the address bar by a Shortcut. Runs once, at boot. */
export function consumeHealthLink() {
  let samples = null;
  try { samples = readLink(); } catch { return null; }
  if (!samples) return null;                       // an ordinary link, nothing to do

  const res = ingestSamples(samples, 'apple');
  try { stripLink(); } catch { /* an old browser keeps the URL; harmless */ }

  if (res.days) {
    store.setSetting('health.linked', true);
    store.log('heart', `Apple Health · ${plural(res.days, 'day')} received`, 'health');
    const m = metricFor();
    res.message = m?.steps != null
      ? `${Number(m.steps).toLocaleString()} steps from Apple Health`
      : `Apple Health · ${plural(res.days, 'day')} updated`;
    res.tone = 'ok';
  } else {
    // The Shortcut ran and reached us, but carried nothing we could read.
    // Saying so beats leaving yesterday's number on screen unexplained.
    res.message = samples.length
      ? 'Your phone sent a reading GabikOS already had.'
      : 'Your phone opened GabikOS but sent no number — check the Statistic variable is at the end of the Text action.';
    res.tone = samples.length ? 'info' : 'warn';
  }
  return res;
}

let pulling = false;
/** Pick up whatever the phone has posted to the account since last time. */
export async function syncAppleHealth({ quiet = true } = {}) {
  if (pulling) return null;
  if (!(await cloudReady())) {
    if (!quiet) toast('Sign in first — the cloud route needs your account.', 'warn');
    return null;
  }
  pulling = true;
  try {
    const rows = await pullInbox(90);
    const res = ingestSamples(rows, 'apple');
    if (res.days) {
      store.setSetting('health.linked', true);
      refreshIf('health', 'dashboard');
      if (!quiet) toast(`Apple Health · ${plural(res.days, 'day')} updated`, 'ok');
    } else if (!quiet) {
      toast(rows.length ? 'Already up to date' : 'Nothing from the phone yet', rows.length ? 'ok' : 'warn');
    }
    return res;
  } catch (err) {
    console.warn('[GabikOS] Apple Health pull failed:', err);
    if (!quiet) toast(healthError(err), 'bad');
    return null;
  } finally { pulling = false; }
}

function healthError(err) {
  const raw = String(err?.message || err || '');
  if (/does not exist|schema cache|PGRST20\d/i.test(raw))
    return 'The health tables are missing — run supabase/health-inbox.sql in Supabase first.';
  if (/not recognised|28000/i.test(raw)) return 'That key is not on this account any more. Make a new one.';
  if (/jwt|invalid.*api key|401/i.test(raw)) return 'Your project rejected the key — check it in Settings → Data → Use my own project.';
  if (/failed to fetch|network/i.test(raw)) return 'Could not reach the server. Check your connection.';
  return raw || 'Something went wrong.';
}

/* ═══ Sleep ═══════════════════════════════════════════════════ */

/** One tap at bedtime, one on waking — the whole point of "my sleep time". */
function stampBed() {
  const date = nightOf();
  setManual({ bedtime: nowClock() }, date);
  toast(`Bedtime ${nowClock()} — sleep well`, 'ok');
  render();
}
function stampWake() {
  const m = metricFor() || {};
  setManual({ wake: nowClock() }, today());
  const mins = sleepMinsOf(metricFor());
  toast(m.bedtime ? `${fmtSleep(mins)} of sleep. Good morning.` : `Awake at ${nowClock()}`, 'ok');
  render();
}

async function editNight(date = today()) {
  const m = metricFor(date) || {};
  const v = await openForm({
    title: `Sleep · night of ${fmtDate(addDaysISO(date, -1), { absolute: true })} → ${fmtDate(date, { absolute: true })}`,
    size: 'wide', submitLabel: 'Save',
    fields: [
      { name: 'bedtime', label: 'Went to bed', type: 'time', half: true, value: m.bedtime || '' },
      { name: 'wake', label: 'Woke up', type: 'time', half: true, value: m.wake || '' },
      { name: 'quality', label: 'How did you sleep?', type: 'rating', half: true, value: m.quality },
      { name: 'restingHr', label: 'Resting HR (bpm)', type: 'number', half: true, min: 0, step: 1, value: m.restingHr },
      { name: 'sleepNote', label: 'Notes', type: 'text', placeholder: 'woke up twice, phone in the room…', value: m.sleepNote },
    ],
  });
  if (!v) return;
  const patch = { ...v };
  patch.sleepMins = (patch.bedtime && patch.wake) ? minutesBetween(patch.bedtime, patch.wake) : null;
  setManual(patch, date);
  toast('Night saved', 'ok');
  render();
}

const nights = (days = 14) => Array.from({ length: days }, (_, i) => {
  const d = addDaysISO(today(), -(days - 1 - i));
  const m = metricFor(d);
  return { date: d, m, mins: sleepMinsOf(m) };
});

/* ═══ Workouts ════════════════════════════════════════════════ */

const WORKOUT_TYPES = ['Strength', 'Run', 'Cycle', 'Swim', 'Walk', 'Yoga', 'HIIT', 'Sport', 'Climb', 'Other'];

const workoutFields = (w = {}) => [
  { name: 'type', label: 'Type', type: 'select', half: true, value: w.type || 'Strength', options: WORKOUT_TYPES },
  { name: 'date', label: 'Date', type: 'date', half: true, required: true, value: w.date || today() },
  { name: 'duration', label: 'Duration (min)', type: 'number', half: true, min: 1, step: 5, required: true, value: w.duration ?? 45 },
  { name: 'intensity', label: 'Intensity', type: 'select', half: true, value: w.intensity || 'moderate',
    options: [{ value: 'easy', label: 'Easy' }, { value: 'moderate', label: 'Moderate' }, { value: 'hard', label: 'Hard' }, { value: 'max', label: 'All out' }] },
  { name: 'title', label: 'What did you do?', type: 'text', placeholder: 'e.g. Push day — bench, dips, shoulders', value: w.title },
  { name: 'calories', label: 'Calories (optional)', type: 'number', half: true, min: 0, step: 10, value: w.calories },
  { name: 'feel', label: 'How did it feel?', type: 'rating', half: true, value: w.feel },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, value: w.notes },
];

export async function newWorkout(preset = {}) {
  const v = await openForm({ title: 'Log workout', fields: workoutFields(preset), submitLabel: 'Save workout', size: 'wide' });
  if (!v) return;
  store.add('workouts', v);
  store.log('dumbbell', `${v.type} · ${v.duration} min`, 'health');
  toast('Workout logged 💪', 'ok');
  render();
}

async function logDay(date = today()) {
  const m = metricFor(date) || {};
  const v = await openForm({
    title: `Daily check-in · ${fmtDate(date)}`, size: 'wide', submitLabel: 'Save',
    fields: [
      { name: 'bedtime', label: 'Went to bed', type: 'time', half: true, value: m.bedtime || '',
        hint: 'the evening before this day' },
      { name: 'wake', label: 'Woke up', type: 'time', half: true, value: m.wake || '' },
      { name: 'weight', label: 'Weight (kg)', type: 'number', half: true, min: 0, step: 0.1, value: m.weight },
      { name: 'steps', label: 'Steps', type: 'number', half: true, min: 0, step: 100, value: m.steps },
      { name: 'water', label: 'Water (glasses)', type: 'number', half: true, min: 0, step: 1, value: m.water },
      { name: 'restingHr', label: 'Resting HR (bpm)', type: 'number', half: true, min: 0, step: 1, value: m.restingHr },
      { name: 'mood', label: 'Energy today', type: 'range', half: true, min: 1, max: 5, step: 1, value: m.mood ?? 3 },
    ],
  });
  if (!v) return;
  v.sleepMins = (v.bedtime && v.wake) ? minutesBetween(v.bedtime, v.wake) : (m.sleepMins ?? null);
  setManual(v, date);
  toast('Day logged', 'ok');
  render();
}

const series = (key, days = 30) => {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDaysISO(today(), -i);
    const m = S().metrics.find(x => x.date === d);
    out.push({ label: `${parseISO(d).getDate()}/${parseISO(d).getMonth() + 1}`, value: m?.[key] ?? null, date: d });
  }
  return out;
};

/* ═══ Bits of chrome ══════════════════════════════════════════ */

const ring = (value, goal, color, label, sub) => {
  const p = pct(value || 0, goal || 1);
  const c = 2 * Math.PI * 34;
  return `<div class="hring">
    <div class="ring">
      <svg viewBox="0 0 80 80" width="80" height="80">
        <circle class="ring__bg" cx="40" cy="40" r="34" stroke-width="8"/>
        <circle class="ring__fg" cx="40" cy="40" r="34" stroke-width="8" style="stroke:${esc(color)}"
          stroke-dasharray="${round(c, 1)}" stroke-dashoffset="${round(c - (c * p) / 100, 1)}"/>
      </svg>
      <div class="ring__txt" style="font-size:13px">${p}<small style="font-size:9px">%</small></div>
    </div>
    <div class="hring__meta">
      <strong>${label}</strong>
      <span class="dim">${sub}</span>
    </div>
  </div>`;
};

/** The one-line truth about where today's steps and sleep came from. */
function bridgeStrip() {
  const h = hs();
  const m = metricFor() || {};
  const auto = m.src?.steps === 'apple' || m.src?.sleepMins === 'apple';
  const when = h.lastAt ? fmtDate(new Date(h.lastAt).toISOString().slice(0, 10)) : '';
  return `<div class="card card--pad mb-4 bridge ${h.linked ? 'is-on' : ''}">
    <div class="row gap-3 row--wrap">
      <span class="stat__icon">${icon(h.linked ? 'heart' : 'link')}</span>
      <div class="grow" style="min-width:190px">
        <h3 style="font-size:14px">${h.linked ? 'Apple Health is linked' : 'Bring in Apple Health'}</h3>
        <p class="dim mt-1" style="font-size:12.5px">
          ${h.linked
            ? (auto ? 'Today’s steps and sleep came from your iPhone.'
                    : `Waiting for today’s reading${when ? ` · last one ${esc(when.toLowerCase())}` : ''}.`)
            : 'Let your iPhone send today’s steps and sleep here by itself.'}
        </p>
      </div>
      <div class="row gap-2">
        ${h.linked ? `<button class="btn btn--sm" data-ah-sync>${icon('refresh')}<span class="hide-sm">Refresh</span></button>` : ''}
        <button class="btn btn--sm ${h.linked ? '' : 'btn--primary'}" data-ah-setup>${icon('settings')}${h.linked ? 'Settings' : 'Set up'}</button>
      </div>
    </div>
  </div>`;
}

/* ═══ Apple Health setup ══════════════════════════════════════ */

const copyable = (id, label, value, note = '') => `
  <div class="ah__field">
    ${label ? `<label>${esc(label)}</label>` : ''}
    <div class="row gap-2">
      <input class="input mono" id="${id}" readonly value="${esc(value)}" style="font-size:12px">
      <button class="btn btn--sm" data-copy="${id}">${icon('copy')}</button>
    </div>
    ${note ? `<p class="dim mt-1" style="font-size:11.5px">${note}</p>` : ''}
  </div>`;

async function openBridge(tab = 'link') {
  const base = location.origin + location.pathname;
  const link = simpleLink(base);
  let key = null, cloud = false;
  try { cloud = await cloudReady(); if (cloud) key = (await healthKey())?.key || null; } catch { /* the checker explains */ }

  const recipe = cloudRecipe(key);
  const body = `
  <div class="ah">
    <div class="callout mb-4">
      <p style="font-size:13px;line-height:1.65">
        The Health app will not let a website read it — Apple allows that only to apps from the
        App Store. So your iPhone sends the numbers <em>out</em> instead, using
        <strong>Shortcuts</strong>, which is already on your phone. Pick a way below.
      </p>
    </div>

    <div class="seg mb-4" id="ahTabs">
      <button class="${tab === 'link' ? 'is-on' : ''}" data-ahtab="link">Easy way</button>
      <button class="${tab === 'auto' ? 'is-on' : ''}" data-ahtab="auto">Fully automatic</button>
      <button class="${tab === 'import' ? 'is-on' : ''}" data-ahtab="import">From a file</button>
    </div>

    <div data-ahpane="link" ${tab === 'link' ? '' : 'hidden'}>
      <p class="ah__lede">Nothing to set up, no account, works in about two minutes.
        The only catch: GabikOS has to open for the numbers to arrive.</p>

      <div class="ah__steps">
        <ol>
          <li>Open the <strong>Shortcuts</strong> app and tap <strong>+</strong> (top right).
            Everything below gets typed into the search box at the bottom.</li>
          <li>Search <strong>Find Health Samples</strong>. Tap the blue words and change them:
            the first to <strong>Steps</strong>, then <strong>Add Filter</strong> →
            <strong>Start Date</strong> → <strong>is today</strong>.
            <em>It should read: Find All Steps where Start Date is today.</em></li>
          <li>Search <strong>Calculate Statistics</strong>. Make sure it says <strong>Sum</strong>.
            <em>Health stores your steps in dozens of small bursts — this adds them up. Skip it and
            you get a number like 7.</em></li>
          <li>Search <strong>Text</strong>, and paste this into the empty box:</li>
        </ol>
        ${copyable('ahLink', '', link,
          'Then tap at the very <strong>end</strong>, right after <code>steps=</code>, and tap the blue <strong>Statistic</strong> chip above the keyboard. Nothing comes after it. If you see the word typed out in letters instead of a blue chip, delete it and tap the chip.')}
        <ol start="5">
          <li>Search <strong>Open URLs</strong>. It picks up the text on its own.</li>
          <li>Name it <strong>Steps to GabikOS</strong> and tap <strong>Done</strong>.</li>
        </ol>
        <p class="ah__tip">${icon('zap', 'ic ic--sm')} Run it once. GabikOS should open and tell you
          your step count. After that, put it on a <strong>Time of Day</strong> automation
          (Shortcuts → Automation tab) so it runs itself every evening.</p>
      </div>
    </div>

    <div data-ahpane="auto" ${tab === 'auto' ? '' : 'hidden'}>
      <p class="ah__lede">Harder to set up, but then it is truly hands-off: the numbers arrive on your
        phone <em>and</em> your computer without opening anything.</p>
      ${cloud ? `
        ${key
          ? copyable('ahKey', 'Step 1 · your phone key', key, 'Treat it like a password. It can only add readings to your account — it cannot read anything.')
          : `<button class="btn btn--primary mb-4" data-ah-key>${icon('sparkles')}Make my phone key</button>`}
        ${key ? `
        ${copyable('ahUrl', 'Step 2 · the address', recipe.url)}
        ${copyable('ahApiKey', 'Step 3 · the key for the header below', recipe.headers.apikey)}
        <div class="ah__steps">
          <ol>
            <li>Build the shortcut exactly as in <strong>Easy way</strong> steps 1–3, so you have the
              <strong>Statistic</strong> with today's steps.</li>
            <li>Search <strong>Get Contents of URL</strong> and tap it. Paste the address from step 2.</li>
            <li>Tap <strong>Show More</strong>. Set <strong>Method</strong> to <strong>POST</strong>.</li>
            <li>Under <strong>Headers</strong> tap <strong>Add new field</strong> — twice:</li>
          </ol>
          <pre class="ah__code mono">apikey         ${esc(recipe.headers.apikey)}
Content-Type   application/json</pre>
          <ol start="5">
            <li>Set <strong>Request Body</strong> to <strong>JSON</strong> and add three fields:</li>
          </ol>
          <pre class="ah__code mono">p_key    Text     ${esc(key)}
p_day    Text     (the Current Date variable, formatted yyyy-MM-dd)
p_steps  Number   (the Statistic variable)</pre>
          <ol start="6">
            <li>Name it, save, then <strong>Automation</strong> tab → <strong>+</strong> →
              <strong>Time of Day</strong> → 22:00 → <strong>Run Immediately</strong>.</li>
          </ol>
        </div>
        <div class="row gap-2 mt-4 row--wrap">
          <button class="btn btn--primary" data-ah-test>${icon('zap')}Test the connection</button>
          <button class="btn" data-ah-sync>${icon('refresh')}Check for readings</button>
          <button class="btn btn--ghost" data-ah-rotate>${icon('refresh')}New key</button>
          <button class="btn btn--ghost" data-ah-clear>${icon('trash')}Clear sent readings</button>
        </div>` : ''}
      ` : `
        <div class="callout callout--warn mb-3">
          <p style="font-size:13px">This way needs two things first: a GabikOS account
            (<strong>Settings → Data → Sign in</strong>), and the file
            <code>supabase/health-inbox.sql</code> run once in Supabase. The
            <strong>Easy way</strong> tab needs neither.</p>
        </div>`}
    </div>

    <div data-ahpane="import" ${tab === 'import' ? '' : 'hidden'}>
      <p class="ah__lede">For filling in days gone by. In <strong>Health</strong>, tap your picture →
        <strong>Export All Health Data</strong>, unzip it, and hand over <code>export.xml</code>.</p>
      <div class="row gap-2 row--wrap mb-4">
        <button class="btn btn--primary" data-ah-file>${icon('upload')}Choose export.xml</button>
        <button class="btn" data-ah-export>${icon('download')}Save my health data</button>
      </div>
      <label class="ah__field"><span>Or type one day per line — <code>date, steps, hours slept</code></span></label>
      <textarea class="textarea mono" id="ahPaste" rows="4" placeholder="2026-09-15, 9120, 7.25
2026-09-16, 10233, 6.5"></textarea>
      <button class="btn mt-3" data-ah-paste>${icon('check')}Add these days</button>
    </div>

    <div class="ah__check">
      <button class="btn btn--block" data-ah-diagnose>${icon('shield')}Something is not working — check my setup</button>
      <div id="ahResult"></div>
      <p class="ah__build">GabikOS build ${esc(BUILD)}</p>
    </div>
  </div>`;

  modal.open({
    title: 'Apple Health',
    size: 'wide',
    body,
    onMount(root) { wireBridge(root); },
  });
}

function wireBridge(root) {
  on(root, 'click', '[data-ahtab]', (e, el) => {
    const want = el.dataset.ahtab;
    root.querySelectorAll('[data-ahtab]').forEach(b => b.classList.toggle('is-on', b === el));
    root.querySelectorAll('[data-ahpane]').forEach(p => { p.hidden = p.dataset.ahpane !== want; });
  });

  on(root, 'click', '[data-copy]', async (e, el) => {
    const input = root.querySelector('#' + el.dataset.copy);
    if (!input) return;
    try { await navigator.clipboard.writeText(input.value); toast('Copied', 'ok'); }
    catch { input.select(); toast('Press ⌘/Ctrl + C to copy', 'warn'); }
  });

  on(root, 'click', '[data-ah-key]', async () => {
    try {
      await healthKey({ create: true });
      store.setSetting('health.linked', true);
      modal.close(); openBridge('auto');
    } catch (err) { toast(healthError(err), 'bad'); }
  });

  on(root, 'click', '[data-ah-rotate]', async () => {
    if (!await confirmDialog({
      title: 'Make a new key?', danger: true, confirmLabel: 'New key',
      message: 'The old key stops working straight away, so update the Shortcut on your phone afterwards.',
    })) return;
    try { await healthKey({ rotate: true }); modal.close(); openBridge('auto'); toast('New key made', 'ok'); }
    catch (err) { toast(healthError(err), 'bad'); }
  });

  on(root, 'click', '[data-ah-test]', async (e, el) => {
    const key = root.querySelector('#ahKey')?.value;
    if (!key) return;
    el.disabled = true;
    try {
      const res = await cloudPing(key);
      toast(res.stamped
        ? 'The connection works — your phone can send now.'
        : 'The server answered, but did not record the key as used.', res.stamped ? 'ok' : 'warn');
    } catch (err) {
      toast(healthError(err), 'bad', { duration: 7000 });
      root.querySelector('[data-ah-diagnose]')?.click();
    }
    finally { el.disabled = false; }
  });

  on(root, 'click', '[data-ah-sync]', () => syncAppleHealth({ quiet: false }));

  on(root, 'click', '[data-ah-diagnose]', async (e, el) => {
    const out = root.querySelector('#ahResult');
    el.disabled = true;
    out.innerHTML = `<p class="dim mt-3" style="font-size:13px">Checking…</p>`;
    let steps = [];
    try { steps = await diagnose(); }
    catch (err) { steps = [{ label: 'The check itself failed', ok: false, detail: String(err?.message || err) }]; }
    const bad = steps.find(x => !x.ok);
    out.innerHTML = `
      <ul class="ah__diag mt-3">
        ${steps.map(x => `<li class="${x.ok ? 'is-ok' : 'is-bad'}">
          ${icon(x.ok ? 'check' : 'x', 'ic ic--sm')}
          <div><strong>${esc(x.label)}</strong>
          ${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</div></li>`).join('')}
      </ul>
      ${bad?.fix ? `<div class="callout callout--warn mt-3" style="padding:12px 14px">
        <p style="font-size:13px"><strong>Do this next:</strong> ${bad.fix}</p></div>`
        : `<p class="dim mt-3" style="font-size:13px">Everything checks out.</p>`}`;
    el.disabled = false;
  });

  on(root, 'click', '[data-ah-clear]', async () => {
    if (!await confirmDialog({
      title: 'Clear what your phone has sent?', danger: true, confirmLabel: 'Clear',
      message: 'Removes every reading waiting in your account. What is already in GabikOS stays, and your phone can send again straight away.',
    })) return;
    try { const n = await clearInbox(); toast(n ? `${plural(n, 'reading')} cleared` : 'Nothing was waiting', 'ok'); }
    catch (err) { toast(healthError(err), 'bad'); }
  });

  on(root, 'click', '[data-ah-file]', async () => {
    const file = await pickFile('.xml,text/xml,application/xml');
    if (!file) return;
    toast('Reading the export…', 'info');
    try {
      const samples = parseAppleExport(file.content || '');
      if (!samples.length) return toast('No step or sleep records in that file.', 'warn');
      const res = ingestSamples(samples, 'apple');
      store.setSetting('health.linked', true);
      toast(`${plural(res.days, 'day')} imported`, 'ok');
      modal.close(); render();
    } catch (err) { toast(String(err.message || err), 'bad'); }
  });

  on(root, 'click', '[data-ah-paste]', () => {
    const text = root.querySelector('#ahPaste')?.value || '';
    const samples = parsePasted(text);
    if (!samples.length) return toast('Nothing readable in there.', 'warn');
    const res = ingestSamples(samples, 'manual');
    toast(`${plural(res.days, 'day')} added`, 'ok');
    modal.close(); render();
  });

  on(root, 'click', '[data-ah-export]', () => {
    const rows = [...S().metrics].sort(by('date')).map(m =>
      [m.date, m.steps ?? '', sleepMinsOf(m) ?? '', m.bedtime || '', m.wake || '', m.weight ?? '', m.water ?? ''].join(','));
    download(`gabikos-health-${today()}.csv`,
      'date,steps,sleep_minutes,bedtime,wake,weight_kg,water\n' + rows.join('\n'), 'text/csv');
  });
}

/* ═══ View ════════════════════════════════════════════════════ */

registerView('health', {
  title: 'Health', icon: 'heart', group: 'Life', order: 70,
  desc: 'Sleep, steps, training and body',
  keywords: ['health', 'fitness', 'workout', 'gym', 'sleep', 'bedtime', 'weight', 'water', 'steps', 'apple health'],

  render(p) {
    const tab = p.tab || 'today';
    const workouts = [...S().workouts].sort(by('date', -1));
    const g = settings().goals;
    const m = metricFor() || {};
    const mins = sleepMinsOf(m);

    const week = Array.from({ length: 7 }, (_, i) => addDaysISO(today(), -(6 - i)));
    const weekWorkouts = workouts.filter(w => week.includes(w.date));
    const weekMins = sum(weekWorkouts.map(w => w.duration));
    const goalMins = (g.sleep || 8) * 60;

    const head = pageHead('Health', `${plural(weekWorkouts.length, 'session')} this week · ${fmtMins(weekMins)} trained`, `
      <div class="seg">
        <button class="${tab === 'today' ? 'is-on' : ''}" data-tab="today">Today</button>
        <button class="${tab === 'sleep' ? 'is-on' : ''}" data-tab="sleep">Sleep</button>
        <button class="${tab === 'training' ? 'is-on' : ''}" data-tab="training">Training</button>
        <button class="${tab === 'body' ? 'is-on' : ''}" data-tab="body">Body</button>
      </div>
      <button class="btn btn--primary" data-new-workout>${icon('plus')}<span class="hide-sm">Workout</span></button>`, 'heart');

    const src = k => (m.src?.[k] === 'apple' ? ' <span class="chip chip--ok chip--xs">Health</span>' : '');
    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Steps', value: m.steps != null ? (m.steps / 1000).toFixed(1) + '<small>k</small>' : '—',
        sub: `goal ${(g.steps / 1000).toFixed(0)}k`, icon: 'footprints', tone: (m.steps || 0) >= g.steps ? 'ok' : '' })}
      ${statTile({ label: 'Last night', value: mins != null ? fmtSleep(mins) : '—',
        sub: m.bedtime || m.wake ? `${clockLabel(m.bedtime)} → ${clockLabel(m.wake)}` : 'not logged',
        icon: 'bed', tone: mins != null && mins >= goalMins ? 'ok' : 'warn' })}
      ${statTile({ label: 'Water today', value: `${m.water || 0}<small>/${g.water}</small>`,
        sub: `${pct(m.water || 0, g.water)}% of goal`, icon: 'droplet', tone: 'info' })}
      ${statTile({ label: 'This week', value: fmtMins(weekMins), sub: plural(weekWorkouts.length, 'workout'),
        icon: 'dumbbell', tone: 'ok' })}
    </div>`;

    /* ── Sleep ── */
    if (tab === 'sleep') {
      const list = nights(14);
      const logged = list.filter(n => n.mins != null);
      const avgMins = logged.length ? Math.round(avg(logged.map(n => n.mins))) : null;
      const beds = logged.filter(n => n.m?.bedtime).map(n => clockMins(n.m.bedtime));
      // Bedtimes wrap past midnight, so average them around the evening.
      const avgBed = beds.length ? Math.round(avg(beds.map(b => (b < 720 ? b + 1440 : b)))) % 1440 : null;
      const wakes = logged.filter(n => n.m?.wake).map(n => clockMins(n.m.wake));
      const avgWake = wakes.length ? Math.round(avg(wakes)) : null;
      const debt = logged.slice(-7).reduce((a, n) => a + (goalMins - n.mins), 0);
      const asClock = v => (v == null ? '—' : `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`);

      return head + bridgeStrip() + `
      <div class="card card--pad mb-6 night">
        <div class="row row--between row--wrap gap-4">
          <div>
            <div class="dim" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase">Last night</div>
            <div class="night__big">${mins != null ? fmtSleep(mins) : 'not logged yet'}</div>
            <div class="night__times">
              <span>${icon('moon', 'ic ic--sm')} ${clockLabel(m.bedtime)}</span>
              <i>→</i>
              <span>${icon('sun', 'ic ic--sm')} ${clockLabel(m.wake)}</span>
              ${m.quality ? `<span class="dim">· ${'★'.repeat(m.quality)}</span>` : ''}
              ${src('sleepMins')}
            </div>
          </div>
          <div class="row gap-2 row--wrap">
            <button class="btn" data-bed>${icon('moon')}Going to bed</button>
            <button class="btn" data-wake>${icon('sun')}Just woke up</button>
            <button class="btn btn--ghost" data-night>${icon('edit')}Edit</button>
          </div>
        </div>
        ${mins != null ? `<div class="bar mt-4"><i style="width:${pct(mins, goalMins)}%;background:#a78bfa"></i></div>
          <p class="dim mt-2" style="font-size:12px">${mins >= goalMins
            ? `${fmtSleep(mins - goalMins)} over your ${g.sleep}h goal — that is the good kind of debt.`
            : `${fmtSleep(goalMins - mins)} short of your ${g.sleep}h goal.`}</p>` : `
          <p class="dim mt-3" style="font-size:12.5px">Tap <strong>Going to bed</strong> tonight and
            <strong>Just woke up</strong> in the morning — GabikOS works out the rest.</p>`}
      </div>

      <div class="grid grid--stat mb-6">
        ${statTile({ label: 'Average night', value: avgMins != null ? fmtSleep(avgMins) : '—', sub: `${logged.length} of 14 logged`, icon: 'bed', tone: avgMins != null && avgMins >= goalMins ? 'ok' : 'warn' })}
        ${statTile({ label: 'Usual bedtime', value: asClock(avgBed), sub: 'last 14 nights', icon: 'moon', tone: '' })}
        ${statTile({ label: 'Usual wake-up', value: asClock(avgWake), sub: 'last 14 nights', icon: 'sun', tone: '' })}
        ${statTile({ label: '7-night balance', value: logged.length ? `${debt > 0 ? '−' : '+'}${fmtSleep(Math.abs(Math.round(debt)))}` : '—', sub: debt > 0 ? 'behind your goal' : 'ahead of your goal', icon: 'activity', tone: debt > 0 ? 'warn' : 'ok' })}
      </div>

      <div class="card mb-6"><div class="card__head">${icon('chart')}<h3>Hours slept (14 nights)</h3>
        <span class="chip">goal ${g.sleep}h</span></div>
        <div class="card__body">${barChart(list.map(n => ({
          label: dayName(n.date, true)[0], value: n.mins != null ? round(n.mins / 60, 1) : 0,
        })), { format: v => (v ? v + 'h' : '—') })}</div></div>

      <div class="card"><div class="card__head">${icon('list')}<h3>Nights</h3>
        <button class="btn btn--sm" data-night>${icon('plus')}Log last night</button></div>
        <div class="list">${[...list].reverse().map(n => `
          <div class="list__row">
            <span class="stat__icon">${icon(n.mins != null && n.mins >= goalMins ? 'moon' : 'bed', 'ic ic--sm')}</span>
            <div class="list__main">
              <div class="list__title">${esc(fmtDate(n.date))}</div>
              <div class="list__sub">${n.mins != null
                ? `${fmtSleep(n.mins)} · ${clockLabel(n.m?.bedtime)} → ${clockLabel(n.m?.wake)}${n.m?.sleepNote ? ` · ${esc(n.m.sleepNote)}` : ''}`
                : 'not logged'}</div>
            </div>
            <div class="list__actions">
              <button class="icon-btn icon-btn--sm" data-night="${esc(n.date)}">${icon('edit')}</button>
            </div>
          </div>`).join('')}
        </div></div>`;
    }

    /* ── Training ── */
    if (tab === 'training') {
      const byType = WORKOUT_TYPES.map(t => ({ label: t.slice(0, 3), value: workouts.filter(w => w.type === t).length })).filter(x => x.value);
      return head + stats + `
      <div class="grid grid--2 mb-6">
        <div class="card"><div class="card__head">${icon('chart')}<h3>Minutes per day (14 days)</h3></div>
          <div class="card__body">${barChart(Array.from({ length: 14 }, (_, i) => {
            const d = addDaysISO(today(), -(13 - i));
            return { label: dayName(d, true)[0], value: sum(workouts.filter(w => w.date === d).map(w => w.duration)) };
          }), { format: v => v + 'm' })}</div></div>
        <div class="card"><div class="card__head">${icon('pie')}<h3>Favourite sessions</h3></div>
          <div class="card__body">${byType.length ? barChart(byType, { format: v => plural(v, 'session') }) : '<div class="chart-empty">No workouts yet</div>'}</div></div>
      </div>
      <div class="card"><div class="card__head">${icon('list')}<h3>Workout log</h3><span class="nav__badge">${workouts.length}</span></div>
        <div class="list">${workouts.length ? workouts.slice(0, 60).map(w => `
          <div class="list__row">
            <span class="stat__icon">${icon('dumbbell', 'ic ic--sm')}</span>
            <div class="list__main">
              <div class="list__title">${esc(w.title || w.type)}</div>
              <div class="list__sub">${esc(w.type)} · ${fmtMins(w.duration)} · ${esc(w.intensity || 'moderate')}
                ${w.calories ? `· ${w.calories} kcal` : ''} · ${esc(fmtDate(w.date))}
                ${w.feel ? `· ${'★'.repeat(w.feel)}` : ''}</div>
            </div>
            <div class="list__actions">
              <button class="icon-btn icon-btn--sm icon-btn--danger" data-wdel="${w.id}">${icon('trash')}</button>
            </div>
          </div>`).join('') : emptyState('dumbbell', 'No workouts logged', 'Every session counts. Log the first one.',
            '<button class="btn btn--primary mt-3" data-new-workout>Log a workout</button>')}
        </div></div>`;
    }

    /* ── Body ── */
    if (tab === 'body') {
      const weights = S().metrics.filter(x => x.weight != null).sort(by('date'));
      const wSeries = series('weight', 60).filter(x => x.value != null);
      const hrSeries = series('restingHr', 60).filter(x => x.value != null);
      const first = weights[0], last = weights.at(-1);
      const change = first && last ? round(last.weight - first.weight, 1) : null;
      return head + stats + `
      <div class="grid grid--2 mb-6">
        <div class="card"><div class="card__head">${icon('scale')}<h3>Weight</h3>
          ${change != null ? `<span class="chip ${change <= 0 ? 'chip--ok' : 'chip--warn'}">${change > 0 ? '+' : ''}${change} kg</span>` : ''}</div>
          <div class="card__body">${wSeries.length ? lineChart(wSeries, { unit: ' kg', format: v => v }) : '<div class="chart-empty">No weigh-ins yet</div>'}</div></div>
        <div class="card"><div class="card__head">${icon('activity')}<h3>Resting heart rate</h3></div>
          <div class="card__body">${hrSeries.length ? lineChart(hrSeries, { color: '#f4737b', unit: ' bpm' }) : '<div class="chart-empty">No readings yet</div>'}</div></div>
      </div>
      <div class="card"><div class="card__head">${icon('calendar')}<h3>Daily log</h3>
        <button class="btn btn--sm" data-log-day>${icon('plus')}Log today</button></div>
        <div class="table__wrap"><table class="table">
          <thead><tr><th>Date</th><th>Weight</th><th>Sleep</th><th>Bed → wake</th><th>Steps</th><th>Water</th><th>Energy</th><th></th></tr></thead>
          <tbody>${[...S().metrics].sort(by('date', -1)).slice(0, 40).map(x => `
            <tr><td>${esc(fmtDate(x.date))}</td>
              <td class="mono">${x.weight != null ? x.weight + ' kg' : '—'}</td>
              <td class="mono">${fmtSleep(sleepMinsOf(x))}</td>
              <td class="mono">${x.bedtime || x.wake ? `${clockLabel(x.bedtime)} → ${clockLabel(x.wake)}` : '—'}</td>
              <td class="mono">${x.steps != null ? Number(x.steps).toLocaleString() : '—'}</td>
              <td class="mono">${x.water || 0}</td>
              <td>${x.mood ? '●'.repeat(x.mood) + '<span class="dim">' + '○'.repeat(5 - x.mood) + '</span>' : '—'}</td>
              <td class="tr"><button class="icon-btn icon-btn--sm" data-edit-day="${esc(x.date)}">${icon('edit')}</button></td>
            </tr>`).join('') || '<tr><td colspan="8" class="dim tc" style="padding:26px">No entries yet</td></tr>'}
          </tbody></table></div></div>`;
    }

    /* ── Today ── */
    const recent = workouts.slice(0, 5);
    const move = m.exerciseMinutes ?? sum(workouts.filter(w => w.date === today()).map(w => w.duration));
    return head + bridgeStrip() + `
    <div class="card card--pad mb-6">
      <div class="hrings">
        ${ring(m.steps, g.steps, '#3ecf8e', 'Steps', m.steps != null ? `${Number(m.steps).toLocaleString()} of ${Number(g.steps).toLocaleString()}` : 'nothing yet today')}
        ${ring(mins, goalMins, '#a78bfa', 'Sleep', mins != null ? `${fmtSleep(mins)} of ${g.sleep}h` : 'log last night')}
        ${ring(m.water, g.water, '#4cc4f0', 'Water', `${m.water || 0} of ${g.water} glasses`)}
        ${ring(move, 30, '#ffb45c', 'Move', move ? `${fmtMins(move)} active` : 'no movement logged')}
      </div>
    </div>

    <div class="grid grid--2 mb-6">
      <div class="card"><div class="card__head">${icon('bed')}<h3>Sleep</h3>
        ${mins != null ? `<span class="chip ${mins >= goalMins ? 'chip--ok' : 'chip--warn'}">${fmtSleep(mins)}</span>` : ''}</div>
        <div class="card__body">
          <div class="night__times mb-3">
            <span>${icon('moon', 'ic ic--sm')} ${clockLabel(m.bedtime)}</span>
            <i>→</i>
            <span>${icon('sun', 'ic ic--sm')} ${clockLabel(m.wake)}</span>
          </div>
          <div class="row gap-2 row--wrap">
            <button class="btn btn--sm" data-bed>${icon('moon')}Going to bed</button>
            <button class="btn btn--sm" data-wake>${icon('sun')}Just woke up</button>
            <button class="btn btn--sm btn--ghost" data-tab="sleep">All nights</button>
          </div>
        </div></div>

      <div class="card"><div class="card__head">${icon('droplet')}<h3>Hydration</h3>
        <span class="chip chip--info">${m.water || 0} / ${g.water}</span></div>
        <div class="card__body">
          <div class="water">
            ${Array.from({ length: g.water }, (_, i) => `<button class="glass ${i < (m.water || 0) ? 'is-full' : ''}"
              data-water-set="${i + 1}" aria-label="${i + 1} glasses">${icon('droplet')}</button>`).join('')}
          </div>
          <div class="row gap-2 mt-4">
            <button class="btn btn--sm" data-water="1">${icon('plus')}Glass</button>
            <button class="btn btn--sm btn--ghost" data-water="-1">${icon('x')}Undo</button>
            <div class="grow"></div>
            <span class="dim" style="font-size:12px">${pct(m.water || 0, g.water)}% of your daily goal</span>
          </div>
        </div></div>
    </div>

    <div class="card mb-6"><div class="card__head">${icon('footprints')}<h3>Steps this week</h3>
      <button class="btn btn--sm" data-log-day>${icon('edit')}Log day</button></div>
      <div class="card__body">${barChart(week.map(d => ({
        label: dayName(d, true)[0], value: metricFor(d)?.steps || 0,
      })), { format: v => (v ? Number(v).toLocaleString() : '—') })}</div></div>

    <div class="card"><div class="card__head">${icon('dumbbell')}<h3>Recent workouts</h3>
      <button class="btn btn--sm" data-new-workout>${icon('plus')}Log</button></div>
      <div class="list">${recent.length ? recent.map(w => `
        <div class="list__row"><span class="stat__icon">${icon('dumbbell', 'ic ic--sm')}</span>
          <div class="list__main"><div class="list__title">${esc(w.title || w.type)}</div>
            <div class="list__sub">${fmtMins(w.duration)} · ${esc(w.intensity || '')} · ${esc(fmtDate(w.date))}</div></div>
        </div>`).join('') : emptyState('dumbbell', 'No workouts yet', 'Log your first session and the streak starts today.',
          '<button class="btn btn--primary mt-3" data-new-workout>Log a workout</button>')}
      </div></div>`;
  },

  onMount(root) {
    on(root, 'click', '[data-tab]', (e, el) => navigate('health', { tab: el.dataset.tab }));
    on(root, 'click', '[data-new-workout]', () => newWorkout());
    on(root, 'click', '[data-water]', (e, el) => addWater(Number(el.dataset.water)));
    on(root, 'click', '[data-water-set]', (e, el) => {
      const n = Number(el.dataset.waterSet);
      setMetric({ water: waterToday() === n ? n - 1 : n });
      render();
    });
    on(root, 'click', '[data-log-day]', () => logDay());
    on(root, 'click', '[data-edit-day]', (e, el) => logDay(el.dataset.editDay));
    on(root, 'click', '[data-bed]', () => stampBed());
    on(root, 'click', '[data-wake]', () => stampWake());
    on(root, 'click', '[data-night]', (e, el) => editNight(el.dataset.night || today()));
    on(root, 'click', '[data-ah-setup]', () => openBridge());
    on(root, 'click', '[data-ah-sync]', () => syncAppleHealth({ quiet: false }));
    on(root, 'click', '[data-wdel]', async (e, el) => {
      const w = store.find('workouts', el.dataset.wdel);
      if (await confirmDialog({ title: 'Delete workout?', message: `${w.type} on ${fmtDate(w.date)}`, confirmLabel: 'Delete', danger: true })) {
        store.remove('workouts', w.id); toast('Deleted', 'ok'); render();
      }
    });

    // Opening Health is the natural moment to see whether the phone sent anything.
    if (hs().linked && hs().autoPull !== false) syncAppleHealth({ quiet: true });
  },
});

export { openBridge as openHealthBridge };
