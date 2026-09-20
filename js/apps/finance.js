/* ═══════════════════════════════════════════════════════════════
   GabikOS — Money: income, expenses, budgets, trends
   ═══════════════════════════════════════════════════════════════ */
import { store, S, settings } from '../core/store.js';
import { registerView, navigate, render, params } from '../core/router.js';
import { icon } from '../core/icons.js';
import { openForm, confirmDialog, toast, on, emptyState, pageHead, contextMenu, statTile } from '../core/ui.js';
import { esc, today, iso, monthKey, monthName, parseISO, fmtMoney, sum, by, pct, plural,
         addDaysISO, fmtDate, round, groupBy } from '../core/util.js';
import { donut, legend, groupedBars, SERIES } from '../core/charts.js';

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

    const head = pageHead('Money', `${monthName(mDate.getMonth())} ${mDate.getFullYear()}`, `
      <div class="seg">
        <button data-m-nav="-1" aria-label="Previous month">${icon('chevronLeft')}</button>
        <button data-m-nav="0">This month</button>
        <button data-m-nav="1" aria-label="Next month">${icon('chevronRight')}</button>
      </div>
      <button class="btn btn--primary" data-new-tx>${icon('plus')}<span class="hide-sm">Transaction</span></button>`, 'wallet');

    if (!S().transactions.length) {
      return head + `<div class="card">${emptyState('wallet', 'No transactions yet',
        'Track what comes in and what goes out. A month of honest data changes how you spend.',
        '<button class="btn btn--primary mt-3" data-new-tx>Record the first one</button>')}</div>`;
    }

    const savingsRate = inc ? Math.round((net / inc) * 100) : 0;
    const expDelta = prevExp ? Math.round(((exp - prevExp) / prevExp) * 100) : null;

    const stats = `<div class="grid grid--stat mb-6">
      ${statTile({ label: 'Income', value: money(inc), sub: plural(tx.filter(t => t.type === 'income').length, 'entry', 'entries'), icon: 'trendUp', tone: 'ok' })}
      ${statTile({ label: 'Spent', value: money(exp), sub: expDelta != null ? `vs ${money(prevExp)} last month` : 'this month',
        icon: 'trendDown', tone: 'bad', delta: expDelta })}
      ${statTile({ label: 'Net', value: money(net), sub: net >= 0 ? 'in the black' : 'over budget', icon: 'wallet', tone: net >= 0 ? 'ok' : 'bad' })}
      ${statTile({ label: 'Saved', value: savingsRate + '%', sub: 'of income kept', icon: 'target', tone: savingsRate >= 20 ? 'ok' : savingsRate >= 0 ? 'warn' : 'bad' })}
    </div>`;

    /* category breakdown */
    const byCat = [...groupBy(tx.filter(t => t.type === 'expense'), 'category')]
      .map(([label, items], i) => ({ label: label || 'Other', value: round(sum(items.map(x => x.amount)), 2), color: SERIES[i % SERIES.length] }))
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
          const p = pct(spent, b.limit);
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

    const listHtml = `<div class="card">
      <div class="card__head">${icon('list')}<h3>Transactions</h3><span class="nav__badge">${tx.length}</span></div>
      <div class="list">
        ${tx.length ? tx.map(t => `<div class="list__row">
          <span class="tx__icon ${t.type === 'income' ? 'is-in' : 'is-out'}">${icon(t.type === 'income' ? 'trendUp' : 'trendDown', 'ic ic--sm')}</span>
          <div class="list__main">
            <div class="list__title">${esc(t.description)}</div>
            <div class="list__sub">${esc(t.category || 'Other')} · ${esc(fmtDate(t.date))}${t.notes ? ` · ${esc(t.notes)}` : ''}</div>
          </div>
          <strong class="tx__amt mono ${t.type === 'income' ? 'is-in' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount).replace('−', '')}</strong>
          <div class="list__actions">
            <button class="icon-btn icon-btn--sm" data-tx-edit="${t.id}">${icon('edit')}</button>
            <button class="icon-btn icon-btn--sm icon-btn--danger" data-tx-del="${t.id}">${icon('trash')}</button>
          </div>
        </div>`).join('') : emptyState('inbox', 'Nothing this month', 'Move to another month or add a transaction.')}
      </div>
    </div>`;

    return head + stats + charts + budgetHtml + listHtml;
  },

  onMount(root) {
    on(root, 'click', '[data-new-tx]', () => newTransaction({ date: today() }));
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
      if (!d) return navigate('finance', {});
      const cur = parseISO((params().m || monthKey()) + '-01');
      cur.setMonth(cur.getMonth() + d);
      navigate('finance', { m: monthKey(cur) });
    });
  },
});
