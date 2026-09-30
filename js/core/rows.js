/* ═══════════════════════════════════════════════════════════════
   GabikOS — rows: the pieces of markup more than one screen draws

   The dashboard shows today's tasks in the same row the Tasks screen
   uses. Keeping that row here means the dashboard does not have to
   load the Tasks screen — with its forms, board view and filters —
   to draw six lines.
   ═══════════════════════════════════════════════════════════════ */
import { icon } from './icons.js';
import { esc, fmtDate, isPast, isToday } from './util.js';
import { projectOf } from './data.js';

export const PRIORITIES = [
  { value: 3, label: 'Urgent', color: '#ff6b6b', tone: 'bad' },
  { value: 2, label: 'High',   color: '#f5b544', tone: 'warn' },
  { value: 1, label: 'Normal', color: '#4cc4f0', tone: 'info' },
  { value: 0, label: 'Low',    color: '#6b7286', tone: '' },
];
export const prio = v => PRIORITIES.find(p => p.value === Number(v)) || PRIORITIES[3];

export function taskRow(t, { showProject = true, compact = false } = {}) {
  const p = prio(t.priority);
  const proj = projectOf(t.projectId);
  const late = !t.done && isPast(t.due);
  return `<div class="task ${t.done ? 'is-done' : ''} ${compact ? 'task--compact' : ''}" data-task="${t.id}">
    <button class="task__check" data-toggle="${t.id}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}"
      style="--pc:${p.color}">
      ${t.done ? '<svg viewBox="0 0 24 24" class="ic ic--sm"><path d="m20 6-11 11-5-5"/></svg>' : ''}
    </button>
    <button class="task__main" data-edit="${t.id}">
      <span class="task__title">${esc(t.title)}</span>
      <span class="task__meta">
        ${t.due ? `<span class="chip ${late ? 'chip--bad' : isToday(t.due) ? 'chip--accent' : ''}">
          ${icon('calendar', 'ic ic--sm')}${esc(fmtDate(t.due))}</span>` : ''}
        ${showProject && proj ? `<span class="chip"><i class="tag-dot" style="background:${esc(proj.color)}"></i>${esc(proj.name)}</span>` : ''}
        ${t.priority >= 2 ? `<span class="chip chip--${p.tone}">${esc(p.label)}</span>` : ''}
        ${t.estimate ? `<span class="chip">${icon('clock', 'ic ic--sm')}${t.estimate}m</span>` : ''}
        ${(t.tags || []).map(tag => `<span class="chip">#${esc(tag)}</span>`).join('')}
      </span>
    </button>
    <div class="task__actions">
      <button class="icon-btn icon-btn--sm" data-menu="${t.id}" aria-label="More">${icon('more')}</button>
    </div>
  </div>`;
}
