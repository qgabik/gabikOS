/* ═══════════════════════════════════════════════════════════════
   GabikOS — Journal: daily entries, mood, gratitude
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, statTile, contextMenu } from '../core/ui.js';
import { esc, today, addDaysISO, fmtDate, by, avg, round, plural, diffDays, parseISO, dayName } from '../core/util.js';
import { markdown, excerpt, wordCount } from '../core/markdown.js';
import { lineChart, heatmap } from '../core/charts.js';

export const MOODS = [
  { value: 1, label: 'Rough',   emoji: '😔', color: '#ff6b6b' },
  { value: 2, label: 'Low',     emoji: '😕', color: '#f5904f' },
  { value: 3, label: 'Okay',    emoji: '😐', color: '#f5b544' },
  { value: 4, label: 'Good',    emoji: '🙂', color: '#7cc98f' },
  { value: 5, label: 'Great',   emoji: '😄', color: '#3ecf8e' },
];
export const moodOf = v => MOODS.find(m => m.value === Number(v)) || MOODS[2];
export const entryFor = date => S().journal.find(e => e.date === date);
export const hasEntryToday = () => !!entryFor(today());

const PROMPTS = [
  'What went well today?',
  'What drained you, and what can you change tomorrow?',
  'Who made your day better?',
  'What did you learn?',
  'What are you avoiding — and why?',
  'What would make tomorrow a win?',
  'What are you proud of right now?',
];

export async function writeEntry(date = today()) {
  const e = entryFor(date) || {};
  const prompt = PROMPTS[parseISO(date).getDate() % PROMPTS.length];
  const v = await openForm({
    title: `${e.id ? 'Edit' : 'New'} entry · ${fmtDate(date)}`,
    size: 'wide', submitLabel: 'Save entry',
    fields: [
      { name: 'mood', label: 'How was today?', type: 'range', half: true, min: 1, max: 5, step: 1, value: e.mood ?? 3 },
      { name: 'energy', label: 'Energy level', type: 'range', half: true, min: 1, max: 5, step: 1, value: e.energy ?? 3 },
      { name: 'text', label: prompt, type: 'textarea', rows: 8, value: e.text,
        placeholder: 'Write freely. Nobody reads this but you.' },
      { name: 'gratitude', label: 'Three good things', type: 'tags', value: e.gratitude,
        placeholder: 'coffee, the walk home, that phone call', hint: 'Separate with commas' },
      { name: 'tags', label: 'Tags', type: 'tags', value: e.tags },
    ],
  });
  if (!v) return;
  if (e.id) store.update('journal', e.id, v);
  else { store.add('journal', { date, ...v }); store.log('journal', 'Wrote a journal entry', 'journal'); }
  toast('Entry saved', 'ok');
  render();
}

registerView('journal', {
  title: 'Journal', icon: 'journal', group: 'Think', order: 35,
  desc: 'Daily reflection and mood',
  keywords: ['journal', 'diary', 'mood', 'reflect', 'gratitude'],
  badge: () => (hasEntryToday() ? null : '•'),

  render(p) {
    const entries = [...S().journal].sort(by('date', -1));
    const head = pageHead('Journal', hasEntryToday() ? "Today's entry is written ✓" : 'You have not written today',
      `<button class="btn btn--primary" data-write>${icon('edit')}${hasEntryToday() ? 'Edit today' : 'Write today'}</button>`, 'journal');

    if (!entries.length) return head + `<div class="card">${emptyState('journal', 'Your journal is empty',
      'Two minutes a day. Future you will be grateful for the record.',
      '<button class="btn btn--primary mt-3" data-write>Write your first entry</button>')}</div>`;

    const last30 = entries.filter(e => diffDays(e.date, today()) >= -30);
    const moodAvg = round(avg(last30.map(e => e.mood).filter(Boolean)), 1);
    const energyAvg = round(avg(last30.map(e => e.energy).filter(Boolean)), 1);
    const words = entries.reduce((a, e) => a + wordCount(e.text || ''), 0);

    /* writing streak */
    let streak = 0, cursor = today();
    if (!entryFor(cursor)) cursor = addDaysISO(cursor, -1);
    while (entryFor(cursor) && streak < 2000) { streak++; cursor = addDaysISO(cursor, -1); }

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Writing streak', value: streak, sub: plural(streak, 'day'), icon: 'flame', tone: streak ? 'warn' : '' })}
      ${statTile({ label: 'Average mood', value: moodAvg ? `${moodOf(Math.round(moodAvg)).emoji} ${moodAvg}` : '—', sub: 'last 30 days', icon: 'smile', tone: moodAvg >= 3.5 ? 'ok' : moodAvg ? 'warn' : '' })}
      ${statTile({ label: 'Average energy', value: energyAvg || '—', sub: 'out of 5', icon: 'zap', tone: 'info' })}
      ${statTile({ label: 'Words written', value: words.toLocaleString(), sub: plural(entries.length, 'entry', 'entries'), icon: 'note' })}
    </div>`;

    const moodSeries = Array.from({ length: 30 }, (_, i) => {
      const d = addDaysISO(today(), -(29 - i));
      const e = entryFor(d);
      return { label: `${parseISO(d).getDate()}/${parseISO(d).getMonth() + 1}`, value: e?.mood ?? null };
    }).filter(x => x.value != null);

    const cells = Array.from({ length: 91 }, (_, i) => {
      const d = addDaysISO(today(), -(90 - i));
      const e = entryFor(d);
      return { level: e ? Math.max(1, e.mood || 3) - 0 : 0, color: e ? moodOf(e.mood).color : null, title: `${d}${e ? ` · ${moodOf(e.mood).label}` : ' · no entry'}` };
    });

    const charts = `<div class="grid grid--2 mb-6">
      <div class="card"><div class="card__head">${icon('activity')}<h3>Mood over 30 days</h3></div>
        <div class="card__body">${moodSeries.length > 1 ? lineChart(moodSeries, { color: '#3ecf8e', format: v => moodOf(v).label.slice(0, 4) })
          : '<div class="chart-empty">Write a few more entries to see the trend</div>'}</div></div>
      <div class="card"><div class="card__head">${icon('calendar')}<h3>Consistency</h3></div>
        <div class="card__body">${heatmap(cells, { cols: 13, title: 'journal entries, last 13 weeks' })}
          <p class="dim mt-3" style="font-size:12px">Each square is a day. Colour follows your mood.</p></div></div>
    </div>`;

    const list = `<div class="journal-list">${entries.slice(0, 40).map(e => {
      const m = moodOf(e.mood);
      return `<article class="jentry card" data-jentry="${e.id}">
        <header class="jentry__head">
          <div class="jentry__date">
            <strong>${parseISO(e.date).getDate()}</strong>
            <span>${dayName(e.date, true)}</span>
          </div>
          <div class="grow">
            <h3>${esc(fmtDate(e.date, { absolute: true }))}</h3>
            <div class="row gap-2 mt-2 row--wrap">
              <span class="chip" style="background:${m.color}22;color:${m.color}">${m.emoji} ${esc(m.label)}</span>
              ${e.energy ? `<span class="chip">${icon('zap', 'ic ic--sm')}energy ${e.energy}/5</span>` : ''}
              ${(e.tags || []).map(t => `<span class="chip">#${esc(t)}</span>`).join('')}
            </div>
          </div>
          <button class="icon-btn icon-btn--sm" data-jmenu="${e.id}">${icon('more')}</button>
        </header>
        ${e.text ? `<div class="jentry__body md">${markdown(e.text)}</div>` : ''}
        ${(e.gratitude || []).length ? `<div class="jentry__grat">
          <span class="jentry__gratlabel">${icon('heart', 'ic ic--sm')}Grateful for</span>
          ${(e.gratitude || []).map(g => `<span class="chip chip--ok">${esc(g)}</span>`).join('')}
        </div>` : ''}
      </article>`;
    }).join('')}</div>`;

    return head + stats + charts + list;
  },

  onMount(root) {
    on(root, 'click', '[data-write]', () => writeEntry());
    on(root, 'click', '[data-jmenu]', (e, el) => {
      const id = el.dataset.jmenu, entry = store.find('journal', id);
      contextMenu(e, [
        { label: 'Edit entry', icon: 'edit', action: () => writeEntry(entry.date) },
        '-',
        { label: 'Delete entry', icon: 'trash', danger: true, action: async () => {
            if (await confirmDialog({ title: 'Delete entry?', message: `Your entry from ${fmtDate(entry.date)} will be removed.`,
              confirmLabel: 'Delete', danger: true })) {
              store.remove('journal', id); toast('Entry deleted', 'ok'); render();
            }
          } },
      ]);
    });
  },
});
