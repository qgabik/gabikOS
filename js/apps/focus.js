/* ═══════════════════════════════════════════════════════════════
   GabikOS — Focus: pomodoro engine + session history
   The timer lives outside the render cycle so it survives navigation.
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, render, navigate, params, currentView } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, toast, on, emptyState, pageHead, statTile, qs, confirmDialog } from '../core/ui.js';
import { esc, today, addDaysISO, fmtDuration, fmtMins, sum, by, plural, dayName, pct, round } from '../core/util.js';
import { barChart } from '../core/charts.js';

const RING = 119.4; // 2πr for r=19

export const timer = {
  mode: 'focus',        // focus | short | long
  remaining: 0,         // seconds
  total: 0,
  running: false,
  round: 1,
  label: '',
  taskId: null,
  startedAt: null,
  _tick: null,
};

const minutesFor = mode => Number(settings().pomodoro[mode]) || (mode === 'focus' ? 25 : mode === 'short' ? 5 : 15);
const MODE_LABEL = { focus: 'Focus', short: 'Short break', long: 'Long break' };

function paintHud() {
  const hud = qs('#focusHud');
  if (!hud) return;
  const live = timer.running || timer.remaining > 0;
  hud.hidden = !live;
  if (!live) return;
  qs('#fhTime').textContent = fmtDuration(timer.remaining);
  qs('#fhLabel').textContent = MODE_LABEL[timer.mode];
  qs('#fhTask').textContent = timer.label || (timer.mode === 'focus' ? 'Deep work' : 'Rest');
  const progress = timer.total ? (timer.total - timer.remaining) / timer.total : 0;
  qs('#fhRing').style.strokeDashoffset = String(RING - RING * progress);
  qs('#fhToggle').innerHTML = icon(timer.running ? 'pause' : 'play');
  qs('#fhToggle').title = timer.running ? 'Pause' : 'Resume';
  qs('#fhStop').innerHTML = icon('stop');
  document.title = `${fmtDuration(timer.remaining)} · ${MODE_LABEL[timer.mode]} — GabikOS`;
}

function paintView() {
  if (currentView() === 'focus') {
    const disc = qs('[data-timer-disc]');
    if (disc) {
      qs('[data-timer-time]').textContent = fmtDuration(timer.remaining);
      const p = timer.total ? (timer.total - timer.remaining) / timer.total : 0;
      const R = 2 * Math.PI * 88;
      disc.style.strokeDasharray = String(R);
      disc.style.strokeDashoffset = String(R - R * p);
      const btn = qs('[data-timer-toggle]');
      if (btn) btn.innerHTML = `${icon(timer.running ? 'pause' : 'play')}${timer.running ? 'Pause' : timer.remaining ? 'Resume' : 'Start'}`;
    } else render();
  }
}

function paint() { paintHud(); paintView(); }

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22, 0.44].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = [660, 880, 1046][i];
      osc.type = 'sine';
      const t0 = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.start(t0); osc.stop(t0 + 0.22);
    });
    setTimeout(() => ctx.close?.(), 1200);
  } catch { /* audio is a nicety, never a failure */ }
}

function complete() {
  stop(false);
  beep();
  const wasFocus = timer.mode === 'focus';
  if (wasFocus) {
    store.add('focusSessions', {
      date: today(), minutes: Math.round(timer.total / 60),
      label: timer.label, taskId: timer.taskId, completed: true,
    });
    store.log('timer', `Focused for ${Math.round(timer.total / 60)} min`, 'focus');
  }
  const rounds = Number(settings().pomodoro.rounds) || 4;
  const nextMode = wasFocus ? (timer.round % rounds === 0 ? 'long' : 'short') : 'focus';
  if (wasFocus) timer.round++;

  toast(wasFocus ? `Session complete — take a ${nextMode === 'long' ? 'long ' : ''}break` : 'Break over — back to it',
    'ok', { duration: 6000, action: 'Start ' + MODE_LABEL[nextMode].toLowerCase(), onAction: () => start(nextMode, timer.label, timer.taskId) });

  timer.mode = nextMode;
  timer.remaining = 0;
  timer.total = 0;
  document.title = 'GabikOS';
  paint();
  if (currentView() === 'focus') render();
}

export function start(mode = 'focus', label = '', taskId = null) {
  clearInterval(timer._tick);
  timer.mode = mode;
  timer.total = minutesFor(mode) * 60;
  timer.remaining = timer.total;
  timer.label = label;
  timer.taskId = taskId;
  timer.running = true;
  timer.startedAt = Date.now();
  timer._tick = setInterval(tick, 1000);
  paint();
}

function tick() {
  if (!timer.running) return;
  timer.remaining--;
  if (timer.remaining <= 0) { timer.remaining = 0; complete(); return; }
  paint();
}

export function toggle() {
  if (!timer.total) return start('focus');
  timer.running = !timer.running;
  if (timer.running) { clearInterval(timer._tick); timer._tick = setInterval(tick, 1000); }
  else clearInterval(timer._tick);
  paint();
}

export function stop(record = true) {
  clearInterval(timer._tick);
  const elapsed = timer.total - timer.remaining;
  if (record && timer.mode === 'focus' && elapsed >= 60) {
    store.add('focusSessions', {
      date: today(), minutes: Math.round(elapsed / 60),
      label: timer.label, taskId: timer.taskId, completed: false,
    });
    toast(`Logged ${Math.round(elapsed / 60)} min of focus`, 'info');
  }
  timer.running = false;
  timer.remaining = 0;
  timer.total = 0;
  document.title = 'GabikOS';
  paint();
  if (record && currentView() === 'focus') render();
}

export async function quickStart() {
  const openTasks = S().tasks.filter(t => !t.done).slice(0, 25);
  const v = await openForm({
    title: 'Start a focus session', submitLabel: 'Start',
    fields: [
      { name: 'mode', label: 'Session', type: 'select', value: 'focus',
        options: [
          { value: 'focus', label: `Focus — ${minutesFor('focus')} min` },
          { value: 'short', label: `Short break — ${minutesFor('short')} min` },
          { value: 'long', label: `Long break — ${minutesFor('long')} min` },
        ] },
      { name: 'taskId', label: 'Working on', type: 'select', value: '',
        options: [{ value: '', label: 'Anything — just focus' }, ...openTasks.map(t => ({ value: t.id, label: t.title }))] },
      { name: 'label', label: 'Or describe it', type: 'text', placeholder: 'e.g. Write the proposal' },
    ],
  });
  if (!v) return;
  const task = v.taskId ? store.find('tasks', v.taskId) : null;
  start(v.mode, v.label || task?.title || '', v.taskId || null);
}

/* ─── Stats ─── */
export const focusToday = () => sum(S().focusSessions.filter(s => s.date === today()).map(s => s.minutes));
export const focusWeek = () => {
  const week = Array.from({ length: 7 }, (_, i) => addDaysISO(today(), -i));
  return sum(S().focusSessions.filter(s => week.includes(s.date)).map(s => s.minutes));
};

/* ─── View ─── */
registerView('focus', {
  title: 'Focus', icon: 'timer', group: 'Do', order: 25,
  desc: 'Pomodoro timer and deep work log',
  keywords: ['focus', 'pomodoro', 'timer', 'deep work', 'concentrate'],

  render() {
    const p = settings().pomodoro;
    const sessions = [...S().focusSessions].sort(by('createdAt', -1));
    const tMin = focusToday(), wMin = focusWeek();
    const goal = settings().goals.focusMins || 120;
    const progress = timer.total ? (timer.total - timer.remaining) / timer.total : 0;
    const R = 2 * Math.PI * 88;
    const task = timer.taskId ? store.find('tasks', timer.taskId) : null;

    const days = Array.from({ length: 14 }, (_, i) => {
      const d = addDaysISO(today(), -(13 - i));
      return { label: dayName(d, true)[0], value: sum(S().focusSessions.filter(s => s.date === d).map(s => s.minutes)) };
    });

    return pageHead('Focus', `${fmtMins(tMin)} focused today · ${fmtMins(wMin)} this week`, '', 'timer') + `
    <div class="grid grid--stat mb-6">
      ${statTile({ label: 'Today', value: fmtMins(tMin), sub: `${pct(tMin, goal)}% of ${fmtMins(goal)} goal`, icon: 'timer', tone: tMin >= goal ? 'ok' : '' })}
      ${statTile({ label: 'This week', value: fmtMins(wMin), sub: plural(S().focusSessions.filter(s => addDaysISO(today(), -6) <= s.date).length, 'session'), icon: 'zap', tone: 'info' })}
      ${statTile({ label: 'All time', value: fmtMins(sum(sessions.map(s => s.minutes))), sub: plural(sessions.length, 'session'), icon: 'award', tone: 'warn' })}
      ${statTile({ label: 'Round', value: `${timer.round}<small>/${p.rounds}</small>`, sub: 'until a long break', icon: 'repeat' })}
    </div>

    <div class="grid grid--2 mb-6">
      <div class="card focus-card">
        <div class="seg mb-4" data-modes>
          ${['focus', 'short', 'long'].map(m => `<button class="${timer.mode === m ? 'is-on' : ''}" data-mode="${m}">
            ${MODE_LABEL[m]} · ${minutesFor(m)}m</button>`).join('')}
        </div>

        <div class="timer-disc">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="88" class="td-bg"/>
            <circle cx="100" cy="100" r="88" class="td-fg" data-timer-disc
              style="stroke-dasharray:${R};stroke-dashoffset:${R - R * progress}" transform="rotate(-90 100 100)"/>
          </svg>
          <div class="timer-disc__mid">
            <strong data-timer-time>${fmtDuration(timer.remaining || minutesFor(timer.mode) * 60)}</strong>
            <span>${timer.running ? MODE_LABEL[timer.mode] : timer.remaining ? 'Paused' : 'Ready'}</span>
          </div>
        </div>

        ${timer.label || task ? `<p class="focus-card__task">${icon('target', 'ic ic--sm')}${esc(timer.label || task?.title || '')}</p>` : ''}

        <div class="row gap-2 mt-4" style="justify-content:center">
          <button class="btn btn--primary btn--lg" data-timer-toggle>
            ${icon(timer.running ? 'pause' : 'play')}${timer.running ? 'Pause' : timer.remaining ? 'Resume' : 'Start'}</button>
          ${timer.total ? `<button class="btn btn--lg" data-timer-stop>${icon('stop')}Stop</button>` : ''}
          <button class="btn btn--lg btn--ghost" data-quick>${icon('target')}<span class="hide-sm">Pick a task</span></button>
        </div>
      </div>

      <div class="card">
        <div class="card__head">${icon('chart')}<h3>Focus minutes (14 days)</h3></div>
        <div class="card__body">${barChart(days, { format: v => fmtMins(v) })}</div>
        <div class="card__foot">
          <button class="btn btn--sm" data-settings-pomo>${icon('settings')}Adjust intervals</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card__head">${icon('list')}<h3>Session log</h3><span class="nav__badge">${sessions.length}</span></div>
      <div class="list">${sessions.length ? sessions.slice(0, 30).map(s => `
        <div class="list__row">
          <span class="stat__icon">${icon(s.completed ? 'check' : 'timer', 'ic ic--sm')}</span>
          <div class="list__main">
            <div class="list__title">${esc(s.label || 'Focus session')}</div>
            <div class="list__sub">${fmtMins(s.minutes)} · ${esc(s.date)}${s.completed ? '' : ' · stopped early'}</div>
          </div>
          <strong class="mono dim">${fmtMins(s.minutes)}</strong>
        </div>`).join('') : emptyState('timer', 'No sessions yet',
          'Twenty-five minutes, one thing, no phone. That is the whole method.')}
      </div>
    </div>`;
  },

  onMount(root) {
    on(root, 'click', '[data-timer-toggle]', () => { if (!timer.total) start(timer.mode); else toggle(); });
    on(root, 'click', '[data-timer-stop]', () => stop());
    on(root, 'click', '[data-quick]', quickStart);
    on(root, 'click', '[data-mode]', (e, el) => {
      if (timer.running) return toast('Stop the current session first', 'warn');
      timer.mode = el.dataset.mode; timer.remaining = 0; timer.total = 0; render();
    });
    on(root, 'click', '[data-settings-pomo]', () => navigate('settings', { tab: 'focus' }));
    paintHud();
  },
});

/* ─── HUD wiring (called once from main) ─── */
export function initFocusHud() {
  qs('#fhToggle')?.addEventListener('click', toggle);
  qs('#fhStop')?.addEventListener('click', () => stop());
  qs('#focusBtn')?.addEventListener('click', () => (timer.total ? navigate('focus') : quickStart()));
  paintHud();
}
