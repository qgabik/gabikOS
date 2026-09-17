/* ═══════════════════════════════════════════════════════════════
   GabikOS — Settings: identity, appearance, goals, data
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings, profile, seedStarter } from '../core/store.js';
import { registerView, navigate, render, params, allViews } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, pageHead, statTile, qs, qsa } from '../core/ui.js';
import { esc, download, pickFile, plural, initials, fmtDate, today, cap, relTime } from '../core/util.js';
import { applyTheme, setTheme, ACCENTS, THEMES, themeById } from '../core/theme.js';
import { sync, syncNow, syncLabel, onSyncChange } from '../core/sync.js';
import { accountCard, wireAccount, openAuth } from './account.js';

export const SHORTCUTS = [
  ['Ctrl / ⌘ + K', 'Open the command palette'],
  ['Ctrl / ⌘ + N', 'Create something new'],
  ['Ctrl / ⌘ + B', 'Collapse the sidebar'],
  ['Ctrl / ⌘ + /', 'Toggle dark and light'],
  ['Ctrl / ⌘ + Z', 'Undo the last change'],
  ['G then D', 'Go to Dashboard'],
  ['G then T', 'Go to Tasks'],
  ['G then H', 'Go to Habits'],
  ['G then N', 'Go to Notes'],
  ['G then F', 'Go to Focus'],
  ['?', 'Show this shortcut list'],
  ['Esc', 'Close any dialog'],
];

export function showShortcuts() {
  import('../core/ui.js').then(({ modal }) => modal.open({
    title: 'Keyboard shortcuts', size: 'slim',
    body: `<div class="shortcuts">${SHORTCUTS.map(([k, d]) => `
      <div class="shortcut"><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>`,
    footer: `<div class="grow"></div><button class="btn btn--primary" onclick="document.getElementById('modalClose').click()">Got it</button>`,
  }));
}

registerView('settings', {
  title: 'Settings', icon: 'settings', group: 'System', order: 900,
  desc: 'Appearance, goals, data and backups',
  keywords: ['settings', 'preferences', 'theme', 'backup', 'export', 'import', 'data', 'accent'],

  render(p) {
    const tab = p.tab || 'general';
    const s = settings(), pr = profile();
    const usage = store.usage();
    const counts = {
      tasks: S().tasks.length, notes: S().notes.length, habits: S().habits.length,
      events: S().events.length, journal: S().journal.length, workouts: S().workouts.length,
      transactions: S().transactions.length, goals: S().goals.length,
      records: Object.values(S().records || {}).reduce((a, r) => a + r.length, 0),
    };

    const tabs = [['general', 'General', 'user'], ['appearance', 'Appearance', 'palette'],
      ['goals', 'Daily goals', 'target'], ['focus', 'Focus', 'timer'], ['data', 'Data', 'database'],
      ['about', 'About', 'info']];

    const head = pageHead('Settings', 'Make GabikOS fit the way you live', '', 'settings') + `
      <div class="seg mb-6" data-tabs>
        ${tabs.map(([k, l, ic]) => `<button class="${tab === k ? 'is-on' : ''}" data-tab="${k}">${icon(ic)}${esc(l)}</button>`).join('')}
      </div>`;

    let body = '';

    if (tab === 'general') {
      body = `<div class="grid grid--2">
        <div class="card"><div class="card__head">${icon('user')}<h3>Who you are</h3></div>
          <div class="card__body col gap-4">
            <div class="row gap-4">
              <span class="avatar" style="width:54px;height:54px;font-size:20px">${esc(initials(pr.name))}</span>
              <div class="grow">
                <div class="field"><label class="field__label">Name</label>
                  <input class="input" data-set="profile.name" value="${esc(pr.name || '')}" placeholder="Your name" /></div>
              </div>
            </div>
            <div class="field"><label class="field__label">Tagline</label>
              <input class="input" data-set="profile.tagline" value="${esc(pr.tagline || '')}" placeholder="A line that keeps you honest" />
              <div class="field__hint">Shown under your name in the sidebar</div></div>
          </div></div>

        <div class="card"><div class="card__head">${icon('settings')}<h3>Preferences</h3></div>
          <div class="card__body col gap-4">
            <div class="field"><label class="field__label">Currency symbol</label>
              <input class="input" data-set="settings.currency" value="${esc(s.currency)}" maxlength="3" /></div>
            <div class="field"><label class="field__label">Week starts on</label>
              <select class="select" data-set="settings.weekStartsOn">
                <option value="1"${s.weekStartsOn === 1 ? ' selected' : ''}>Monday</option>
                <option value="0"${s.weekStartsOn === 0 ? ' selected' : ''}>Sunday</option>
              </select></div>
          </div></div>
      </div>

      <div class="card mt-4"><div class="card__head">${icon('keyboard')}<h3>Keyboard shortcuts</h3></div>
        <div class="card__body"><div class="shortcuts">
          ${SHORTCUTS.map(([k, d]) => `<div class="shortcut"><span>${esc(d)}</span><kbd>${esc(k)}</kbd></div>`).join('')}
        </div></div></div>`;
    }

    if (tab === 'appearance') {
      const cur = s.theme === 'auto' ? 'auto' : themeById(s.theme).id;
      body = `<div class="card mb-4"><div class="card__head">${icon('palette')}<h3>Theme</h3>
        <span class="chip">${esc(THEMES.length)} palettes</span></div>
        <div class="card__body">
          <p class="dim mb-4" style="font-size:13px">Every palette is tuned for long sessions — no pure black,
            no pure white, and body text held at about 11:1 instead of the glare of maximum contrast.</p>
          <div class="theme-gallery">
            ${THEMES.map(t => `
              <button class="theme-card ${cur === t.id ? 'is-on' : ''}" data-theme-set="${t.id}"
                style="--c1:${t.swatch[0]};--c2:${t.swatch[1]}">
                <span class="theme-card__prev">
                  <span class="theme-card__bar"></span><span class="theme-card__dot"></span>
                </span>
                <strong>${esc(t.name)}</strong>
                <small>${esc(t.hint)}</small>
              </button>`).join('')}
            <button class="theme-card ${cur === 'auto' ? 'is-on' : ''}" data-theme-set="auto"
              style="--c1:#12141c;--c2:#f7f8fc">
              <span class="theme-card__prev theme-card__prev--auto">
                <span class="theme-card__bar"></span><span class="theme-card__dot"></span>
              </span>
              <strong>Match system</strong>
              <small>Follows your device, light by day and dark by night.</small>
            </button>
          </div>
        </div></div>

      <div class="card mb-4"><div class="card__head">${icon('sparkles')}<h3>Accent colour</h3></div>
        <div class="card__body">
          <div class="accent-pick">
            ${ACCENTS.map(a => `<button class="accent-opt ${s.accent.toLowerCase() === a.hex.toLowerCase() ? 'is-on' : ''}"
              data-accent="${a.hex}" style="--a:${a.hex}" title="${esc(a.name)}">
              <span></span><small>${esc(a.name)}</small></button>`).join('')}
          </div>
          <div class="row gap-3 mt-4 row--wrap">
            <label class="field__label">Custom</label>
            <input type="color" class="input" style="width:70px" value="${esc(s.accent)}" data-accent-custom />
            <span class="dim" style="font-size:12.5px">Any colour you pick is darkened or lightened
              automatically until it stays readable on the palette you chose.</span>
          </div>
          <hr class="divider" />
          <label class="check">
            <input type="checkbox" data-toggle-set="colorfulNav"${s.colorfulNav ? ' checked' : ''} />
            <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
            <span>Give every module its own colour</span>
          </label>
          <div class="field__hint" style="margin-left:29px">Tasks blue, habits green, money gold — so the
            sidebar reads as places rather than a list.</div>
        </div></div>

      <div class="card"><div class="card__head">${icon('eye')}<h3>Reading comfort</h3></div>
        <div class="card__body col gap-5">
          <div>
            <div class="row row--between mb-2">
              <label class="field__label">Text size</label>
              <strong class="mono" style="font-size:13px">${Math.round((s.textScale || 1) * 100)}%</strong>
            </div>
            <input type="range" class="range" min="0.85" max="1.3" step="0.05"
              value="${s.textScale || 1}" data-scale />
            <div class="field__hint">Scales the whole interface, not just body copy.</div>
          </div>
          <div>
            <label class="field__label mb-2">Row spacing</label>
            <div class="seg" data-density-set>
              ${['compact', 'normal', 'roomy'].map(d => `<button class="${(s.density || 'normal') === d ? 'is-on' : ''}"
                data-density="${d}">${esc(cap(d))}</button>`).join('')}
            </div>
          </div>
        </div></div>`;
    }

    if (tab === 'goals') {
      const g = s.goals;
      body = `<div class="card"><div class="card__head">${icon('target')}<h3>Daily targets</h3></div>
        <div class="card__body">
          <p class="dim mb-4" style="font-size:13px">These drive the rings and progress bars on your dashboard.</p>
          <div class="form-grid form-grid--2">
            ${[['water', 'Water (glasses)', 1, 30, 'droplet'], ['steps', 'Steps', 500, 50000, 'footprints'],
               ['sleep', 'Sleep (hours)', 4, 12, 'bed'], ['focusMins', 'Focus (minutes)', 15, 720, 'timer']].map(([k, l, min, max, ic]) => `
              <div class="field"><label class="field__label">${icon(ic, 'ic ic--sm')}${esc(l)}</label>
                <input class="input" type="number" min="${min}" max="${max}" value="${g[k]}" data-set="settings.goals.${k}" /></div>`).join('')}
          </div>
        </div></div>`;
    }

    if (tab === 'focus') {
      const po = s.pomodoro;
      body = `<div class="card"><div class="card__head">${icon('timer')}<h3>Pomodoro intervals</h3></div>
        <div class="card__body">
          <p class="dim mb-4" style="font-size:13px">The classic is 25 / 5 / 15 with a long break every 4 rounds. Tune it to your attention span.</p>
          <div class="form-grid form-grid--2">
            ${[['focus', 'Focus session (min)', 5, 120], ['short', 'Short break (min)', 1, 30],
               ['long', 'Long break (min)', 5, 60], ['rounds', 'Rounds before long break', 2, 10]].map(([k, l, min, max]) => `
              <div class="field"><label class="field__label">${esc(l)}</label>
                <input class="input" type="number" min="${min}" max="${max}" value="${po[k]}" data-set="settings.pomodoro.${k}" /></div>`).join('')}
          </div>
        </div></div>`;
    }

    if (tab === 'data') {
      const sl = syncLabel();
      body = accountCard() + `
      <div class="card card--pad mb-4 callout" data-sync-card>
        <div class="row gap-3 row--wrap">
          <span class="stat__icon">${icon(sl.icon)}</span>
          <div class="grow">
            <div class="row gap-2 row--wrap">
              <h3>${sync.enabled ? 'Synced across your devices' : 'Saved on this device'}</h3>
              <span class="chip ${sl.tone ? 'chip--' + sl.tone : ''}" data-sync-chip>${esc(sl.text)}</span>
            </div>
            <p class="dim mt-2" style="font-size:13.2px">
              ${sync.enabled
                ? `Your data is kept in private storage tied to your account, so what you write on your phone
                   is here on your computer and the other way round. It stays private to you — nobody else
                   can read it, not even through a shared link.
                   ${sync.lastPull ? `Last update received ${esc(relTime(sync.lastPull))}.` : ''}`
                : `This copy has nowhere to sign you in, so your data lives in this browser only. It is completely
                   private — and it also means clearing your browser data deletes it, and a second device starts
                   empty. <strong>Export a backup regularly</strong>, or use the claude.ai copy, which syncs.`}
            </p>
            ${sync.detail ? `<p class="dim mt-2" style="font-size:12px">${esc(sync.detail)}</p>` : ''}
            ${sync.enabled ? `<button class="btn btn--sm mt-3" data-sync-now>${icon('refresh')}Sync now</button>` : ''}
          </div>
        </div>
      </div>

      <div class="grid grid--stat mb-4">
        ${statTile({ label: 'Storage used', value: usage.kb + ' KB', sub: `${usage.pct}% of the browser limit`, icon: 'database', tone: usage.pct > 80 ? 'warn' : 'ok' })}
        ${statTile({ label: 'Tasks', value: counts.tasks, sub: plural(S().projects.length, 'project'), icon: 'checkSquare' })}
        ${statTile({ label: 'Notes', value: counts.notes, sub: plural(counts.journal, 'journal entry', 'journal entries'), icon: 'note' })}
        ${statTile({ label: 'Custom records', value: counts.records, sub: plural(S().collections.length, 'tracker'), icon: 'layers' })}
      </div>

      <div class="grid grid--2">
        <div class="card"><div class="card__head">${icon('download')}<h3>Backup</h3></div>
          <div class="card__body col gap-3">
            <p class="dim" style="font-size:13px">One JSON file with everything: tasks, notes, habits, history, custom trackers and settings.</p>
            <button class="btn btn--primary" data-export>${icon('download')}Export everything</button>
            <button class="btn" data-export-md>${icon('note')}Export notes as Markdown</button>
          </div></div>

        <div class="card"><div class="card__head">${icon('upload')}<h3>Restore</h3></div>
          <div class="card__body col gap-3">
            <p class="dim" style="font-size:13px">Load a backup file. Replace wipes what is here; merge keeps both.</p>
            <button class="btn" data-import="replace">${icon('upload')}Import and replace</button>
            <button class="btn" data-import="merge">${icon('layers')}Import and merge</button>
          </div></div>
      </div>

      <div class="card mt-4"><div class="card__head">${icon('alert')}<h3>Danger zone</h3></div>
        <div class="card__body col gap-3">
          <div class="row row--between row--wrap gap-3">
            <div><strong style="font-size:13.6px">Load starter content</strong>
              <p class="dim" style="font-size:12.5px">Adds example habits, tasks and a welcome note.</p></div>
            <button class="btn btn--sm" data-seed>Load starter content</button>
          </div>
          <hr class="divider" style="margin:4px 0" />
          <div class="row row--between row--wrap gap-3">
            <div><strong style="font-size:13.6px;color:var(--bad)">Erase everything</strong>
              <p class="dim" style="font-size:12.5px">Deletes all your data on this device. There is no undo.</p></div>
            <button class="btn btn--danger btn--sm" data-reset>Erase all data</button>
          </div>
        </div></div>`;
    }

    if (tab === 'about') {
      body = `<div class="card card--pad about">
        <div class="about__logo">G</div>
        <h2>GabikOS</h2>
        <p class="dim">A personal operating system for your whole life — tasks, habits, notes, health,
          money, goals and anything else you decide to track.</p>
        <div class="grid grid--3 mt-6" style="width:100%">
          ${[['lock', 'Private by design', 'No account, no server, no analytics. Your data never leaves this device.'],
             ['zap', 'Instant', 'No build step, no framework, no dependencies. It loads in milliseconds.'],
             ['layers', 'Yours to shape', 'The Builder lets you create trackers nobody else thought of.']].map(([ic, t, d]) => `
            <div class="about__feat">${icon(ic, 'ic ic--lg')}<strong>${esc(t)}</strong><p class="dim">${esc(d)}</p></div>`).join('')}
        </div>
        <div class="row gap-2 mt-6">
          <button class="btn" data-shortcuts>${icon('keyboard')}Keyboard shortcuts</button>
          <button class="btn" data-go-builder>${icon('layers')}Open the Builder</button>
        </div>
        <p class="dim mt-6" style="font-size:12px">Built ${esc(fmtDate(today(), { absolute: true }))} · ${plural(allViews().length, 'module')} loaded</p>
      </div>`;
    }

    return head + body;
  },

  onMount(root) {
    on(root, 'click', '[data-tab]', (e, el) => navigate('settings', { tab: el.dataset.tab }));

    /* live-bound inputs */
    qsa('[data-set]', root).forEach(inp => {
      inp.addEventListener('change', () => {
        const path = inp.dataset.set;
        let val = inp.type === 'number' ? Number(inp.value) : inp.value;
        if (path === 'settings.weekStartsOn') val = Number(val);
        if (path.startsWith('profile.')) store.setProfile({ [path.slice(8)]: val });
        else store.setSetting(path.replace(/^settings\./, ''), val);
        toast('Saved', 'ok', { duration: 1400 });
        document.dispatchEvent(new CustomEvent('gabikos:chrome'));
      });
    });

    on(root, 'click', '[data-theme-set]', (e, el) => {
      setTheme(el.dataset.themeSet);
      render();
      document.dispatchEvent(new CustomEvent('gabikos:chrome'));
    });
    on(root, 'click', '[data-density]', (e, el) => {
      store.setSetting('density', el.dataset.density);
      applyTheme(); render();
    });
    on(root, 'change', '[data-toggle-set]', (e, el) => {
      store.setSetting(el.dataset.toggleSet, el.checked);
      applyTheme(); render();
      document.dispatchEvent(new CustomEvent('gabikos:chrome'));
    });
    root.querySelector('[data-scale]')?.addEventListener('input', e => {
      store.setSetting('textScale', Number(e.target.value));
      applyTheme();
      const out = root.querySelector('[data-scale]')?.previousElementSibling?.querySelector('strong');
      if (out) out.textContent = Math.round(Number(e.target.value) * 100) + '%';
    });
    wireAccount(root);
    on(root, 'click', '[data-accent]', (e, el) => {
      store.setSetting('accent', el.dataset.accent);
      applyTheme();
      render();
    });
    root.querySelector('[data-accent-custom]')?.addEventListener('input', e => {
      store.setSetting('accent', e.target.value);
      applyTheme();
    });

    on(root, 'click', '[data-export]', () => {
      download(`gabikos-backup-${today()}.json`, store.toJSON());
      toast('Backup downloaded — keep it somewhere safe', 'ok');
    });
    on(root, 'click', '[data-export-md]', () => {
      const md = S().notes.map(n => `# ${n.title}\n\n_${n.folder || 'Inbox'}${(n.tags || []).length ? ' · ' + n.tags.map(t => '#' + t).join(' ') : ''}_\n\n${n.body}\n\n---\n`).join('\n');
      download(`gabikos-notes-${today()}.md`, md || '# No notes yet', 'text/markdown');
      toast('Notes exported', 'ok');
    });

    on(root, 'click', '[data-import]', async (e, el) => {
      const merge = el.dataset.import === 'merge';
      const file = await pickFile('application/json');
      if (!file) return;
      const ok = await confirmDialog({
        title: merge ? 'Merge this backup?' : 'Replace everything?',
        message: merge ? `New items from “${file.name}” will be added alongside what you already have.`
                       : `Everything currently in GabikOS will be replaced by “${file.name}”.`,
        confirmLabel: merge ? 'Merge' : 'Replace everything', danger: !merge,
      });
      if (!ok) return;
      try {
        store.importJSON(file.content, { merge });
        const { registerCollections } = await import('./builder.js');
        registerCollections();
        applyTheme();
        toast('Backup restored', 'ok');
        document.dispatchEvent(new CustomEvent('gabikos:chrome'));
        render();
      } catch (err) {
        toast(`Could not read that file: ${err.message}`, 'bad', { duration: 6000 });
      }
    });

    on(root, 'click', '[data-seed]', async () => {
      if (await confirmDialog({ title: 'Load starter content?',
        message: 'Adds example habits, tasks, a goal and a welcome note alongside your existing data.', confirmLabel: 'Load it' })) {
        seedStarter();
        toast('Starter content loaded', 'ok');
        render();
      }
    });

    on(root, 'click', '[data-reset]', async () => {
      const ok = await confirmDialog({
        title: 'Erase all data?',
        message: 'Every task, note, habit, journal entry and custom tracker on this device will be deleted. Export a backup first if you are not certain.',
        confirmLabel: 'Erase everything', danger: true,
      });
      if (!ok) return;
      const sure = await confirmDialog({
        title: 'Really sure?', message: 'This cannot be undone.', confirmLabel: 'Yes, erase it all', danger: true,
      });
      if (!sure) return;
      store.reset();
      const { registerCollections } = await import('./builder.js');
      registerCollections();
      toast('All data erased', 'info');
      document.dispatchEvent(new CustomEvent('gabikos:chrome'));
      navigate('dashboard');
    });

    on(root, 'click', '[data-shortcuts]', showShortcuts);
    on(root, 'click', '[data-go-builder]', () => navigate('builder'));
  },
});
