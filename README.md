<div align="center">

# GabikOS

**A personal operating system for your whole life.**

Tasks · Habits · Focus · Calendar · Notes · Journal · Goals · Health · Money — and anything else you decide to track.

*No account. No server. No tracking. Opens in milliseconds.*

</div>

---

## What this is

GabikOS is a single-page web app that runs entirely in your browser. Everything you write stays on your
device in local storage — there is no backend, no sign-up, and nothing is ever sent anywhere.

It has no build step and no dependencies. Open `index.html` and it runs.

## Getting started

Open `index.html` in a browser. That's it.

For the nicest experience (clean URLs, no file:// restrictions), serve the folder:

```bash
npx http-server -p 8080 .     # then open http://localhost:8080
# or
python3 -m http.server 8080
```

### Putting it on the web

The repo ships a Pages workflow (`.github/workflows/deploy-pages.yml`), but **no automation can switch
Pages on for the first time** — `GITHUB_TOKEN` is refused by that API even on a public repo. A repo admin
turns it on once:

> **[github.com/qgabik/gabikOS/settings/pages](https://github.com/qgabik/gabikOS/settings/pages)**
> → under **Build and deployment**, set *Source* to **GitHub Actions**

That is the whole setup. The workflow deploys on every push from then on, and the site is at
`https://qgabik.github.io/gabikOS/`.

*Deploy from a branch → root* works too and skips Actions entirely — the site is already static, so there
is nothing to build. If you pick that, delete the workflow so it stops reporting failures.

Note that Pages on a **private** repo needs a paid GitHub plan; on a free account the repo must be public.
Nothing here holds secrets — it is all client-side code, and your data never leaves your browser.

## The modules

| Module | What it does |
| --- | --- |
| **Dashboard** | Your day in one screen — a completion ring, today's tasks, habits, what's coming up, recent activity |
| **Tasks** | Projects, priorities, due dates, tags. List view and a drag-and-drop board |
| **Habits** | Streaks, 13-week heatmaps, completion rates, per-day targets, rest days |
| **Focus** | Pomodoro timer with a floating HUD that keeps running while you navigate |
| **Calendar** | Month grid and agenda, with task due dates folded in |
| **Notes** | Markdown editor with live preview, folders, tags, pinning, `.md` export |
| **Journal** | Daily entries, mood and energy tracking, gratitude, a consistency heatmap |
| **Goals** | Outcomes with milestones, progress rings and deadlines |
| **Health** | Workouts, weight, sleep, steps, hydration — with trend charts |
| **Money** | Income and expenses, budgets, category donut, six-month trend |
| **Builder** | **Create your own trackers** — see below |
| **Settings** | Theme, accent colour, daily goals, and full data export / import |

## The Builder

This is the part that makes it *yours*.

Tasks and habits cover the basics, but your life has things nobody else tracks — your plants, your gear,
your clients, the coffees you want to try. The Builder lets you define one:

1. Name it, pick an icon, a colour, and where it sits in the sidebar.
2. Add fields — text, long text, number, money, date, choice, tags, yes/no, rating, or link.
3. That's it. It becomes a real module with a table view, card view, search, sorting,
   auto-generated summary stats, and CSV export.

Eight ready-made templates get you going: Reading list, Watchlist, Recipes, Wishlist, Contacts,
Places to go, Learning and Projects. Every one is fully editable after you create it.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Command palette — searches every task, note, habit, goal and custom record you own |
| `Ctrl/⌘ + N` | Create anything |
| `Ctrl/⌘ + B` | Collapse the sidebar |
| `Ctrl/⌘ + /` | Toggle dark / light |
| `Ctrl/⌘ + Z` | Undo |
| `G` then `D`/`T`/`H`/`N`/`F`/`C`/`J`/`G`/`M`/`B`/`L`/`S` | Jump straight to a module |
| `?` | Show all shortcuts |

## Your data

Everything lives in your browser's local storage under the key `gabikos:v1`.

That means it is genuinely private — and it also means **clearing your browser data will delete it**.
Use **Settings → Data → Export everything** now and then; it writes a single JSON file holding your
entire system, which you can import again on any device.

## How it's built

Plain ES modules, plain CSS, zero dependencies.

```
index.html              the shell
styles/
  base.css              design tokens, reset, light & dark themes
  shell.css             sidebar, topbar, responsive layout
  components.css        buttons, cards, inputs, modals, palette, toasts
  apps.css              per-module styles
js/
  main.js               boot, sidebar, keyboard shortcuts, onboarding
  core/
    store.js            state, persistence, undo history, import/export
    router.js           hash routing + view registry
    ui.js               modal, declarative form engine, toasts, context menus
    palette.js          command palette and universal search
    charts.js           inline SVG charts — sparkline, bars, donut, line, heatmap
    markdown.js         small, escape-first markdown renderer
    icons.js            94 inline SVG icons
    theme.js            dark / light / auto + accent colour
    util.js             dates, formatting, fuzzy matching, helpers
  apps/                 one file per module, each registers its own view
```

Adding a module is one file — call `registerView()` with a `render()` that returns HTML and an
optional `onMount()`, and it appears in the sidebar and the command palette automatically.

## Notes on privacy

There is no analytics, no telemetry and no network traffic at all, with one exception: a stylesheet
link to Google Fonts for the Inter typeface. If you would rather have zero external requests, delete
the two `<link>` tags pointing at `fonts.googleapis.com` in `index.html` — the app falls back to your
system font and looks nearly identical.
