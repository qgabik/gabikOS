/* ═══════════════════════════════════════════════════════════════
   The check that would have caught the one real crash in this app.

   School → Today threw "nowMins is not defined" for anyone whose
   timetable had a lesson on the day they looked, because a helper was
   moved out from under a caller. Nothing else noticed: the screen
   renders fine when you have no lessons today, which is how every test
   fixture happened to be set up.

   no-undef finds that in a second, and without a build step there is
   nothing else that would.

   usage:  npx eslint js sw.js tools
   (eslint is not a dependency of the app — nothing here ships with it)
   ═══════════════════════════════════════════════════════════════ */
export default [
  /* Somebody else's bundle, shipped as-is. */
  { ignores: ['js/vendor/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', console: 'readonly', fetch: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', matchMedia: 'readonly',
        addEventListener: 'readonly', removeEventListener: 'readonly', dispatchEvent: 'readonly',
        CustomEvent: 'readonly', Event: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        Blob: 'readonly', File: 'readonly', FileReader: 'readonly', FormData: 'readonly',
        Intl: 'readonly', structuredClone: 'readonly', performance: 'readonly', crypto: 'readonly',
        caches: 'readonly', Response: 'readonly', Request: 'readonly', Headers: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly', getComputedStyle: 'readonly',
        innerWidth: 'readonly', innerHeight: 'readonly', scrollTo: 'readonly', history: 'readonly',
        self: 'readonly', importScripts: 'readonly', clients: 'readonly', skipWaiting: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', btoa: 'readonly', atob: 'readonly',
        AbortController: 'readonly', ResizeObserver: 'readonly', IntersectionObserver: 'readonly',
        MutationObserver: 'readonly', Image: 'readonly', DOMParser: 'readonly', queueMicrotask: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-fallthrough': 'error',
      'no-sparse-arrays': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-irregular-whitespace': 'error',
    },
  },
];
