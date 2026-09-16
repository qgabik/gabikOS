/* ═══════════════════════════════════════════════════════════════
   GabikOS — Goals: outcomes, milestones, progress
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { registerView, render } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile } from '../core/ui.js';
import { esc, uid, pct, fmtDate, diffDays, today, plural, clamp, by } from '../core/util.js';

export const activeGoals = () => S().goals.filter(g => !g.archived);
export const goalProgress = g => {
  if (g.milestones?.length) {
    const done = g.milestones.filter(m => m.done).length;
    return pct(done, g.milestones.length);
  }
  return pct(Number(g.current) || 0, Number(g.target) || 100);
};

const goalFields = (g = {}) => [
  { name: 'title', label: 'Goal', type: 'text', required: true, placeholder: 'e.g. Run a half marathon', value: g.title },
  { name: 'why', label: 'Why this matters', type: 'textarea', rows: 2, value: g.why,
    hint: 'The reason is what carries you through the boring middle' },
  { name: 'category', label: 'Area of life', type: 'select', half: true, value: g.category || 'Health',
    options: ['Health', 'Career', 'Money', 'Learning', 'Relationships', 'Creative', 'Adventure', 'Personal'] },
  { name: 'deadline', label: 'Target date', type: 'date', half: true, value: g.deadline || '' },
  { name: 'current', label: 'Current', type: 'number', half: true, step: 'any', value: g.current ?? 0 },
  { name: 'target', label: 'Target', type: 'number', half: true, step: 'any', value: g.target ?? 100 },
  { name: 'unit', label: 'Unit', type: 'text', half: true, placeholder: 'km, %, books…', value: g.unit || '%' },
  { name: 'color', label: 'Colour', type: 'color', value: g.color || '#7c5cff' },
];

export async function newGoal() {
  const v = await openForm({ title: 'New goal', fields: goalFields(), submitLabel: 'Set goal', size: 'wide' });
  if (!v) return;
  store.add('goals', { ...v, milestones: [] });
  store.log('target', `New goal: ${v.title}`, 'goals');
  toast('Goal set — now break it into milestones', 'ok');
  render();
}

async function editGoal(id) {
  const g = store.find('goals', id);
  if (!g) return;
  const v = await openForm({ title: 'Edit goal', fields: goalFields(g), values: g, submitLabel: 'Save', size: 'wide' });
  if (!v) return;
  store.update('goals', id, v);
  toast('Goal updated', 'ok'); render();
}

async function addMilestone(goalId) {
  const v = await openForm({ title: 'Add milestone', submitLabel: 'Add',
    fields: [{ name: 'text', label: 'Milestone', type: 'text', required: true, placeholder: 'A concrete step you can finish' }] });
  if (!v) return;
  store.update('goals', goalId, g => ({ milestones: [...(g.milestones || []), { id: uid('ms'), text: v.text, done: false }] }));
  render();
}

registerView('goals', {
  title: 'Goals', icon: 'target', group: 'Grow', order: 50,
  desc: 'The bigger picture and what moves it',
  keywords: ['goal', 'target', 'objective', 'milestone', 'ambition'],

  render() {
    const goals = S().goals;
    const head = pageHead('Goals', goals.length ? `${plural(activeGoals().length, 'active goal')}` : 'What are you building toward?',
      `<button class="btn btn--primary" data-new-goal>${icon('plus')}New goal</button>`, 'target');

    if (!goals.length) return head + `<div class="card">${emptyState('target', 'No goals yet',
      'A goal without a deadline is a wish. Name one thing you want to be true a year from now.',
      '<button class="btn btn--primary mt-3" data-new-goal>Set your first goal</button>')}</div>`;

    const avg = Math.round(goals.reduce((a, g) => a + goalProgress(g), 0) / goals.length);
    const soon = goals.filter(g => g.deadline && diffDays(g.deadline, today()) >= 0 && diffDays(g.deadline, today()) <= 30).length;
    const doneCount = goals.filter(g => goalProgress(g) >= 100).length;

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Average progress', value: avg + '%', sub: 'across all goals', icon: 'trendUp', tone: avg >= 50 ? 'ok' : '' })}
      ${statTile({ label: 'Achieved', value: doneCount, sub: plural(doneCount, 'goal') + ' at 100%', icon: 'award', tone: 'ok' })}
      ${statTile({ label: 'Due within 30d', value: soon, sub: soon ? 'needs attention' : 'nothing urgent', icon: 'clock', tone: soon ? 'warn' : '' })}
      ${statTile({ label: 'Total', value: goals.length, sub: plural(goals.length, 'goal'), icon: 'target', tone: 'info' })}
    </div>`;

    const cards = `<div class="grid grid--2">${[...goals].sort(by(g => goalProgress(g) >= 100 ? 1 : 0)).map(g => {
      const p = goalProgress(g);
      const days = g.deadline ? diffDays(g.deadline, today()) : null;
      const ms = g.milestones || [];
      return `<article class="goal ${p >= 100 ? 'is-done' : ''}" style="--gc:${esc(g.color || '#7c5cff')}">
        <header class="goal__head">
          <div class="goal__ring">
            <svg viewBox="0 0 44 44"><circle class="ring__bg" cx="22" cy="22" r="19" stroke-width="4"/>
              <circle class="ring__fg" cx="22" cy="22" r="19" stroke-width="4" stroke="${esc(g.color || 'var(--accent)')}"
                stroke-dasharray="119.4" stroke-dashoffset="${119.4 - (119.4 * p) / 100}" stroke-linecap="round"
                transform="rotate(-90 22 22)"/></svg>
            <span>${p}%</span>
          </div>
          <div class="grow">
            <h3>${esc(g.title)}</h3>
            <div class="row gap-2 mt-2 row--wrap">
              <span class="chip chip--accent">${esc(g.category || 'Personal')}</span>
              ${g.deadline ? `<span class="chip ${days < 0 ? 'chip--bad' : days <= 30 ? 'chip--warn' : ''}">
                ${icon('calendar','ic ic--sm')}${days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d left`}</span>` : ''}
              ${p >= 100 ? '<span class="chip chip--ok">Achieved 🎉</span>' : ''}
            </div>
          </div>
          <button class="icon-btn icon-btn--sm" data-gmenu="${g.id}">${icon('more')}</button>
        </header>

        ${g.why ? `<p class="goal__why">${icon('lightbulb', 'ic ic--sm')}${esc(g.why)}</p>` : ''}

        ${!ms.length ? `<div class="goal__meter">
          <div class="row row--between"><span class="dim">${esc(String(g.current ?? 0))} / ${esc(String(g.target ?? 100))} ${esc(g.unit || '')}</span>
            <div class="row gap-1">
              <button class="icon-btn icon-btn--sm" data-gdec="${g.id}">−</button>
              <button class="icon-btn icon-btn--sm" data-ginc="${g.id}">+</button>
            </div></div>
          <div class="bar mt-2"><i style="width:${p}%;background:${esc(g.color || 'var(--accent)')}"></i></div>
        </div>` : `<div class="goal__ms">
          ${ms.map(m => `<label class="check goal__msrow">
            <input type="checkbox" data-ms="${g.id}|${m.id}"${m.done ? ' checked' : ''} />
            <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
            <span class="${m.done ? 'is-struck' : ''}">${esc(m.text)}</span>
          </label>`).join('')}
        </div>`}

        <footer class="goal__foot">
          <button class="btn btn--ghost btn--sm" data-addms="${g.id}">${icon('plus')}Milestone</button>
          <span class="dim" style="font-size:11.5px">${ms.length ? `${ms.filter(m => m.done).length}/${ms.length} milestones` : 'tracking by number'}</span>
        </footer>
      </article>`;
    }).join('')}</div>`;

    return head + stats + cards;
  },

  onMount(root) {
    on(root, 'click', '[data-new-goal]', newGoal);
    on(root, 'click', '[data-addms]', (e, el) => addMilestone(el.dataset.addms));
    on(root, 'change', '[data-ms]', (e, el) => {
      const [gid, mid] = el.dataset.ms.split('|');
      store.update('goals', gid, g => ({
        milestones: (g.milestones || []).map(m => m.id === mid ? { ...m, done: el.checked } : m),
      }));
      const g = store.find('goals', gid);
      if (goalProgress(g) >= 100) toast(`“${g.title}” complete! 🎉`, 'ok');
      render();
    });
    on(root, 'click', '[data-ginc]', (e, el) => {
      const g = store.find('goals', el.dataset.ginc);
      const stepSize = Math.max(1, Math.round((Number(g.target) || 100) / 20));
      store.update('goals', g.id, { current: clamp((Number(g.current) || 0) + stepSize, 0, Number(g.target) || 100) });
      render();
    });
    on(root, 'click', '[data-gdec]', (e, el) => {
      const g = store.find('goals', el.dataset.gdec);
      const stepSize = Math.max(1, Math.round((Number(g.target) || 100) / 20));
      store.update('goals', g.id, { current: clamp((Number(g.current) || 0) - stepSize, 0, Number(g.target) || 100) });
      render();
    });
    on(root, 'click', '[data-gmenu]', (e, el) => {
      const id = el.dataset.gmenu, g = store.find('goals', id);
      contextMenu(e, [
        { label: 'Edit goal', icon: 'edit', action: () => editGoal(id) },
        { label: 'Add milestone', icon: 'plus', action: () => addMilestone(id) },
        { label: 'Mark as achieved', icon: 'award', action: () => {
            store.update('goals', id, gg => ({ current: gg.target, milestones: (gg.milestones || []).map(m => ({ ...m, done: true })) }));
            toast('Congratulations 🎉', 'ok'); render();
          } },
        '-',
        { label: 'Delete goal', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete goal?', message: `“${g.title}” will be removed.`, confirmLabel: 'Delete', danger: true })) {
              store.remove('goals', id); toast('Goal deleted', 'ok'); render();
            }
          } },
      ]);
    });
  },
});
