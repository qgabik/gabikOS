/* ═══════════════════════════════════════════════════════════════
   GabikOS — UI kit: DOM helpers, modal, form engine, toast, menu
   ═══════════════════════════════════════════════════════════════ */
import { icon, PICKABLE } from './icons.js';
import { esc, uid } from './util.js';
import { currentView, getView } from './router.js';
import { hueFor } from './theme.js';
import { settings } from './store.js';

/* ─── DOM ─── */
export const qs  = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build an element from an HTML string. */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content.firstElementChild;
}
/** Build a document fragment from an HTML string. */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = String(html).trim();
  return t.content;
}
/** Event delegation: on(root, 'click', '[data-x]', handler) */
export function on(root, type, sel, fn) {
  root.addEventListener(type, e => {
    const target = e.target.closest(sel);
    if (target && root.contains(target)) fn(e, target);
  });
}

/* ─── Toasts ─── */
const toastHost = () => qs('#toasts');
export function toast(message, type = 'ok', { action, onAction, duration = 3200 } = {}) {
  const icons = { ok: 'check', bad: 'alert', info: 'info', warn: 'alert' };
  const node = h(`
    <div class="toast toast--${type}" role="status">
      <span class="toast__ic">${icon(icons[type] || 'info')}</span>
      <span>${esc(message)}</span>
      ${action ? `<button type="button">${esc(action)}</button>` : ''}
    </div>`);
  const kill = () => {
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 240);
  };
  let timer = setTimeout(kill, duration);
  node.querySelector('button')?.addEventListener('click', () => {
    clearTimeout(timer); onAction?.(); kill();
  });
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => { timer = setTimeout(kill, 1400); });
  toastHost().appendChild(node);
  return kill;
}

/* ─── Modal ─── */
let modalStack = [];
export const modal = {
  open({ title = '', body = '', footer = '', size = '', onMount, onClose, closable = true } = {}) {
    const root = qs('#modal');
    const box  = qs('#modalBox');
    qs('#modalTitle').textContent = title;
    qs('#modalClose').innerHTML = icon('x');
    qs('#modalClose').hidden = !closable;
    const bodyEl = qs('#modalBody');
    const footEl = qs('#modalFoot');
    bodyEl.innerHTML = '';
    footEl.innerHTML = '';
    bodyEl.append(typeof body === 'string' ? frag(body) : body);
    if (footer) footEl.append(typeof footer === 'string' ? frag(footer) : footer);

    box.className = 'modal__box' + (size ? ` modal__box--${size}` : '');
    root.hidden = false;
    modalStack.push({ onClose, closable });

    // focus the first sensible control
    requestAnimationFrame(() => {
      const first = bodyEl.querySelector('input:not([type=hidden]),textarea,select,button');
      first?.focus?.();
      if (first?.select && first.tagName === 'INPUT' && first.type === 'text') first.select();
    });
    onMount?.(bodyEl, footEl);
    return { body: bodyEl, foot: footEl, close: modal.close };
  },
  close() {
    const root = qs('#modal');
    if (root.hidden) return;
    const top = modalStack.pop();
    root.hidden = true;
    qs('#modalBody').innerHTML = '';
    qs('#modalFoot').innerHTML = '';
    top?.onClose?.();
  },
  get isOpen() { return !qs('#modal').hidden; },
  get closable() { return modalStack.at(-1)?.closable !== false; },
};

/* ─── Confirm ─── */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const done = v => { if (settled) return; settled = true; resolve(v); modal.close(); };
    modal.open({
      title,
      size: 'slim',
      body: `<p class="muted" style="font-size:13.6px;line-height:1.65">${esc(message)}</p>`,
      footer: `
        <button class="btn" data-act="cancel">${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-act="ok">${esc(confirmLabel)}</button>`,
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
      onMount: (_b, foot) => {
        foot.querySelector('[data-act=cancel]').onclick = () => done(false);
        const ok = foot.querySelector('[data-act=ok]');
        ok.onclick = () => done(true);
        requestAnimationFrame(() => ok.focus());
      },
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   Form engine — declarative fields → modal form → values object
   field: { name, label, type, value, options, placeholder, hint,
            required, min, max, step, rows, half, when }
   types: text textarea number date time datetime select multiselect
          tags checkbox color icon range rating hidden markdown
   ═══════════════════════════════════════════════════════════════ */

function renderField(f, val) {
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
  const req = f.required ? ' required' : '';
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  let control = '';

  switch (f.type) {
    case 'hidden':
      return `<input type="hidden" name="${f.name}" value="${esc(val ?? '')}" />`;

    case 'textarea':
    case 'markdown':
      control = `<textarea class="textarea${f.type === 'markdown' ? ' mono' : ''}" id="${id}" name="${f.name}"
        rows="${f.rows || 5}"${ph}${req}>${esc(val ?? '')}</textarea>`;
      break;

    case 'number':
      control = `<input class="input" type="number" id="${id}" name="${f.name}" value="${val ?? ''}"
        ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}
        step="${f.step ?? 'any'}"${ph}${req} />`;
      break;

    case 'date':
    case 'time':
    case 'datetime':
      control = `<input class="input" type="${f.type === 'datetime' ? 'datetime-local' : f.type}"
        id="${id}" name="${f.name}" value="${esc(val ?? '')}"${req} />`;
      break;

    case 'select':
      control = `<select class="select" id="${id}" name="${f.name}"${req}>
        ${(f.options || []).map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return `<option value="${esc(v)}"${String(v) === String(val ?? '') ? ' selected' : ''}>${esc(l)}</option>`;
        }).join('')}
      </select>`;
      break;

    case 'multiselect': {
      const cur = Array.isArray(val) ? val.map(String) : [];
      control = `<div class="pickers" data-multiselect="${f.name}">
        ${(f.options || []).map(o => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return `<button type="button" class="chip ${cur.includes(String(v)) ? 'chip--accent' : ''}"
            data-val="${esc(v)}" aria-pressed="${cur.includes(String(v))}">${esc(l)}</button>`;
        }).join('')}
      </div><input type="hidden" name="${f.name}" value="${esc(cur.join(','))}" />`;
      break;
    }

    case 'tags':
      control = `<input class="input" id="${id}" name="${f.name}" value="${esc(Array.isArray(val) ? val.join(', ') : (val ?? ''))}"
        placeholder="${esc(f.placeholder || 'comma, separated, tags')}" data-tags />`;
      break;

    case 'checkbox':
      return `<label class="check" style="margin-top:4px">
        <input type="checkbox" name="${f.name}"${val ? ' checked' : ''} />
        <span class="check__box"><svg viewBox="0 0 24 24"><path d="m20 6-11 11-5-5"/></svg></span>
        <span>${esc(f.label)}</span>
      </label>${f.hint ? `<div class="field__hint" style="margin-left:29px">${esc(f.hint)}</div>` : ''}`;

    case 'color': {
      const swatches = ['#7c5cff','#4cc4f0','#3ecf8e','#f5b544','#ff6b6b','#ec6ead','#a78bfa','#26c6da','#9ccc65','#ff8a65'];
      control = `<div class="color-pick" data-color="${f.name}">
        ${swatches.map(c => `<button type="button" class="swatch${String(val).toLowerCase() === c ? ' is-on' : ''}"
          style="--c:${c}" data-c="${c}" title="${c}"></button>`).join('')}
        <input type="color" class="input swatch-custom" value="${esc(val || swatches[0])}" />
        <input type="hidden" name="${f.name}" value="${esc(val || swatches[0])}" />
      </div>`;
      break;
    }

    case 'icon':
      control = `<div class="icon-pick" data-iconpick="${f.name}">
        ${PICKABLE.filter((v, i, a) => a.indexOf(v) === i).map(n =>
          `<button type="button" class="icon-opt${val === n ? ' is-on' : ''}" data-i="${n}" title="${n}">${icon(n)}</button>`).join('')}
        <input type="hidden" name="${f.name}" value="${esc(val || 'star')}" />
      </div>`;
      break;

    case 'range':
      control = `<div class="range-row">
        <input type="range" id="${id}" name="${f.name}" value="${val ?? f.min ?? 0}"
          min="${f.min ?? 0}" max="${f.max ?? 10}" step="${f.step ?? 1}" class="range" />
        <output class="range-out mono">${val ?? f.min ?? 0}</output>
      </div>`;
      break;

    case 'rating': {
      const n = Number(val) || 0;
      control = `<div class="rating-pick" data-rating="${f.name}">
        ${[1,2,3,4,5].map(i => `<button type="button" class="star-btn${i <= n ? ' is-on' : ''}" data-v="${i}"
          aria-label="${i} of 5">${icon('star')}</button>`).join('')}
        <button type="button" class="btn btn--ghost btn--sm" data-v="0">clear</button>
        <input type="hidden" name="${f.name}" value="${n}" />
      </div>`;
      break;
    }

    default: /* text, url, email */
      control = `<input class="input" type="${f.type === 'url' ? 'url' : f.type === 'email' ? 'email' : 'text'}"
        id="${id}" name="${f.name}" value="${esc(val ?? '')}"${ph}${req} autocomplete="off" />`;
  }

  return `<div class="field${f.half ? ' field--half' : ''}" data-field="${f.name}">
    <label class="field__label" for="${id}">${esc(f.label)}${f.required ? ' <span style="color:var(--bad)">*</span>' : ''}</label>
    ${control}
    ${f.hint ? `<div class="field__hint">${esc(f.hint)}</div>` : ''}
  </div>`;
}

/** Wire up the interactive (non-native) field widgets inside a root element. */
export function wireFields(root) {
  // multiselect chips
  qsa('[data-multiselect]', root).forEach(box => {
    const hidden = box.nextElementSibling;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-val]');
      if (!b) return;
      const on = b.classList.toggle('chip--accent');
      b.setAttribute('aria-pressed', on);
      const vals = [...box.querySelectorAll('.chip--accent')].map(x => x.dataset.val);
      hidden.value = vals.join(',');
    });
  });
  // colour picker
  qsa('[data-color]', root).forEach(box => {
    const hidden = box.querySelector('input[type=hidden]');
    const custom = box.querySelector('input[type=color]');
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      box.querySelectorAll('.swatch').forEach(s => s.classList.remove('is-on'));
      b.classList.add('is-on');
      hidden.value = b.dataset.c;
      custom.value = b.dataset.c;
    });
    custom.addEventListener('input', () => {
      hidden.value = custom.value;
      box.querySelectorAll('.swatch').forEach(s => s.classList.remove('is-on'));
    });
  });
  // icon picker
  qsa('[data-iconpick]', root).forEach(box => {
    const hidden = box.querySelector('input[type=hidden]');
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      box.querySelectorAll('.icon-opt').forEach(s => s.classList.remove('is-on'));
      b.classList.add('is-on');
      hidden.value = b.dataset.i;
    });
  });
  // range output
  qsa('.range', root).forEach(r => {
    const out = r.parentElement.querySelector('.range-out');
    r.addEventListener('input', () => { if (out) out.textContent = r.value; });
  });
  // rating
  qsa('[data-rating]', root).forEach(box => {
    const hidden = box.querySelector('input[type=hidden]');
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const v = Number(b.dataset.v);
      hidden.value = v;
      box.querySelectorAll('.star-btn').forEach((s, i) => s.classList.toggle('is-on', i < v));
    });
  });
}

/** Read a form element's values, coercing by the field spec. */
export function readForm(formEl, fields) {
  const fd = new FormData(formEl);
  const out = {};
  for (const f of fields) {
    if (f.type === 'checkbox') { out[f.name] = formEl.querySelector(`[name="${f.name}"]`)?.checked || false; continue; }
    let v = fd.get(f.name);
    if (f.type === 'number' || f.type === 'range' || f.type === 'rating') {
      v = v === '' || v == null ? null : Number(v);
    } else if (f.type === 'tags') {
      v = String(v || '').split(',').map(s => s.trim()).filter(Boolean);
    } else if (f.type === 'multiselect') {
      v = String(v || '').split(',').map(s => s.trim()).filter(Boolean);
      if (f.numeric) v = v.map(Number);
    } else if (typeof v === 'string') {
      v = v.trim();
    }
    out[f.name] = v;
  }
  return out;
}

/**
 * Open a modal form.
 * @returns Promise<values|null>  null when cancelled.
 */
export function openForm({ title, fields = [], values = {}, submitLabel = 'Save', size = '', extraFooter = '', validate, onMount } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (settled) return; settled = true; resolve(v); modal.close(); };

    const html = `<form class="form" id="frm_${uid('x')}" novalidate>
      <div class="form-fields">
        ${fields.map(f => renderField(f, values[f.name] ?? f.value ?? (f.type === 'checkbox' ? false : ''))).join('')}
      </div>
    </form>`;

    modal.open({
      title, size,
      body: html,
      footer: `${extraFooter}<div class="grow"></div>
        <button class="btn" data-act="cancel" type="button">Cancel</button>
        <button class="btn btn--primary" data-act="save" type="button">${esc(submitLabel)}</button>`,
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
      onMount: (body, foot) => {
        const form = body.querySelector('form');
        wireFields(body);
        onMount?.(body, foot, form);

        const submit = () => {
          const vals = readForm(form, fields);
          // required check
          for (const f of fields) {
            if (f.required && (vals[f.name] === '' || vals[f.name] == null || (Array.isArray(vals[f.name]) && !vals[f.name].length))) {
              const inp = form.querySelector(`[name="${f.name}"]`);
              inp?.focus();
              body.querySelector(`[data-field="${f.name}"]`)?.classList.add('is-invalid');
              setTimeout(() => body.querySelector(`[data-field="${f.name}"]`)?.classList.remove('is-invalid'), 1400);
              toast(`${f.label} is required`, 'warn');
              return;
            }
          }
          if (validate) {
            const err = validate(vals, body);
            if (err) { toast(err, 'warn'); return; }
          }
          finish(vals);
        };

        foot.querySelector('[data-act=save]').onclick = submit;
        foot.querySelector('[data-act=cancel]').onclick = () => finish(null);
        form.addEventListener('submit', e => { e.preventDefault(); submit(); });
        // Ctrl/Cmd+Enter submits from anywhere, Enter submits from single-line inputs
        form.addEventListener('keydown', e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'range') { e.preventDefault(); submit(); }
        });
      },
    });
  });
}

/* ─── Context menu ─── */
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
export function contextMenu(ev, items = []) {
  ev.preventDefault?.();
  ev.stopPropagation?.();
  closeMenu();
  const node = h(`<div class="menu" role="menu">${items.map((it, i) =>
    it === '-' ? '<hr/>' :
    `<button role="menuitem" data-i="${i}" class="${it.danger ? 'is-danger' : ''}">
       ${icon(it.icon || 'chevronRight')}<span>${esc(it.label)}</span></button>`).join('')}</div>`);
  document.body.appendChild(node);

  const pad = 8;
  const r = node.getBoundingClientRect();
  const x = Math.min(ev.clientX, window.innerWidth - r.width - pad);
  const y = Math.min(ev.clientY, window.innerHeight - r.height - pad);
  node.style.left = Math.max(pad, x) + 'px';
  node.style.top = Math.max(pad, y) + 'px';

  node.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    const item = items[Number(b.dataset.i)];
    closeMenu();
    item?.action?.();
  });
  openMenu = node;
  setTimeout(() => {
    document.addEventListener('click', closeMenu, { once: true });
    document.addEventListener('scroll', closeMenu, { once: true, capture: true });
  }, 0);
}

/* ─── Small shared renderers ─── */
export const emptyState = (iconName, title, text, actionHtml = '') => `
  <div class="empty">
    <div class="empty__icon">${icon(iconName, 'ic')}</div>
    <h3>${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${actionHtml}
  </div>`;

/** The hue for the screen being drawn: an explicit one, else the view's
 *  own (a custom tracker's colour), else the module palette. */
function currentHue(explicit) {
  if (explicit) return explicit;
  if (!settings().colorfulNav) return 'var(--accent)';
  const id = currentView();
  return getView(id)?.hue || hueFor(id);
}

export const pageHead = (title, subtitle, actions = '', iconName = '', hue = '') => `
  <div class="page-head" style="--hue:${esc(currentHue(hue))}">
    <div class="page-head__txt">
      <h1>${iconName ? `<span class="page-head__icon">${icon(iconName, 'ic ic--lg')}</span>` : ''}${esc(title)}</h1>
      ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
    </div>
    ${actions ? `<div class="page-head__actions">${actions}</div>` : ''}
  </div>`;

export const statTile = ({ label, value, sub = '', icon: ic = 'star', tone = '', delta }) => `
  <div class="stat ${tone ? 'stat--' + tone : ''}">
    <div class="stat__top">
      <span class="stat__label">${esc(label)}</span>
      <span class="stat__icon">${icon(ic)}</span>
    </div>
    <div class="stat__value">${value}</div>
    ${sub || delta != null ? `<div class="stat__sub">
      ${delta != null ? `<span class="stat__delta stat__delta--${delta >= 0 ? 'up' : 'down'}">
        ${icon(delta >= 0 ? 'trendUp' : 'trendDown', 'ic ic--sm')}${Math.abs(delta)}%</span>` : ''}
      ${sub ? `<span>${esc(sub)}</span>` : ''}
    </div>` : ''}
  </div>`;
