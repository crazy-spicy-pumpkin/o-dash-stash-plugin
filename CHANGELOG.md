# Changelog

One section per released version, newest first. The heading must match the
version in `o-dashboard.yml` — `tools/release.sh` reads the matching section
and uses it as the tag annotation and the GitHub Release body, so notes are
written once rather than retyped into a web form.

## 0.1.1 — 2026-09-18

- The **Average per day** tile is replaced by **Days since last O**: whole
  calendar days between today and the most recent entry, with that entry's date
  beneath it. It is measured from today rather than from the period on screen,
  so it reads the same whichever week, month or year is showing.

## 0.1.0 — 2026-08-01

First release.

### The dashboard

- Daily O counts for a week, month or year, with `‹` `›` moving one whole
  period at a time and a comparison against the period before it.
- A year calendar, so a long stretch is legible at a glance.
- Time-of-day and day-of-week patterns, over either the current period or all
  time.
- Ranked scenes, performers, studios and tags.
- Timestamps are parsed with their offset honoured rather than sliced off, so
  an event recorded at `22:15+05:30` sorts before one at `23:45Z` instead of
  after it.

### How it reads your library

- Through **Stash's own GraphQL API** — the same interface the Stash UI uses.
  No database file is opened, no second server runs, and there is no write path
  back to Stash.
- Three queries are issued together, and the first paint happens as soon as the
  first returns, so no panel ever shows a half-true zero.
- Changing week, month or year is entirely client-side — no further round trip.

### Themes

Five palettes — TokyoNight Day, Aubade and Spicy Pumpkin in light; Stash and
Naughty in dark — plus an Auto mode that follows the system. The Stash palette
matches the host's default colours, so the dashboard does not look like a
visitor inside its own app.

### Fitting inside Stash

- Adds a nav bar entry and a `/o-dashboard` route.
- Every class, id and keyframe is `od-` prefixed and every rule is scoped under
  `.od-viz-root`, verified by a differential test against Stash's own
  stylesheet in both directions — nothing leaks out, and nothing leaks in.
- Works with authentication enabled. Served from Stash it uses the existing
  session; standalone from another origin it sends an `Apikey` header.

### Trying it without a library

`?demo=1` renders the whole dashboard on synthetic data and says plainly that
no library was read. The screenshots and the theme animation in the README are
all demo data.

### Installing

Add `https://crazy-spicy-pumpkin.github.io/o-dash-stash-plugin/index.yml` as a
plugin source under Settings → Plugins → Available Plugins → Add Source, then
tick **O Dashboard** and Install. See the README for the full table and the
by-hand alternative.
