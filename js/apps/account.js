/* ═══════════════════════════════════════════════════════════════
   GabikOS — account: register, sign in, session
   ═══════════════════════════════════════════════════════════════ */
import { store, S } from '../core/store.js';
import { render } from '../core/router.js';
import { icon } from '../core/icons.js';
import { modal, toast, qs, confirmDialog, on } from '../core/ui.js';
import { esc } from '../core/util.js';
import { signIn, signUp, signOut, resetPassword, onAuthChange, authMessage, canUseSupabase, resetSupabase }
  from '../core/supabase.js';
import { supabaseConfig, setSupabaseConfig, DEFAULT_SUPABASE } from '../config.js';
import { sync, initSync, forgetAccount, syncNow } from '../core/sync.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** The sign-in / create-account panel. */
export function openAuth(mode = 'in') {
  if (!canUseSupabase()) { openProjectSetup(); return; }

  const draw = m => `
    <div class="auth">
      <div class="auth__mark">G</div>
      <h2>${m === 'up' ? 'Create your account' : m === 'reset' ? 'Reset your password' : 'Welcome back'}</h2>
      <p class="dim">${m === 'up'
        ? 'One account, and GabikOS follows you between every device you use.'
        : m === 'reset'
          ? 'We will email you a link to set a new password.'
          : 'Sign in and your data comes with you.'}</p>

      <form class="auth__form" novalidate>
        <div class="field">
          <label class="field__label" for="authEmail">Email</label>
          <input class="input input--lg" id="authEmail" type="email" inputmode="email"
            autocomplete="email" placeholder="you@example.com" />
        </div>
        ${m === 'reset' ? '' : `
        <div class="field">
          <label class="field__label" for="authPass">Password</label>
          <input class="input input--lg" id="authPass" type="password"
            autocomplete="${m === 'up' ? 'new-password' : 'current-password'}"
            placeholder="${m === 'up' ? 'At least 6 characters' : 'Your password'}" />
        </div>`}
        <p class="auth__err" id="authErr" hidden></p>
        <button class="btn btn--primary btn--lg btn--block" id="authGo" type="submit">
          ${m === 'up' ? 'Create account' : m === 'reset' ? 'Send reset link' : 'Sign in'}
        </button>
      </form>

      <div class="auth__alt">
        ${m === 'up'
          ? `Already have an account? <button class="linkbtn" data-mode="in">Sign in</button>`
          : m === 'reset'
            ? `<button class="linkbtn" data-mode="in">Back to sign in</button>`
            : `New here? <button class="linkbtn" data-mode="up">Create an account</button>
               <span class="dim"> · </span><button class="linkbtn" data-mode="reset">Forgot password</button>`}
      </div>
      <p class="auth__note">Your data is stored under your account and readable only by you.
        Signing in is optional — GabikOS works offline on this device either way.</p>
    </div>`;

  const wire = (body, m) => {
    const form = body.querySelector('form');
    const errEl = body.querySelector('#authErr');
    const btn = body.querySelector('#authGo');
    const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };

    body.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      body.innerHTML = draw(b.dataset.mode);
      wire(body, b.dataset.mode);
    });

    form.onsubmit = async e => {
      e.preventDefault();
      errEl.hidden = true;
      const email = body.querySelector('#authEmail').value.trim();
      const pass = body.querySelector('#authPass')?.value || '';

      if (!EMAIL.test(email)) return fail('Enter a valid email address.');
      if (m !== 'reset' && pass.length < 6) return fail('Passwords need at least 6 characters.');

      btn.disabled = true;
      const was = btn.textContent;
      btn.textContent = m === 'up' ? 'Creating…' : m === 'reset' ? 'Sending…' : 'Signing in…';
      try {
        if (m === 'reset') {
          const { error } = await resetPassword(email);
          if (error) throw error;
          modal.close();
          toast('Check your email for the reset link', 'ok', { duration: 6000 });
          return;
        }
        const { data, error } = m === 'up' ? await signUp(email, pass) : await signIn(email, pass);
        if (error) throw error;

        if (m === 'up' && !data.session) {
          modal.close();
          toast('Account created — confirm the email we sent, then sign in', 'ok', { duration: 8000 });
          return;
        }
        modal.close();
        toast(m === 'up' ? 'Account created — syncing now' : 'Signed in', 'ok');
        await initSync();
        render();
        document.dispatchEvent(new CustomEvent('gabikos:chrome'));
      } catch (err) {
        fail(authMessage(err));
        btn.disabled = false;
        btn.textContent = was;
      }
    };
    requestAnimationFrame(() => body.querySelector('#authEmail')?.focus());
  };

  modal.open({
    title: '', size: 'slim', body: draw(mode),
    onMount: body => wire(body, mode),
  });
}

/** Point the app at a different Supabase project. */
export function openProjectSetup() {
  const cfg = supabaseConfig();
  modal.open({
    title: 'Connect a Supabase project', size: '',
    body: `<div class="md" style="font-size:13.4px">
        <p>GabikOS stores your data in a Supabase project. It ships pointing at one already; give it
          different values here to use your own. Both are safe to paste — the publishable key only names
          the project, and row-level security is what keeps the data private.</p>
      </div>
      <div class="form-fields mt-4">
        <div class="field">
          <label class="field__label" for="sbUrl">Project URL</label>
          <input class="input" id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(cfg.url)}" />
        </div>
        <div class="field">
          <label class="field__label" for="sbKey">Publishable (anon) key</label>
          <input class="input" id="sbKey" placeholder="sb_publishable_… or eyJ…" value="${esc(cfg.key)}" />
        </div>
      </div>`,
    footer: `<button class="btn btn--ghost btn--sm" data-act="default">Use the built-in project</button>
      <div class="grow"></div>
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn--primary" data-act="save">Save</button>`,
    onMount: (body, foot) => {
      foot.querySelector('[data-act=cancel]').onclick = () => modal.close();
      foot.querySelector('[data-act=default]').onclick = () => {
        setSupabaseConfig(null, null); resetSupabase(); modal.close();
        toast('Using the built-in project', 'ok'); initSync().then(render);
      };
      foot.querySelector('[data-act=save]').onclick = () => {
        const url = body.querySelector('#sbUrl').value.trim();
        const key = body.querySelector('#sbKey').value.trim();
        if (!/^https?:\/\/.+/.test(url)) { toast('That URL does not look right', 'warn'); return; }
        if (key.length < 20) { toast('That key looks too short', 'warn'); return; }
        setSupabaseConfig(url, key); resetSupabase(); modal.close();
        toast('Project saved', 'ok');
        initSync().then(() => { render(); document.dispatchEvent(new CustomEvent('gabikos:chrome')); });
      };
    },
  });
}

export async function doSignOut() {
  const ok = await confirmDialog({
    title: 'Sign out?',
    message: 'Your data stays in your account and comes back when you sign in again. '
           + 'The copy on this device is left as it is.',
    confirmLabel: 'Sign out',
  });
  if (!ok) return;
  try { await signOut(); } catch { /* the local session is cleared regardless */ }
  forgetAccount();
  toast('Signed out', 'info');
  render();
  document.dispatchEvent(new CustomEvent('gabikos:chrome'));
}

/** Keep sync in step with the session — a token expiring, another tab signing out. */
export function watchAuth() {
  if (!canUseSupabase()) return;
  onAuthChange((session, event) => {
    if (event === 'SIGNED_IN' && !sync.enabled) initSync().then(() => {
      render(); document.dispatchEvent(new CustomEvent('gabikos:chrome'));
    });
    if (event === 'SIGNED_OUT' && sync.enabled) {
      forgetAccount(); render(); document.dispatchEvent(new CustomEvent('gabikos:chrome'));
    }
  }).catch(() => { /* not configured; local mode */ });
}

/** The account block shown in Settings → Data. */
export function accountCard() {
  const signedIn = sync.enabled && sync.backend === 'supabase' && sync.user;
  const onClaude = sync.backend === 'claude';

  if (onClaude) return `<div class="card card--pad mb-4 callout">
      <div class="row gap-3 row--wrap">
        <span class="stat__icon">${icon('cloud')}</span>
        <div class="grow" style="min-width:200px">
          <h3>Synced through your Claude account</h3>
          <p class="dim mt-2" style="font-size:13px">This copy stores your data in private per-account
            storage, so no separate sign-in is needed here.</p>
        </div>
      </div>
    </div>`;

  if (signedIn) return `<div class="card card--pad mb-4 callout">
      <div class="row gap-3 row--wrap">
        <span class="avatar" style="width:42px;height:42px;font-size:16px">${esc((sync.user.email || 'G')[0].toUpperCase())}</span>
        <div class="grow" style="min-width:200px">
          <h3>Signed in</h3>
          <p class="dim mt-1" style="font-size:13px">${esc(sync.user.email || 'your account')} — your data
            follows you to every device you sign in on.</p>
          <div class="row gap-2 mt-3 row--wrap">
            <button class="btn btn--sm" data-sync-now>${icon('refresh')}Sync now</button>
            <button class="btn btn--sm btn--ghost" data-project>${icon('database')}Project</button>
            <button class="btn btn--sm btn--ghost" data-signout>${icon('arrowRight')}Sign out</button>
          </div>
        </div>
      </div>
    </div>`;

  return `<div class="card card--pad mb-4 callout">
      <div class="row gap-3 row--wrap">
        <span class="stat__icon">${icon('user')}</span>
        <div class="grow" style="min-width:200px">
          <h3>Sign in to sync across devices</h3>
          <p class="dim mt-2" style="font-size:13px">Without an account your data lives in this browser
            only, and another device starts empty. Creating one takes a few seconds and is free.</p>
          <div class="row gap-2 mt-3 row--wrap">
            <button class="btn btn--primary btn--sm" data-signin>${icon('user')}Sign in or register</button>
            <button class="btn btn--sm btn--ghost" data-project>${icon('database')}Use my own project</button>
          </div>
        </div>
      </div>
    </div>`;
}

/** Wire the account card wherever it is rendered. */
export function wireAccount(root) {
  on(root, 'click', '[data-signin]', () => openAuth('in'));
  on(root, 'click', '[data-signout]', doSignOut);
  on(root, 'click', '[data-project]', openProjectSetup);
  on(root, 'click', '[data-sync-now]', () => {
    syncNow() ? toast('Syncing…', 'info') : toast('Sync is not available here', 'warn');
  });
}
