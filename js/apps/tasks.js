/* ═══════════════════════════════════════════════════════════════
   GabikOS — Tasks: projects, priorities, list & board
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, qs, qsa } from '../core/ui.js';
import { esc, today, iso, fmtDate, isPast, isToday, diffDays, by, uid, plural, addDaysISO } from '../core/util.js';

export const PRIORITIES = [
  { value: 3, label: 'Urgent', color: '#ff6b6b', tone: 'bad' },
  { value: 2, label: 'High',   color: '#f5b544', tone: 'warn' },
  { value: 1, label: 'Normal', color: '#4cc4f0', tone: 'info' },
  { value: 0, label: 'Low',    color: '#6b7286', tone: '' },
];
export const prio = v => PRIORITIES.find(p => p.value === Number(v)) || PRIORITIES[3];

/* ─── Queries ─── */
export const openTasks = () => S().tasks.filter(t => !t.done);
export const dueToday = () => openTasks().filter(t => t.due && diffDays(t.due, today()) <= 0);
export const overdue = () => openTasks().filter(t => t.due && isPast(t.due));
export const projectOf = id => S().projects.find(p => p.id === id);

/* ─── Mutations ─── */
export function toggleTask(id) {
  const t = store.find('tasks', id);
  if (!t) return;
  const done = !t.done;
  store.update('tasks', id, { done, completedAt: done ? Date.now() : null });
  if (done) {
    store.log('check', `Completed “${t.title}”`, 'tasks');
    const left = openTasks().length;
    toast(left ? `Done — ${plural(left, 'task')} left` : 'Done — inbox zero! 🎉', 'ok', {
      action: 'Undo', onAction: () => { store.update('tasks', id, { done: false, completedAt: null }); render(); },
    });
  }
  render();
}

const taskFields = (t = {}) => [
  { name: 'title', label: 'What needs doing?', type: 'text', required: true, placeholder: 'e.g. Book the dentist', value: t.title },
  { name: 'notes', label: 'Notes', type: 'textarea', rows: 3, placeholder: 'Any detail worth remembering…', value: t.notes },
  { name: 'due', label: 'Due date', type: 'date', half: true, value: t.due || '' },
  { name: 'priority', label: 'Priority', type: 'select', half: true, value: t.priority ?? 1,
    options: PRIORITIES.map(p => ({ value: p.value, label: p.label })) },
  { name: 'projectId', label: 'Project', type: 'select', half: true, value: t.projectId || '',
    options: [{ value: '', label: 'No project' }, ...S().projects.map(p => ({ value: p.id, label: p.name }))] },
  { name: 'estimate', label: 'Estimate (min)', type: 'number', half: true, min: 0, step: 5, value: t.estimate },
  { name: 'tags', label: 'Tags', type: 'tags', value: t.tags },
];

export async function newTask(preset = {}) {
  const v = await openForm({ title: 'New task', fields: taskFields(preset), submitLabel: 'Add task' });
  if (!v) return null;
  const t = store.add('tasks', { ...v, priority: Number(v.priority), done: false, ...preset, title: v.title });
  toast('Task added', 'ok');
  render();
  return t;
}

export async function editTask(id) {
  const t = store.find('tasks', id);
  if (!t) return;
  const v = await openForm({
    title: 'Edit task', fields: taskFields(t), values: t, submitLabel: 'Save',
    extraFooter: `<button class="btn btn--danger btn--sm" data-act="del" type="button">Delete</button>`,
    onMount: (_b, foot) => {
      foot.querySelector('[data-act=del]').onclick = async () => {
        qs('#modal').hidden = true;
        if (await confirmDialog({ title: 'Delete task?', message: `“${t.title}” will be removed permanently.`, confirmLabel: 'Delete', danger: true })) {
          store.remove('tasks', id); toast('Task deleted', 'ok'); render();
        } else { qs('#modal').hidden = false; }
      };
    },
  });
  if (!v) return;
  store.update('tasks', id, { ...v, priority: Number(v.priority) });
  toast('Task updated', 'ok');
  render();
}

export async function newProject() {
  const v = await openForm({
    title: 'New project',
    fields: [
      { name: 'name', label: 'Project name', type: 'text', required: true, placeholder: 'e.g. Apartment move' },
      { name: 'color', label: 'Colour', type: 'color', value: '#7c5cff' },
      { name: 'goal', label: 'What does done look like?', type: 'textarea', rows: 2 },
    ],
    submitLabel: 'Create project',
  });
  if (!v) return;
  store.add('projects', v);
  toast(`Project “${v.name}” created`, 'ok');
  render();
}

/* ─── Row renderer (shared with Dashboard) ─── */
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

/* ─── View ─── */
registerView('tasks', {
  title: 'Tasks', icon: 'checkSquare', group: 'Do', order: 10,
  desc: 'Everything you need to get done',
  keywords: ['todo', 'task', 'project', 'inbox'],
  badge: () => dueToday().length || null,

  render(p) {
    const tasks = S().tasks;
    const filter = p.filter || 'today';
    const projectId = p.project || '';
    const mode = p.mode || 'list';

    let shown = tasks;
    if (projectId) shown = shown.filter(t => t.projectId === projectId);
    const counts = {
      today: tasks.filter(t => !t.done && t.due && diffDays(t.due, today()) <= 0).length,
      upcoming: tasks.filter(t => !t.done && t.due && diffDays(t.due, today()) > 0).length,
      someday: tasks.filter(t => !t.done && !t.due).length,
      all: tasks.filter(t => !t.done).length,
      done: tasks.filter(t => t.done).length,
    };
    if (filter === 'today') shown = shown.filter(t => !t.done && t.due && diffDays(t.due, today()) <= 0);
    else if (filter === 'upcoming') shown = shown.filter(t => !t.done && t.due && diffDays(t.due, today()) > 0);
    else if (filter === 'someday') shown = shown.filter(t => !t.done && !t.due);
    else if (filter === 'done') shown = shown.filter(t => t.done);
    else shown = shown.filter(t => !t.done);

    shown = [...shown].sort(by(t => (t.done ? 1 : 0)))
      .sort(by(t => (filter === 'done' ? -(t.completedAt || 0) : (t.due || '9999-99-99'))))
      .sort(by(t => -(t.priority ?? 1)));

    const tabs = [
      ['today', 'Today', counts.today], ['upcoming', 'Upcoming', counts.upcoming],
      ['someday', 'Someday', counts.someday], ['all', 'All open', counts.all], ['done', 'Done', counts.done],
    ];

    const head = pageHead('Tasks', `${plural(counts.all, 'open task')} · ${counts.done} completed`, `
      <div class="seg" data-mode>
        <button class="${mode === 'list' ? 'is-on' : ''}" data-m="list">${icon('list')}<span class="hide-sm">List</span></button>
        <button class="${mode === 'board' ? 'is-on' : ''}" data-m="board">${icon('columns')}<span class="hide-sm">Board</span></button>
      </div>
      <button class="btn btn--primary" data-new-task>${icon('plus')}New task</button>`, 'checkSquare');

    const filterBar = `
      <div class="filterbar">
        <div class="seg" data-filter>
          ${tabs.map(([k, l, n]) => `<button class="${filter === k ? 'is-on' : ''}" data-f="${k}">
            ${esc(l)}${n ? ` <b class="seg__n">${n}</b>` : ''}</button>`).join('')}
        </div>
        <div class="grow"></div>
        <select class="select select--inline" data-project>
          <option value="">All projects</option>
          ${S().projects.map(pr => `<option value="${pr.id}"${projectId === pr.id ? ' selected' : ''}>${esc(pr.name)}</option>`).join('')}
        </select>
        <button class="btn btn--sm" data-new-project>${icon('folder')}<span class="hide-sm">Project</span></button>
      </div>`;

    if (mode === 'board') return head + filterBar + boardHtml(projectId);

    const body = shown.length
      ? `<div class="card"><div class="tasks">${shown.map(t => taskRow(t)).join('')}</div></div>`
      : `<div class="card">${emptyState('checkSquare',
          filter === 'done' ? 'Nothing completed yet' : 'All clear',
          filter === 'today' ? 'No tasks due today. Enjoy it, or pull something forward.' : 'Nothing here right now.',
          filter !== 'done' ? '<button class="btn btn--primary mt-3" data-new-task>Add a task</button>' : '')}</div>`;

    return head + filterBar + body;
  },

  onMount(root) {
    on(root, 'click', '[data-new-task]', () => {
      // the default tab is Today, so a task made there should land there
      const f = params().filter || 'today';
      newTask({ due: f === 'today' ? today() : '', projectId: params().project || '' });
    });
    on(root, 'click', '[data-new-project]', newProject);
    on(root, 'click', '[data-toggle]', (e, el) => toggleTask(el.dataset.toggle));
    on(root, 'click', '[data-edit]', (e, el) => editTask(el.dataset.edit));
    on(root, 'click', '[data-f]', (e, el) => navigate('tasks', { ...params(), filter: el.dataset.f }));
    on(root, 'click', '[data-m]', (e, el) => navigate('tasks', { ...params(), mode: el.dataset.m }));
    root.querySelector('[data-project]')?.addEventListener('change', e =>
      navigate('tasks', { ...params(), project: e.target.value }));

    on(root, 'click', '[data-menu]', (e, el) => {
      const id = el.dataset.menu;
      const t = store.find('tasks', id);
      contextMenu(e, [
        { label: 'Edit', icon: 'edit', action: () => editTask(id) },
        { label: t.done ? 'Mark not done' : 'Mark done', icon: 'check', action: () => toggleTask(id) },
        '-',
        { label: 'Due today', icon: 'calendar', action: () => { store.update('tasks', id, { due: today() }); render(); } },
        { label: 'Due tomorrow', icon: 'arrowRight', action: () => { store.update('tasks', id, { due: addDaysISO(today(), 1) }); render(); } },
        { label: 'Next week', icon: 'calendar', action: () => { store.update('tasks', id, { due: addDaysISO(today(), 7) }); render(); } },
        { label: 'Clear date', icon: 'x', action: () => { store.update('tasks', id, { due: '' }); render(); } },
        '-',
        { label: 'Duplicate', icon: 'copy', action: () => {
            store.add('tasks', { ...t, id: undefined, done: false, completedAt: null, title: t.title + ' (copy)' });
            toast('Duplicated', 'ok'); render();
          } },
        { label: 'Delete', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete task?', message: `“${t.title}” will be removed.`, confirmLabel: 'Delete', danger: true })) {
              store.remove('tasks', id); toast('Task deleted', 'ok'); render();
            }
          } },
      ]);
    });

    /* board drag & drop */
    qsa('[data-col]', root).forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('is-over'); });
      col.addEventListener('dragleave', () => col.classList.remove('is-over'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('is-over');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        const target = col.dataset.col;
        const patch = target === 'done'
          ? { done: true, completedAt: Date.now() }
          : { done: false, completedAt: null, due: target === 'today' ? today()
              : target === 'upcoming' ? addDaysISO(today(), 1) : '' };
        store.update('tasks', id, patch);
        render();
      });
    });
    qsa('[draggable=true]', root).forEach(card => {
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', card.dataset.task);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    });
  },
});

function boardHtml(projectId) {
  const cols = [
    { key: 'someday', label: 'Someday', icon: 'inbox', test: t => !t.done && !t.due },
    { key: 'upcoming', label: 'Upcoming', icon: 'calendar', test: t => !t.done && t.due && diffDays(t.due, today()) > 0 },
    { key: 'today', label: 'Today', icon: 'zap', test: t => !t.done && t.due && diffDays(t.due, today()) <= 0 },
    { key: 'done', label: 'Done', icon: 'check', test: t => t.done },
  ];
  const pool = projectId ? S().tasks.filter(t => t.projectId === projectId) : S().tasks;
  return `<div class="board">
    ${cols.map(c => {
      const items = pool.filter(c.test)
        .sort(by(t => -(t.priority ?? 1)))
        .slice(0, c.key === 'done' ? 25 : 200);
      return `<section class="board__col" data-col="${c.key}">
        <header class="board__head">
          ${icon(c.icon, 'ic ic--sm')}<h4>${c.label}</h4><span class="nav__badge">${items.length}</span>
        </header>
        <div class="board__list">
          ${items.map(t => {
            const p = prio(t.priority), proj = projectOf(t.projectId);
            return `<article class="tcard ${t.done ? 'is-done' : ''}" draggable="true" data-task="${t.id}">
              <div class="tcard__top">
                <button class="task__check task__check--sm" data-toggle="${t.id}" style="--pc:${p.color}">
                  ${t.done ? '<svg viewBox="0 0 24 24" class="ic ic--sm"><path d="m20 6-11 11-5-5"/></svg>' : ''}
                </button>
                <button class="tcard__title" data-edit="${t.id}">${esc(t.title)}</button>
              </div>
              <div class="tcard__meta">
                ${proj ? `<span class="chip"><i class="tag-dot" style="background:${esc(proj.color)}"></i>${esc(proj.name)}</span>` : ''}
                ${t.due ? `<span class="chip ${isPast(t.due) && !t.done ? 'chip--bad' : ''}">${esc(fmtDate(t.due))}</span>` : ''}
                ${t.priority >= 2 ? `<span class="chip chip--${p.tone}">${esc(p.label)}</span>` : ''}
              </div>
            </article>`;
          }).join('') || `<p class="board__empty">Drop tasks here</p>`}
        </div>
      </section>`;
    }).join('')}
  </div>`;
}
