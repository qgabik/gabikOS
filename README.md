<div align="center">

# GabikOS

**A personal operating system for your whole life.**

Tasks · Habits · Focus · Calendar · Notes · Journal · Goals · Health · Money — and anything else you decide to track.

*No account. No server. No tracking. Opens in milliseconds.*

</div>

---

## What this is

GabikOS is a single-page web app with no build step and no dependencies. Open `index.html` and it runs.

**Sign in and your data follows you.** GabikOS stores state in your own Supabase account, so the same
tasks, timetable and habits are there on your phone and your computer. Without an account it still works
— everything simply stays in that browser.

| Copy | Storage | Syncs between devices? |
| --- | --- | --- |
| Any host, signed in | Your Supabase account | **Yes** |
| Any host, signed out | This browser's local storage | No |
| Hosted on claude.ai | Private per-account storage there | **Yes** (no separate sign-in) |

The top bar always says which: *Synced*, *Sign in to sync*, or *This device only*.

## Setting it up

### 1. Supabase — the database and accounts

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), **Run**. That creates the
   state table, turns on row-level security so each row is readable only by the user who owns it, and
   enables realtime.
3. **Project Settings → API**: copy the *Project URL* and the *publishable (anon)* key into
   [`js/config.js`](js/config.js) — or paste them into the app under *Settings → Data → Use my own project*,
   which keeps them in that browser only.
4. **Authentication → Providers → Email** is on by default. Turn *Confirm email* off while testing if you
   would rather not check an inbox each time.

The publishable key belongs in client code: it names the project and nothing more. Row-level security is
what protects the data, which is why step 2 is not optional.

### 2. Vercel — the hosting

1. [vercel.com](https://vercel.com) → **Add New → Project** → import this repository.
2. Framework preset **Other**, no build command, output directory `.` — it is a static site.
3. Deploy. [`vercel.json`](vercel.json) sets the caching and security headers.

Add your Vercel URL under Supabase **Authentication → URL Configuration → Redirect URLs**, or the
confirmation and password-reset emails will bounce people to the wrong place.

### 3. Sign in

Open the site, **Settings → Data → Sign in or register**. The first device uploads what is already there;
every device after that pulls it down.

## On your phone

Navigation lives in a bottom bar within thumb reach — Dashboard, Tasks, School, Habits and *More* —
so switching module is one tap instead of hamburger → drawer → tap. The timetable shows one day at a
time with a day picker (swipe left or right to move between days) rather than a five-column grid you
have to scroll sideways.


Open the site and install it to the home screen — it then runs full-screen with its own icon, no
browser bars, exactly like a native app:

- **iPhone (Safari)** — Share → *Add to Home Screen*
- **Android (Chrome)** — ⋮ menu → *Add to Home screen* / *Install app*

A web app manifest and icons ship with the repo, and the layout keeps clear of the notch and the
home indicator when it runs installed.

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
| **School** | Timetable with numbered periods, alternating weeks, block lessons, free-period gaps |
| **Builder** | **Create your own trackers** — see below |
| **Settings** | Six themes, accent colour, reading comfort, sync status, export / import |

## Looking at it for hours

Six palettes — Midnight, Carbon, Forest, Plum, Daylight and Paper — plus *Match system*. None of them use
pure black or pure white, and every one holds body text at about **11:1** contrast rather than the ~19:1 of
`#fff` on `#000`. Maximum contrast is not the same as readable; it is what makes a screen feel like a torch
after an hour.

Whatever accent you pick is automatically darkened or lightened until it clears **4.5:1** on the palette
you chose, so no combination can produce unreadable text. Each module also carries its own hue — tasks
blue, habits green, money gold — so the sidebar reads as a set of places rather than a flat list.

Under **Settings → Appearance** there is also a text-size slider (85–130%, scaling the whole interface)
and compact / normal / roomy row spacing.

## School timetables

Free periods are shown, not left to be inferred from an empty row. A whole empty period between two
lessons appears in the day as its own block — how long, which periods, what time it runs — and the week
grid hatches those slots. A five-minute changeover is not free time and is not marked as any; only a
genuinely empty period counts. The day also carries a one-line summary: first bell to last, how many
periods, how much of it is free.


Built for how Czech schools actually work: numbered periods with their real times, odd/even week
alternation, subject abbreviations and rooms.

Four ways to fill it:

1. **Photograph it.** Point your camera at the timetable — on paper or on screen — and it gets read and
   filled in for you. Rows it cannot read are dropped rather than guessed, and nothing is saved until you
   have reviewed the list. Needs a host that can reach Claude, so this appears on the claude.ai copy and
   stays hidden elsewhere.
2. **Import an `.ics` calendar export** — the most exact. Block lessons that run across several periods
   (practical training, workshops) come in as one merged cell. If the file's lesson times do not match the
   ones configured, it offers to take the file's — so a school whose periods start at 09:50 rather than
   10:00 works without touching settings. Where an export prints a subject's own abbreviation it is kept
   verbatim, and two subjects can never end up sharing a code. Most school systems (ŠkolaOnline, Bakaláři)
   can publish your timetable as a calendar file. The importer collapses however many weeks the file
   covers into one representative week, works out which lessons run on alternating weeks from how often
   they appear, pulls teachers out of the description, drops all-day entries like holidays, and snaps
   each start time to your nearest period. You review and untick before anything is saved.
3. **Paste it** — copy the timetable off the page; it reads day, period, subject and room as best it can.
4. **Type it** — click any empty square. A full week takes a few minutes.

**There is no live link to ŠkolaOnline, and there cannot be one.** A static site has no server to hold a
login, browsers block one site from reading another's private pages, and there is no public API. An
export is a snapshot — when the timetable changes, export again and tick *Replace my current timetable*.

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

Locally, everything lives under the `gabikos:v1` key in your browser's storage. On the claude.ai copy it
*also* lives in per-viewer cloud storage that only you can read — private even from anyone you share the
page with.

**Which copy am I on?** The top bar says *Synced* or *This device only*, and a copy that cannot sync says
so on the dashboard the first time you open it. The two copies keep entirely separate data — the same app,
different storage — so pick one as the daily driver rather than splitting your life across both.

### How sync works

State is split into ten domain slices — tasks, habits, notes, journal, money, and so on — each stored as
its own document. Two reasons, both practical:

- A document is capped at 256 KiB. One ever-growing blob would eventually fail to save.
- Writes are last-writer-wins. Separate slices means editing a task on your phone cannot clobber a note
  you were typing on your computer — only edits to *the same area* can race, and the newer one wins.

Edits are batched (one write per pause, not per keystroke), pushed when the tab is hidden or closed, and
every device subscribes to live updates, so a change on one shows up on the other within a second or two.

Signing in on a device that already held someone else's data wipes it first (after a backup) — otherwise
the new account inherits it, and worse, uploads it. A device that has never synced always takes the
cloud's copy on first connect, whatever its own clock says — otherwise a newly set-up phone, whose starter content is stamped "now", would out-rank the real
data and then overwrite it. Whatever was on the device beforehand is kept under `gabikos:v1:before-sync`
in case it mattered. Starter content never counts as an edit and is never pushed, and it only ever fills
collections that are empty.

**Clearing your browser data still deletes the local copy**, so export a backup now and then regardless.

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
