/* ═══════════════════════════════════════════════════════════════
   GabikOS — Dashboard: today at a glance
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings, profile } from '../core/store.js';
import { registerView, navigate, render } from '../core/router.js';
import { icon } from '../core/icons.js';
import { on, emptyState, statTile, toast, openForm } from '../core/ui.js';
import { esc, today, greeting, fmtDate, fmtMins, dayName, monthName, parseISO, pct, plural,
         relTime, sum, by, diffDays, addDaysISO, fmtMoney } from '../core/util.js';
import { taskRow, toggleTask, newTask, dueToday, overdue, openTasks } from './tasks.js';
import { dueTodayHabits, doneToday, logFor, bumpHabit, streak, isScheduled } from './habits.js';
import { upcoming, catOf, newEvent } from './calendar.js';
import { focusToday, quickStart } from './focus.js';
import { hasEntryToday, writeEntry, moodOf, entryFor } from './journal.js';
import { activeGoals, goalProgress } from './goals.js';
import { metricFor, addWater } from './health.js';
import { monthNet, monthExpense, money } from './finance.js';
import { currentAndNext, todayLessons, subjectOf, parityLabel, weekParity } from './school.js';
import { sparkline } from '../core/charts.js';
import { sync } from '../core/sync.js';
import { wireAccount } from './account.js';

const QUOTES = [
  ['You do not rise to the level of your goals. You fall to the level of your systems.', 'James Clear'],
  ['How we spend our days is, of course, how we spend our lives.', 'Annie Dillard'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Discipline equals freedom.', 'Jocko Willink'],
  ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca'],
  ['Small disciplines repeated with consistency every day lead to great achievements.', 'John Maxwell'],
  ['Action is the foundational key to all success.', 'Pablo Picasso'],
  ['What gets measured gets managed.', 'Peter Drucker'],
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Proverb'],
];

registerView('dashboard', {
  title: 'Dashboard', icon: 'home', group: 'Do', order: 1,
  desc: 'Your day at a glance',
  keywords: ['home', 'dashboard', 'today', 'overview', 'start'],

  render() {
    const now = new Date();
    const p = profile();
    const t = today();
    const tasksToday = dueToday();
    const late = overdue();
    const habitsDue = dueTodayHabits();
    const habitsDone = doneToday();
    const m = metricFor() || {};
    const g = settings().goals;
    const fMin = focusToday();
    const quote = QUOTES[now.getDate() % QUOTES.length];

    /* the one number that matters: how much of today is handled */
    const parts = [
      { done: tasksToday.filter(x => x.done).length + S().tasks.filter(x => x.done && x.completedAt && new Date(x.completedAt).toDateString() === now.toDateString()).length, total: Math.max(tasksToday.length, 1) },
    ];
    const taskDoneToday = S().tasks.filter(x => x.done && x.completedAt && new Date(x.completedAt).toDateString() === now.toDateString()).length;
    const dayScore = (() => {
      const buckets = [];
      if (habitsDue.length) buckets.push(pct(habitsDone.length, habitsDue.length));
      if (tasksToday.length || taskDoneToday) buckets.push(pct(taskDoneToday, taskDoneToday + tasksToday.length));
      buckets.push(pct(Math.min(fMin, g.focusMins), g.focusMins));
      buckets.push(hasEntryToday() ? 100 : 0);
      return Math.round(buckets.reduce((a, b) => a + b, 0) / buckets.length);
    })();

    /* A copy with nowhere to sign you in cannot sync, and the difference is
       invisible until your two devices disagree — so say it plainly, once. */
    const localNotice = (!sync.enabled && sync.status === 'local' && !settings().hideLocalNotice) ? `
      <div class="card card--pad mb-4 callout localnote">
        <div class="row gap-3 row--wrap">
          <span class="stat__icon">${icon('lock')}</span>
          <div class="grow" style="min-width:200px">
            <h3>This copy saves only on this device</h3>
            <p class="dim mt-2" style="font-size:13px">What you write here stays in this browser, and
              another device starts empty. Sign in and GabikOS follows you everywhere — it takes a few
              seconds and the top bar will read <strong>Synced</strong>.</p>
            <div class="row gap-2 mt-3 row--wrap">
              <button class="btn btn--primary btn--sm" data-signin>${icon('user')}Sign in or register</button>
              <button class="btn btn--sm btn--ghost" data-go-data>${icon('download')}Export instead</button>
              <button class="btn btn--sm btn--ghost" data-hide-notice>Got it</button>
            </div>
          </div>
        </div>
      </div>` : '';

    const hero = `
    <section class="hero">
      <div class="hero__txt">
        <p class="hero__date">${dayName(now)}, ${now.getDate()} ${monthName(now.getMonth())}</p>
        <h1 class="hero__hi">${esc(greeting())}, ${esc(p.name || 'Gabik')}.</h1>
        <p class="hero__sub">${(() => {
          const habitsLeft = habitsDue.length - habitsDone.length;
          if (late.length) return `You have <strong>${plural(late.length, 'overdue task')}</strong> — start there.`;
          if (tasksToday.length) return `<strong>${plural(tasksToday.length, 'task')}</strong> due today`
            + (habitsLeft > 0 ? ` and ${plural(habitsLeft, 'habit')} to tick off.` : ', and every habit already ticked off.');
          if (habitsLeft > 0) return `Nothing due today — just ${plural(habitsLeft, 'habit')} to keep your streaks alive.`;
          return 'Everything on your plate is handled. Enjoy the room to breathe.';
        })()}</p>
        <div class="hero__actions">
          <button class="btn btn--primary" data-d="task">${icon('plus')}Add task</button>
          <button class="btn" data-d="focus">${icon('timer')}Start focus</button>
          <button class="btn" data-d="journal">${icon('journal')}${hasEntryToday() ? 'Edit journal' : 'Journal today'}</button>
        </div>
      </div>
      <div class="hero__score">
        <div class="ring ring--lg">
          <svg viewBox="0 0 120 120" width="118" height="118">
            <circle class="ring__bg" cx="60" cy="60" r="52" stroke-width="9"/>
            <circle class="ring__fg" cx="60" cy="60" r="52" stroke-width="9"
              stroke-dasharray="${2 * Math.PI * 52}"
              stroke-dashoffset="${2 * Math.PI * 52 * (1 - dayScore / 100)}"/>
          </svg>
          <div class="ring__txt ring__txt--lg">${dayScore}<small>%</small></div>
        </div>
        <span class="hero__scorelabel">${dayScore >= 80 ? 'Strong day' : dayScore >= 50 ? 'Getting there' : dayScore > 0 ? 'Just started' : 'Fresh slate'}</span>
      </div>
    </section>`;

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Tasks today', value: `${taskDoneToday}<small>/${taskDoneToday + tasksToday.length}</small>`,
        sub: late.length ? `${late.length} overdue` : 'on track', icon: 'checkSquare', tone: late.length ? 'bad' : 'ok' })}
      ${statTile({ label: 'Habits', value: `${habitsDone.length}<small>/${habitsDue.length}</small>`,
        sub: `${pct(habitsDone.length, habitsDue.length)}% of today`, icon: 'flame', tone: habitsDone.length === habitsDue.length && habitsDue.length ? 'ok' : 'warn' })}
      ${statTile({ label: 'Focused', value: fmtMins(fMin), sub: `goal ${fmtMins(g.focusMins)}`, icon: 'timer', tone: fMin >= g.focusMins ? 'ok' : 'info' })}
      ${statTile({ label: 'Water', value: `${m.water || 0}<small>/${g.water}</small>`, sub: 'glasses today', icon: 'droplet', tone: (m.water || 0) >= g.water ? 'ok' : '' })}
    </div>`;

    /* ── today's tasks ── */
    const taskCard = `<div class="card">
      <div class="card__head">${icon('checkSquare')}<h3>Today</h3>
        <button class="btn btn--sm" data-d="task">${icon('plus')}Add</button></div>
      <div class="tasks">
        ${late.length ? `<div class="tasks__label tasks__label--bad">${icon('alert', 'ic ic--sm')}Overdue</div>
          ${late.slice(0, 4).map(t => taskRow(t, { compact: true })).join('')}` : ''}
        ${tasksToday.filter(t => !late.includes(t)).length
          ? (late.length ? `<div class="tasks__label">${icon('calendar', 'ic ic--sm')}Due today</div>` : '') +
            tasksToday.filter(t => !late.includes(t)).slice(0, 6).map(t => taskRow(t, { compact: true })).join('')
          : late.length ? '' : emptyState('check', 'Nothing due today', 'Pull something forward, or take the win.',
              '<button class="btn btn--sm mt-2" data-d="task">Add a task</button>')}
      </div>
      ${openTasks().length > 8 ? `<div class="card__foot"><button class="btn btn--ghost btn--sm" data-go="tasks">
        View all ${openTasks().length} open tasks ${icon('arrowRight', 'ic ic--sm')}</button></div>` : ''}
    </div>`;

    /* ── habits ── */
    const habitCard = `<div class="card">
      <div class="card__head">${icon('flame')}<h3>Habits</h3>
        <span class="chip ${habitsDone.length === habitsDue.length && habitsDue.length ? 'chip--ok' : ''}">${habitsDone.length}/${habitsDue.length}</span></div>
      <div class="card__body card__body--flush">
        ${habitsDue.length ? `<div class="hab-strip">${habitsDue.map(h => {
          const target = Number(h.target) || 1;
          const v = logFor(h.id, t);
          const done = v >= target;
          const st = streak(h.id);
          return `<button class="hab-pill ${done ? 'is-done' : ''}" data-hbump="${h.id}" style="--hc:${esc(h.color || '#3ecf8e')}">
            <span class="hab-pill__ic">${icon(done ? 'check' : (h.icon || 'flame'), 'ic ic--sm')}</span>
            <span class="hab-pill__txt">
              <strong>${esc(h.name)}</strong>
              <small>${target > 1 ? `${v}/${target}` : done ? 'done' : 'tap to log'}${st ? ` · ${st}d 🔥` : ''}</small>
            </span>
          </button>`;
        }).join('')}</div>` : emptyState('flame', 'No habits for today', 'Build one and start a streak.',
          '<button class="btn btn--sm mt-2" data-go="habits">Create a habit</button>')}
      </div>
    </div>`;

    /* ── school ── */
    const { current, next: nextLesson, all: dayLessons } = currentAndNext();
    const schoolCard = dayLessons.length ? `<div class="card">
      <div class="card__head">${icon('graduation')}<h3>School today</h3>
        <span class="chip">${plural(dayLessons.length, 'lesson')}</span>
        <button class="btn btn--ghost btn--sm" data-go="school">${icon('arrowRight', 'ic ic--sm')}</button></div>
      <div class="card__body card__body--flush">
        ${[current && { l: current, tag: 'Now' }, nextLesson && { l: nextLesson, tag: 'Next' }]
          .filter(Boolean).map(({ l, tag }) => {
            const sub = subjectOf(l.subjectId);
            return `<div class="nextlesson" style="--sc:${esc(sub?.color || 'var(--accent)')}">
              <span class="nextlesson__badge">${esc(sub?.short || '?')}</span>
              <span class="nextlesson__txt">
                <strong>${esc(sub?.name || 'Lesson')}</strong>
                <small>${tag} · ${esc(l.startStr)}–${esc(l.endStr)}${l.room || sub?.room ? ` · ${esc(l.room || sub.room)}` : ''}</small>
              </span>
              <span class="nextlesson__when">${esc(tag === 'Now' ? 'until ' + l.endStr : l.startStr)}</span>
            </div>`;
          }).join('') || `<div class="nextlesson"><span class="nextlesson__txt">
              <strong>Lessons are done for today</strong>
              <small>${plural(dayLessons.length, 'lesson')} finished</small></span></div>`}
      </div>
    </div>` : '';

    /* ── schedule ── */
    const events = upcoming(5);
    const scheduleCard = `<div class="card">
      <div class="card__head">${icon('calendar')}<h3>Coming up</h3>
        <button class="btn btn--sm" data-d="event">${icon('plus')}Add</button></div>
      <div class="list">
        ${events.length ? events.map(e => `<div class="list__row">
          <span class="tag-dot" style="background:${catOf(e.category).color}"></span>
          <div class="list__main">
            <div class="list__title">${esc(e.title)}</div>
            <div class="list__sub">${esc(fmtDate(e.date))}${e.time ? ` · ${esc(e.time)}` : ''}${e.location ? ` · ${esc(e.location)}` : ''}</div>
          </div>
        </div>`).join('') : emptyState('calendar', 'Clear diary', 'Nothing scheduled ahead.')}
      </div>
    </div>`;

    /* ── goals ── */
    const goals = activeGoals().slice(0, 3);
    const goalCard = goals.length ? `<div class="card">
      <div class="card__head">${icon('target')}<h3>Goals</h3>
        <button class="btn btn--ghost btn--sm" data-go="goals">All ${icon('arrowRight', 'ic ic--sm')}</button></div>
      <div class="card__body col gap-4">
        ${goals.map(g2 => {
          const prog = goalProgress(g2);
          return `<div>
            <div class="row row--between mb-2">
              <span class="truncate" style="font-size:13.4px;font-weight:550">${esc(g2.title)}</span>
              <strong class="mono" style="font-size:12.5px">${prog}%</strong>
            </div>
            <div class="bar"><i style="width:${prog}%;background:${esc(g2.color || 'var(--accent)')}"></i></div>
          </div>`;
        }).join('')}
      </div></div>` : '';

    /* ── money + journal ── */
    const net = monthNet();
    const moneyCard = S().transactions.length ? `<div class="card">
      <div class="card__head">${icon('wallet')}<h3>This month</h3>
        <button class="btn btn--ghost btn--sm" data-go="finance">${icon('arrowRight', 'ic ic--sm')}</button></div>
      <div class="card__body">
        <div class="row row--between">
          <div><div class="stat__label">Net</div>
            <div class="stat__value" style="color:${net >= 0 ? 'var(--ok)' : 'var(--bad)'}">${money(net)}</div></div>
          <div class="tr"><div class="stat__label">Spent</div>
            <div class="mono" style="font-size:15px;font-weight:650">${money(monthExpense())}</div></div>
        </div>
      </div></div>` : '';

    const entry = entryFor(t);
    const journalCard = `<div class="card">
      <div class="card__head">${icon('journal')}<h3>Journal</h3></div>
      <div class="card__body">
        ${entry ? `<div class="row gap-3 mb-3">
            <span class="jmood">${moodOf(entry.mood).emoji}</span>
            <div><strong style="font-size:13.6px">${esc(moodOf(entry.mood).label)} day</strong>
              <div class="dim" style="font-size:12px">${esc(relTime(entry.createdAt || Date.now()))}</div></div>
          </div>
          <p class="dim" style="font-size:13px;line-height:1.6">${esc((entry.text || '').slice(0, 150))}${(entry.text || '').length > 150 ? '…' : ''}</p>
          <button class="btn btn--sm mt-3" data-d="journal">${icon('edit')}Edit entry</button>`
        : `<p class="dim" style="font-size:13.2px;line-height:1.6">You have not written today. Two minutes is enough.</p>
           <button class="btn btn--primary btn--sm mt-3" data-d="journal">${icon('edit')}Write today's entry</button>`}
      </div></div>`;

    /* ── activity + quote ── */
    const acts = (S().activity || []).slice(0, 6);
    const activityCard = `<div class="card">
      <div class="card__head">${icon('activity')}<h3>Recent activity</h3></div>
      <div class="list">
        ${acts.length ? acts.map(a => `<button class="list__row list__row--btn" data-go="${esc(a.view || 'dashboard')}">
          <span class="stat__icon">${icon(a.icon || 'zap', 'ic ic--sm')}</span>
          <div class="list__main"><div class="list__title">${esc(a.text)}</div>
            <div class="list__sub">${esc(relTime(a.ts))}</div></div>
        </button>`).join('') : emptyState('activity', 'Nothing yet', 'Your actions will show up here.')}
      </div></div>`;

    const quoteCard = `<div class="card card--pad quote">
      ${icon('sparkles', 'ic ic--lg')}
      <blockquote>“${esc(quote[0])}”</blockquote>
      <cite>— ${esc(quote[1])}</cite>
    </div>`;

    return localNotice + hero + stats + `
      <div class="dash">
        <div class="dash__col">${taskCard}${habitCard}${activityCard}</div>
        <div class="dash__col">${schoolCard}${scheduleCard}${journalCard}${goalCard}${moneyCard}${quoteCard}</div>
      </div>`;
  },

  onMount(root) {
    on(root, 'click', '[data-go]', (e, el) => navigate(el.dataset.go));
    on(root, 'click', '[data-go-data]', () => navigate('settings', { tab: 'data' }));
    wireAccount(root);
    on(root, 'click', '[data-hide-notice]', () => { store.setSetting('hideLocalNotice', true); render(); });
    on(root, 'click', '[data-toggle]', (e, el) => toggleTask(el.dataset.toggle));
    on(root, 'click', '[data-edit]', (e, el) => import('./tasks.js').then(m => m.editTask(el.dataset.edit)));
    on(root, 'click', '[data-hbump]', (e, el) => bumpHabit(el.dataset.hbump));
    on(root, 'click', '[data-d]', (e, el) => {
      const what = el.dataset.d;
      if (what === 'task') newTask({ due: today() });
      else if (what === 'focus') quickStart();
      else if (what === 'journal') writeEntry();
      else if (what === 'event') newEvent({ date: today() });
    });
    on(root, 'click', '[data-menu]', (e, el) =>
      import('./tasks.js').then(m => m.editTask(el.dataset.menu)));
  },
});
