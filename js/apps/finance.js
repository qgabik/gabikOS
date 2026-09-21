/* ═══════════════════════════════════════════════════════════════
   GabikOS — Money: income, expenses, budgets, trends
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile } from '../core/ui.js';
import { esc, today, iso, monthKey, monthName, parseISO, fmtMoney, sum, by, pct, plural,
         addDaysISO, fmtDate, round, groupBy } from '../core/util.js';
import { donut, legend, groupedBars, seriesColor } from '../core/charts.js';

export const CATEGORIES = {
  income:  ['Salary', 'Freelance', 'Gift', 'Refund', 'Investment', 'Other income'],
  expense: ['Food', 'Groceries', 'Rent', 'Bills', 'Transport', 'Health', 'Shopping',
            'Fun', 'Subscriptions', 'Travel', 'Education', 'Other'],
};
const cur = () => settings().currency || '€';
export const money = v => fmtMoney(v, cur());

export const txOfMonth = (mk = monthKey()) => S().transactions.filter(t => (t.date || '').startsWith(mk));
export const monthIncome = mk => sum(txOfMonth(mk).filter(t => t.type === 'income').map(t => t.amount));
export const monthExpense = mk => sum(txOfMonth(mk).filter(t => t.type === 'expense').map(t => t.amount));
export const monthNet = mk => monthIncome(mk) - monthExpense(mk);

const txFields = (t = {}) => [
  { name: 'type', label: 'Type', type: 'select', half: true, value: t.type || 'expense',
    options: [{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
  { name: 'amount', label: `Amount (${cur()})`, type: 'number', half: true, required: true, min: 0, step: 0.01, value: t.amount },
  { name: 'description', label: 'Description', type: 'text', required: true, placeholder: 'e.g. Weekly shop', value: t.description },
  { name: 'category', label: 'Category', type: 'select', half: true, value: t.category || 'Food',
    options: [...CATEGORIES.expense, ...CATEGORIES.income] },
  { name: 'date', label: 'Date', type: 'date', half: true, required: true, value: t.date || today() },
  { name: 'notes', label: 'Notes', type: 'text', placeholder: 'optional', value: t.notes },
];

export async function newTransaction(preset = {}) {
  const v = await openForm({ title: 'New transaction', fields: txFields(preset), values: preset, submitLabel: 'Add' });
  if (!v) return;
  store.add('transactions', { ...v, amount: Math.abs(Number(v.amount) || 0) });
  toast(`${v.type === 'income' ? 'Income' : 'Expense'} recorded`, 'ok');
  render();
}

async function editTx(id) {
  const t = store.find('transactions', id);
  if (!t) return;
  const v = await openForm({ title: 'Edit transaction', fields: txFields(t), values: t, submitLabel: 'Save' });
  if (!v) return;
  store.update('transactions', id, { ...v, amount: Math.abs(Number(v.amount) || 0) });
  toast('Updated', 'ok'); render();
}

async function editBudget(category) {
  const b = S().budgets.find(x => x.category === category);
  const v = await openForm({
    title: `Budget · ${category}`, submitLabel: 'Save',
    fields: [{ name: 'limit', label: `Monthly limit (${cur()})`, type: 'number', min: 0, step: 1,
      value: b?.limit ?? '', required: true, hint: 'Set 0 to remove the budget' }],
  });
  if (!v) return;
  const limit = Number(v.limit) || 0;
  if (b) {
    if (limit <= 0) store.remove('budgets', b.id);
    else store.update('budgets', b.id, { limit });
  } else if (limit > 0) store.add('budgets', { category, limit });
  toast('Budget saved', 'ok'); render();
}

registerView('finance', {
  title: 'Money', icon: 'wallet', group: 'Life', order: 60,
  desc: 'Income, spending and budgets',
  keywords: ['money', 'finance', 'budget', 'expense', 'income', 'spending'],

  render(p) {
    const mk = p.m || monthKey();
    const tx = txOfMonth(mk).sort(by('date', -1));
    const inc = monthIncome(mk), exp = monthExpense(mk), net = inc - exp;
    const prevMk = monthKey(new Date(parseISO(mk + '-01').setMonth(parseISO(mk + '-01').getMonth() - 1)));
    const prevExp = monthExpense(prevMk);
    const mDate = parseISO(mk + '-01');

    /* Pace. A month is only half an answer without how much of it has gone:
       €255 on the 21st is a different thing from €255 on the 3rd. */
    const daysInMonth = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0).getDate();
    const isThisMonth = mk === monthKey();
    const dayNow = isThisMonth ? new Date().getDate() : daysInMonth;
    const perDay = dayNow ? exp / dayNow : 0;
    const projected = perDay * daysInMonth;
    const elapsed = pct(dayNow, daysInMonth);


    /* One column of everything meant 3,000 pixels of scrolling to reach a
       receipt. Three short screens instead, the way every other module here
       is arranged. */
    const view = p.view || 'overview';
    const head = pageHead('Money',
      S().transactions.length ? `${money(exp)} out · ${money(inc)} in` : 'Income, spending and budgets', `
      <div class="seg">
        ${[['overview', 'Overview'], ['budgets', 'Budgets'], ['history', 'History']]
          .map(([k, l]) => `<button class="${view === k ? 'is-on' : ''}" data-view="${k}">${esc(l)}</button>`).join('')}
      </div>
      <button class="btn btn--primary" data-new-tx>${icon('plus')}<span class="hide-sm">Add</span></button>`, 'wallet');

    /* The month is shared by all three, so it sits above them rather than
       inside one. */
    const monthBar = `<div class="monthbar mb-5">
      <button class="icon-btn icon-btn--sm" data-m-nav="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
      <div class="monthbar__label">
        <strong>${esc(monthName(mDate.getMonth()))} ${mDate.getFullYear()}</strong>
        ${isThisMonth ? '<span>this month</span>' : `<button class="linkbtn" data-m-nav="0">back to this month</button>`}
      </div>
      <button class="icon-btn icon-btn--sm" data-m-nav="1" aria-label="Next month"
        ${isThisMonth ? 'disabled' : ''}>${icon('chevronRight')}</button>
    </div>`;

    /* Only the Overview needs first-run copy. Budgets and History have their
       own empty states, and a budget is something you might well want to set
       before recording anything at all. */
    if (!S().transactions.length && view === 'overview') {
      return head + `<div class="card">${emptyState('wallet', 'No transactions yet',
        'Track what comes in and what goes out. A month of honest data changes how you spend.',
        '<button class="btn btn--primary mt-3" data-new-tx>Record the first one</button>')}</div>`;
    }

    const expDelta = prevExp ? Math.round(((exp - prevExp) / prevExp) * 100) : null;

    /* A savings rate is a ratio, and a ratio with almost nothing on the bottom
       is noise — one €50 gift against a month of spending read as "−411%".
       Money per day is defined whatever the income was. */
    const savingsRate = inc > 0 && net >= 0 ? Math.round((net / inc) * 100) : null;

    /* Two numbers the hero does not already carry. Spent lives in the pace
       card above; repeating it here only pushed everything else down. */
    const stats = `<div class="grid grid--2 mb-6">
      ${statTile({ label: 'Income', value: money(inc),
        sub: plural(tx.filter(t => t.type === 'income').length, 'entry', 'entries'), icon: 'trendUp', tone: 'ok' })}
      ${statTile({ label: net >= 0 ? 'Kept' : 'Short by', value: money(Math.abs(net)),
        sub: savingsRate != null ? `${savingsRate}% of income` : `${money(perDay)} a day`,
        icon: 'wallet', tone: net >= 0 ? 'ok' : 'bad' })}
    </div>`;

    /* ─── Pace ─── */
    const budgetTotal = sum(S().budgets.map(b => b.limit));
    const spentPct = budgetTotal ? pct(exp, budgetTotal) : elapsed;
    /* Ahead of the calendar is the thing worth noticing: 84% of the budget gone
       with 70% of the month left to pay for. Status colour never carries this
       alone — the sentence under the bar says which case it is. */
    const paceTone = !budgetTotal ? '' : spentPct >= 100 ? 'bad' : spentPct > elapsed + 5 ? 'warn' : 'ok';
    const paceNote = !budgetTotal
      ? `${money(perDay)} a day so far · set a budget to see whether that is fast or slow`
      : spentPct >= 100
        ? `${money(exp - budgetTotal)} over your ${money(budgetTotal)} of budgets, with ${plural(daysInMonth - dayNow, 'day')} still to go`
        : spentPct > elapsed + 5
          ? `Spending faster than the month is passing — ${spentPct}% of budget, ${elapsed}% of September`
          : `${money(budgetTotal - exp)} of ${money(budgetTotal)} left, and ${plural(daysInMonth - dayNow, 'day')} to go`;
    const paceHtml = !isThisMonth ? '' : `<div class="card card--pad mb-6 pace">
      <div class="row row--between row--wrap gap-3">
        <div>
          <div class="pace__label">Spent so far</div>
          <div class="pace__big">${money(exp)}</div>
        </div>
        <div class="tr">
          <div class="pace__label">Day ${dayNow} of ${daysInMonth}</div>
          <div class="pace__proj">${money(projected)}<span class="dim"> by the ${daysInMonth}th</span></div>
        </div>
      </div>
      <div class="pace__track pace__track--${paceTone || 'plain'} mt-4">
        <i class="pace__spent" style="width:${Math.min(spentPct, 100)}%"></i>
        ${budgetTotal ? `<i class="pace__mark" style="left:${elapsed}%" title="${elapsed}% of the month gone"></i>` : ''}
      </div>
      <p class="dim mt-2" style="font-size:12px">${paceNote}</p>
    </div>`;

    /* category breakdown */
    const byCat = [...groupBy(tx.filter(t => t.type === 'expense'), 'category')]
      .map(([label, items], i) => ({ label: label || 'Other', value: round(sum(items.map(x => x.amount)), 2), color: seriesColor(i) }))
      .sort((a, b) => b.value - a.value);

    /* 6-month trend */
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = parseISO(mk + '-01'); d.setMonth(d.getMonth() - i);
      const k = monthKey(d);
      months.push({ label: monthName(d.getMonth(), true), income: monthIncome(k), expense: monthExpense(k) });
    }

    const charts = `<div class="grid grid--2 mb-6">
      <div class="card">
        <div class="card__head">${icon('pie')}<h3>Where it went</h3></div>
        <div class="card__body">
          ${byCat.length ? `<div class="donut-row">
            ${donut(byCat.slice(0, 8), { centerTop: money(exp), centerSub: 'spent' })}
            <div class="grow">${legend(byCat.slice(0, 7), { format: money })}</div>
          </div>` : '<div class="chart-empty">No expenses this month</div>'}
        </div>
      </div>
      <div class="card">
        <div class="card__head">${icon('chart')}<h3>Last 6 months</h3></div>
        <div class="card__body">
          ${groupedBars(months, [
            { key: 'income', label: 'Income', color: '#3ecf8e' },
            { key: 'expense', label: 'Spent', color: '#ff6b6b' },
          ], { format: money })}
        </div>
      </div>
    </div>`;

    /* budgets */
    const budgets = S().budgets;
    const budgetHtml = `<div class="card mb-6">
      <div class="card__head">${icon('target')}<h3>Budgets</h3>
        <button class="btn btn--sm" data-add-budget>${icon('plus')}Set a budget</button></div>
      <div class="card__body">
        ${budgets.length ? `<div class="budgets">${budgets.map(b => {
          const spent = sum(tx.filter(t => t.type === 'expense' && t.category === b.category).map(t => t.amount));
          // pct() clamps at 100, which is right for a bar and wrong for the
          // label: €74.70 against a €60 budget is 125%, and saying 100% hides
          // exactly the part worth knowing.
          const p = b.limit ? Math.round((spent / b.limit) * 100) : 0;
          const tone = p >= 100 ? 'bad' : p >= 80 ? 'warn' : 'ok';
          return `<button class="budget" data-budget="${esc(b.category)}">
            <div class="row row--between">
              <strong>${esc(b.category)}</strong>
              <span class="chip chip--${tone}">${p}%</span>
            </div>
            <div class="bar bar--${tone} mt-2"><i style="width:${Math.min(p, 100)}%"></i></div>
            <small class="dim">${money(spent)} of ${money(b.limit)}
              ${p >= 100 ? `· ${money(spent - b.limit)} over` : `· ${money(b.limit - spent)} left`}</small>
          </button>`;
        }).join('')}</div>` : `<p class="dim" style="font-size:13px">No budgets set. A budget turns a number into a decision.</p>`}
      </div>
    </div>`;

    /* The categories this person actually uses, most-used first — logging a
       lunch should be one tap and a number, not a trip through a form. */
    const recentCats = [...groupBy(S().transactions.filter(t => t.type === 'expense'), 'category')]
      .map(([label, items]) => ({ label: label || 'Other', n: items.length }))
      .sort((a, b) => b.n - a.n).slice(0, 5);
    const quickHtml = `<div class="quickadd mb-6">
      <span class="quickadd__label">${icon('zap', 'ic ic--sm')}Log in one tap</span>
      <div class="quickcats">
        ${recentCats.map(c => `<button class="quickcat" data-quick="${esc(c.label)}">
          ${esc(c.label)}</button>`).join('')}
        <button class="quickcat quickcat--more" data-new-tx>${icon('plus', 'ic ic--sm')}Other</button>
      </div>
    </div>`;

    /* Transactions read as a diary, so group them by day with a day's total. */
    const byDay = [...groupBy(tx, 'date')].sort((a, b) => b[0].localeCompare(a[0]));

    const listHtml = `<div class="card">
      <div class="card__head">${icon('list')}<h3>Transactions</h3><span class="nav__badge">${tx.length}</span></div>
      <div class="list">
        ${tx.length ? byDay.map(([date, items]) => {
          const out = sum(items.filter(t => t.type === 'expense').map(t => t.amount));
          return `<div class="daygroup">
            <div class="daygroup__head">
              <span>${esc(fmtDate(date))}</span>
              <strong class="mono">${out ? '−' + money(out).replace('−', '') : money(0)}</strong>
            </div>
            ${items.map(t => `<div class="list__row">
              <span class="tx__icon ${t.type === 'income' ? 'is-in' : 'is-out'}">${icon(t.type === 'income' ? 'trendUp' : 'trendDown', 'ic ic--sm')}</span>
              <div class="list__main">
                <div class="list__title">${esc(t.description)}</div>
                <div class="list__sub">${esc(t.category || 'Other')}${t.notes ? ` · ${esc(t.notes)}` : ''}</div>
              </div>
              <strong class="tx__amt mono ${t.type === 'income' ? 'is-in' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount).replace('−', '')}</strong>
              <div class="list__actions">
                <button class="icon-btn icon-btn--sm" data-tx-edit="${t.id}" aria-label="Edit ${esc(t.description)}">${icon('edit')}</button>
                <button class="icon-btn icon-btn--sm icon-btn--danger" data-tx-del="${t.id}" aria-label="Delete ${esc(t.description)}">${icon('trash')}</button>
              </div>
            </div>`).join('')}
          </div>`;
        }).join('') : emptyState('inbox', 'Nothing this month', 'Move to another month or add a transaction.')}
      </div>
    </div>`;

    if (view === 'budgets') return head + monthBar + budgetHtml;
    if (view === 'history')  return head + monthBar + quickHtml + listHtml;
    return head + monthBar + paceHtml + quickHtml + stats + charts;
  },

  onMount(root) {
    on(root, 'click', '[data-view]', (e, el) => navigate('finance', { ...params(), view: el.dataset.view }));
    on(root, 'click', '[data-new-tx]', () => newTransaction({ date: today() }));
    on(root, 'click', '[data-quick]', (e, el) =>
      newTransaction({ date: today(), type: 'expense', category: el.dataset.quick }));
    on(root, 'click', '[data-tx-edit]', (e, el) => editTx(el.dataset.txEdit));
    on(root, 'click', '[data-tx-del]', async (e, el) => {
      const t = store.find('transactions', el.dataset.txDel);
      if (await confirmDialog({ title: 'Delete transaction?', message: `“${t.description}” (${money(t.amount)})`, confirmLabel: 'Delete', danger: true })) {
        store.remove('transactions', t.id); toast('Deleted', 'ok'); render();
      }
    });
    on(root, 'click', '[data-budget]', (e, el) => editBudget(el.dataset.budget));
    on(root, 'click', '[data-add-budget]', async () => {
      const v = await openForm({ title: 'New budget', submitLabel: 'Next',
        fields: [{ name: 'category', label: 'Category', type: 'select', options: CATEGORIES.expense, value: 'Food' }] });
      if (v) editBudget(v.category);
    });
    on(root, 'click', '[data-m-nav]', (e, el) => {
      const d = Number(el.dataset.mNav);
      const keep = params().view ? { view: params().view } : {};
      if (!d) return navigate('finance', keep);
      const cur = parseISO((params().m || monthKey()) + '-01');
      cur.setMonth(cur.getMonth() + d);
      navigate('finance', { ...keep, m: monthKey(cur) });
    });
  },
});
