/* O Dashboard — the dashboard itself.

   ROLE. Everything the user sees and does: bucketing history into periods,
   drawing the charts, ranking the lists, and the theme. It knows nothing about
   Stash — it is handed a payload and renders it, which is what lets the same
   file run as a plugin, standalone, or against synthetic data.

   The source hands over raw event timestamps (epoch ms, UTC); every bucket
   here is computed in the browser's local time zone.

   Wrapped in an IIFE, and not merely for tidiness: Stash concatenates every
   ui.javascript entry into ONE script served at /plugin/{id}/javascript. At the
   top level of a classic script, each of the 58 `function` declarations below
   would become a property of window — including `load`, `render` and `step` —
   where they would collide with Stash's own globals and with any other plugin
   loaded alongside this one. The `const`s would share a single global lexical
   scope for the same reason.

   The only thing that leaves: window.ODashboard. The
   body is left at its original indentation so the wrapping is a two-line
   change rather than a whole-file reformat. */
(() => {

const DAY_MS = 86400000;
const GRAN_LABEL = { week: 'week', month: 'month', year: 'year' };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  gran: 'week',
  anchor: periodStart('week', new Date()),
  // The panels below the fold open on the period you are looking at, not the
  // whole history: the controls above them select a week/month/year, and
  // having the patterns ignore that selection by default reads as a bug.
  scope: 'period',
  data: null,
  dataVersion: '0',
  navDir: 0,
  /** parsed events: [{date: Date, day: number(dayKey), sceneId: string}] */
  events: [],
  views: [],
};

/* --------------------------------------------------------------------- */
/* data source                                                            */
/* --------------------------------------------------------------------- */

/* The dashboard consumes one payload object and does not care where it came
   from. That is the seam the whole project hangs off: live data and demo data
   are two implementations of it, and neither knows about the other.

   THE PAYLOAD — the contract every source must satisfy, and the thing meant
   whenever these files say "the payload":

     {
       generated_at,        // ISO string, when this snapshot of the data was taken
       library_scenes,      // total scenes in the library, for "x of y"
       stash_url,           // base for deep links; '' means "do not link"
       source_caption,      // what the footer says this data is
       events: [{ t, s }],  // one O event: epoch ms, and the scene id
       views:  [ t ],       // one view: epoch ms. No scene attached
       scenes: {            // keyed by scene id, as a string
         "<id>": { title, studio, studio_id, date, rating,
                   performers: [{ id, name }], tags: [{ id, name }] }
       }
     }

   Times are epoch milliseconds UTC; every bucket is computed in local time.

   A source is:  getPayload(force, onPartial) -> payload

   It may call onPartial with an incomplete payload as pieces arrive; load()
   applies each one, so first paint need not wait on the largest query. The
   final return value must be the complete payload. */

/* The last resort, and it should never fire in practice: both shipped entry
   points install a source before app.js runs. If it does fire, someone is
   loading app.js on its own, and a clear message beats a mystery request to an
   endpoint nothing here serves. */
const unconfiguredSource = {
  async getPayload() {
    throw new Error('no data source installed — load graphql-source.js '
      + '(or demo-source.js) before app.js');
  },
};

/* app.js calls load() as it is parsed, so a source installed by a later script
   would arrive after the first load had already gone out to the wrong place —
   which is exactly what happened the first time this was wired up, with every
   automated check still green. Look for an already-installed source instead of
   waiting to be handed one.

   Precedence, highest first:

     window.odSourceOverride   something explicitly asked for. Only demo mode
                               sets it today, when ?demo=1 is present.
     window.graphqlSource      the live source, published whenever its file is
                               loaded — which is always, in both deployments.
     unconfiguredSource                  nothing was loaded; fail with an explanation.

   Each source publishes itself and none of them knows about the others, so the
   dashboard picks a source without ever naming demo mode. */
let dataSource = window.odSourceOverride ?? window.graphqlSource ?? unconfiguredSource;

/** Lets the host swap the data source after startup.
    The plugin mount uses this; nothing else needs to. */
function setDataSource(source) { dataSource = source; }

/* --------------------------------------------------------------------- */
/* date helpers (all local time)                                          */
/* --------------------------------------------------------------------- */

/** Normalises a moment to the day it falls in — the basis of every bucket. */
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
/** The week a day belongs to.
    Monday-first, so "this week" means one thing everywhere in the UI. */
function startOfWeek(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday-first
  return x;
}
/** The month a day belongs to. */
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
/** The year a day belongs to. */
function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }

/** Which period a day belongs to, at whatever granularity is on screen.
    The other three are the per-granularity cases behind it. */
function periodStart(gran, d) {
  if (gran === 'week') return startOfWeek(d);
  if (gran === 'month') return startOfMonth(d);
  return startOfYear(d);
}
/** Powers the ‹ › navigation: one press moves one whole period,
    not a fixed number of days. */
function shiftPeriod(gran, d, n) {
  if (gran === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n);
  if (gran === 'month') return new Date(d.getFullYear(), d.getMonth() + n, 1);
  return new Date(d.getFullYear() + n, 0, 1);
}
/** Where a period stops, so consecutive periods never overlap or leave a gap. */
function periodEnd(gran, d) { return shiftPeriod(gran, d, 1); }

/** Keeps date arithmetic honest across months of different lengths. */
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

/** Keeps your place when the zoom level changes.

    Picks a representative day inside the displayed period: today's position
    within it when that fits, so Year → Month lands on the current month rather
    than January. */
function focusDay(gran, start) {
  const today = new Date();
  if (today >= start && today < periodEnd(gran, start)) return startOfDay(today);
  if (gran === 'year') {
    const month = today.getMonth();
    return new Date(start.getFullYear(), month,
      Math.min(today.getDate(), daysInMonth(start.getFullYear(), month)));
  }
  if (gran === 'month') {
    return new Date(start.getFullYear(), start.getMonth(),
      Math.min(today.getDate(), daysInMonth(start.getFullYear(), start.getMonth())));
  }
  // A week can straddle two months: let its Thursday decide which one it is.
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 3);
}

/** One comparable identity per calendar day.
    An integer rather than a Date, so counting by day cannot be tripped by DST. */
function dayKey(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
/** The same day identity, for a day being walked over rather than held.
    Used while laying out the calendar grid, where building a Date per cell is waste. */
function dayKeyOf(y, m, day) { return y * 10000 + (m + 1) * 100 + day; }
/** Answers "how long ago" — behind the streaks, gaps and "days since" figures. */
function daysBetween(a, b) { return Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS); }

const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayYear = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const fmtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** Labels the time-of-day axis in the reader's own conventions, not the code's. */
function hourLabel(h) {
  const d = new Date(2000, 0, 1, h);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(d);
}

/** Names the period on screen, so the header always says what you are looking at. */
function periodTitle(gran, start) {
  if (gran === 'week') {
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return `${fmtDay.format(start)} – ${fmtDayYear.format(end)}`;
  }
  if (gran === 'month') return fmtMonthYear.format(start);
  return String(start.getFullYear());
}

/* --------------------------------------------------------------------- */
/* tiny DOM/SVG helpers                                                   */
/* --------------------------------------------------------------------- */

/* Every id is namespaced `od-`, because getElementById searches the whole
   document: inside Stash, a bare byId('main') would return the host's element if
   it came first, and the dashboard would quietly drive someone else's UI. */
const byId = (id) => document.getElementById(id);

/** The mount container — <body> standalone, the route's div in the plugin.
    Everything that must not escape hangs off this one element: the styles, the
    data-theme attribute, and the key handlers. */
let vizRootEl = null;
const vizRoot = () => (vizRootEl ??= document.querySelector('.od-viz-root'));
/** Tells the dashboard which element it owns.
    Everything scoped — styles, theme, key handling — hangs off that one node. */
function setVizRoot(el) { vizRootEl = el; }

/** Set by the plugin entry; see stashLink for what it changes. */
let inApp = false;

/** Decides whether a keypress belongs to the dashboard or to the page around it.

    The shortcuts are bare single keys — fine when the dashboard is the whole
    page, hostile once it shares a document with Stash's Mousetrap bindings and
    every search box in the UI. Listeners stay on window so the keys work
    without clicking the page first; this is the guard that makes that safe.

    isConnected rather than a visibility test: the plugin route unmounts its
    container on navigation, and <body> — the standalone mount — reports no
    offsetParent, so the obvious check would disable the keys everywhere. */
function dashboardOwnsKeys(ev) {
  const root = vizRoot();
  if (!root?.isConnected) return false;
  const t = ev.target;
  return !(t instanceof HTMLElement
    && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}

/* --------------------------------------------------------------------- */
/* motion                                                                 */
/* --------------------------------------------------------------------- */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.2, 0.8, 0.3, 1)';

/** Views already animated this session. An entrance is a first impression:
    replaying it every time you step back to a week you've seen is noise. Keys
    carry the data version, so a refresh that changes the data animates again. */
const animatedViews = new Set();

/** Keeps entrance animations a reward for new data, rather than a tic on
    every render. */
function isFirstShowOf(key) {
  const full = `${state.dataVersion}|${key}`;
  if (animatedViews.has(full)) return false;
  animatedViews.add(full);
  return true;
}

/** Honours the reader's reduced-motion setting, once, for every animation here. */
function animate(node, keyframes, options) {
  if (reduceMotion.matches || !node?.animate) return null;
  return node.animate(keyframes, { easing: EASE, fill: 'backwards', ...options });
}

/** Makes navigation feel directional, so stepping back and forward are
    distinguishable at a glance. */
function enterPanel(node, dir = 0) {
  animate(node, [
    { opacity: 0, transform: `translateX(${dir * 14}px)` },
    { opacity: 1, transform: 'none' },
  ], { duration: 260 });
}

/** Draws the eye to a figure that has changed. */
function countUpTo(node, value, decimals = 0, allow = true) {
  const from = Number(node.dataset.value ?? NaN);
  node.dataset.value = String(value);
  if (!allow || reduceMotion.matches || Number.isNaN(from) || from === value) {
    node.textContent = value.toFixed(decimals);
    return;
  }
  const start = performance.now();
  const duration = 420;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    node.textContent = (from + (value - from) * eased).toFixed(decimals);
    if (t < 1) requestAnimationFrame(tick);
    else node.textContent = value.toFixed(decimals);
  };
  requestAnimationFrame(tick);
}

/** The whole charting layer is built from this — no chart library, just
    elements and geometry. */
function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Lets a panel be redrawn from scratch without leaking the previous render. */
function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Gives bars their shape: rounded at the data end, square where they meet
    the baseline, so the axis stays a hard line. */
function roundedColumnPath(x, y, w, h, r = 4) {
  const rad = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rad} Q${x},${y} ${x + rad},${y} `
       + `L${x + w - rad},${y} Q${x + w},${y} ${x + w},${y + rad} L${x + w},${y + h} Z`;
}

/** Keeps an axis readable by labelling round numbers, rather than whatever
    the data's maximum happens to be. */
function axisTicks(max) {
  const top = Math.max(1, max);
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const step = steps.find((s) => top / s <= 4) ?? Math.ceil(top / 4);
  const ticks = [];
  for (let v = 0; v <= top + 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < top) ticks.push(ticks[ticks.length - 1] + step);
  return { ticks, top: ticks[ticks.length - 1] };
}

/* --------------------------------------------------------------------- */
/* tooltip                                                                */
/* --------------------------------------------------------------------- */

const tooltip = {
  node: null,
  /** (x, y) is the anchor: the tooltip sits above it, flipping below and
      clamping to the viewport rather than spilling off-screen. */
  show(html, x, y) {
    if (!this.node) this.node = byId('od-tooltip');
    const n = this.node;
    const wasHidden = !n.classList.contains('od-show');
    // appearing somewhere new should be a cut, not a glide across the page
    n.classList.toggle('od-jump', wasHidden);
    n.innerHTML = html;
    n.classList.add('od-show');
    const w = n.offsetWidth, h = n.offsetHeight;
    let top = y - 12 - h;
    if (top < 8) top = y + 18;
    n.style.left = `${Math.max(8, Math.min(x - w / 2, window.innerWidth - w - 8))}px`;
    n.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`;
    if (wasHidden) {
      void n.offsetWidth; // settle the new position before easing resumes
      n.classList.remove('od-jump');
    }
  },
  hide() {
    if (this.node) this.node.classList.remove('od-show');
  },
};

/** Gives a mark the detail the chart itself has no room to show.
    Focus as well as hover, so it is reachable from the keyboard. */
function attachTooltip(target, htmlFn) {
  const move = (ev) => {
    const r = target.getBoundingClientRect();
    tooltip.show(htmlFn(), r.left + r.width / 2, r.top);
  };
  target.addEventListener('mouseenter', move);
  target.addEventListener('mousemove', move);
  target.addEventListener('mouseleave', () => tooltip.hide());
  target.addEventListener('focus', move);
  target.addEventListener('blur', () => tooltip.hide());
}

/* --------------------------------------------------------------------- */
/* charts                                                                 */
/* --------------------------------------------------------------------- */

/** The main chart: how much, per bucket, across the period on screen.
    items: [{label, value, tip, dim, onClick}] */
function renderColumns(container, items, opts = {}) {
  const { tickEvery = 1, plotHeight = 176, labelExtremes = true, animateIn = false } = opts;
  clearChildren(container);
  if (!items.length) {
    container.innerHTML = '<p class="od-empty">No entries in this period.</p>';
    return;
  }

  const width = Math.max(container.clientWidth || 640, 260);
  const padL = 30, padR = 10, padT = 20, axisBand = 24;
  const height = plotHeight + padT + axisBand;
  const plotW = width - padL - padR;
  const y0 = padT + plotHeight;

  const max = Math.max(...items.map((d) => d.value));
  const { ticks, top } = axisTicks(max);
  const yOf = (v) => y0 - (v / top) * plotHeight;

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, height, role: 'img' });

  for (const t of ticks) {
    const y = yOf(t);
    svg.appendChild(svgEl('line', {
      x1: padL, x2: width - padR, y1: y, y2: y,
      class: t === 0 ? 'od-baseline' : 'od-gridline',
    }));
    const label = svgEl('text', { x: padL - 8, y: y + 4, class: 'od-tick-text', 'text-anchor': 'end' });
    label.textContent = t;
    svg.appendChild(label);
  }

  const band = plotW / items.length;
  const barW = Math.max(3, Math.min(24, band - 6));
  const labelled = labelExtremes && max > 0
    ? new Set(items.filter((d) => d.value === max).length <= 3
        ? items.map((d, i) => (d.value === max ? i : -1)).filter((i) => i >= 0)
        : [])
    : new Set();

  const bars = [];
  const washes = [];

  items.forEach((d, i) => {
    const cx = padL + band * i + band / 2;
    const bx = cx - barW / 2;

    // hover wash sits behind the mark, one band wide
    const wash = svgEl('rect', {
      x: padL + band * i + 1, y: padT, width: Math.max(1, band - 2), height: plotHeight,
      class: 'od-band-wash', rx: 4,
    });
    washes[i] = wash;
    svg.appendChild(wash);

    if (d.value > 0) {
      const h = Math.max(2, y0 - yOf(d.value));
      const bar = svgEl('path', { d: roundedColumnPath(bx, y0 - h, barW, h), class: 'od-bar' });
      if (d.dim) bar.setAttribute('opacity', '0.45');
      bars[i] = bar;
      svg.appendChild(bar);
      // grow from the baseline, stepping left to right
      if (animateIn) {
        animate(bar, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }],
          { duration: 380, delay: Math.min(i * 18, 280) });
      }
      if (labelled.has(i)) {
        const t = svgEl('text', { x: cx, y: y0 - h - 7, class: 'od-bar-label' });
        t.textContent = d.value;
        svg.appendChild(t);
        if (animateIn) {
          animate(t, [{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
            { duration: 620, delay: Math.min(i * 18, 280) });
        }
      }
    }

    if (i % tickEvery === 0) {
      const t = svgEl('text', { x: cx, y: y0 + 16, class: 'od-tick-text', 'text-anchor': 'middle' });
      t.textContent = d.label;
      svg.appendChild(t);
    }

    const hit = svgEl('rect', {
      x: padL + band * i, y: padT, width: band, height: plotHeight,
      class: 'od-hit', tabindex: '0',
    });
    if (d.onClick) {
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', d.onClick);
      hit.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') d.onClick(); });
    }
    const highlight = (on) => {
      washes[i].classList.toggle('od-on', on);
      bars[i]?.classList.toggle('od-active', on);
    };
    hit.addEventListener('mouseenter', () => highlight(true));
    hit.addEventListener('mouseleave', () => highlight(false));
    hit.addEventListener('focus', () => highlight(true));
    hit.addEventListener('blur', () => highlight(false));
    attachTooltip(hit, () => d.tip);
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/** The hero's trend line — where this period sits against the last twelve. */
function renderSparkline(container, values, animateIn = false) {
  clearChildren(container);
  if (values.length < 2) return;
  const width = Math.max(container.clientWidth || 240, 120);
  const height = 42, pad = 6;
  const max = Math.max(1, ...values);
  const stepX = (width - pad * 2) / (values.length - 1);
  const yOf = (v) => height - pad - (v / max) * (height - pad * 2);

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, height, 'aria-hidden': 'true' });
  const pts = values.map((v, i) => [pad + stepX * i, yOf(v)]);
  const line = svgEl('path', {
    d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    class: 'od-spark-line',
  });
  svg.appendChild(line);
  const [lx, ly] = pts[pts.length - 1];
  const dot = svgEl('circle', { cx: lx, cy: ly, r: 4, class: 'od-spark-dot' });
  svg.appendChild(dot);
  container.appendChild(svg);

  if (!animateIn) return;
  // draw the line on, then pop the current-period dot
  const len = line.getTotalLength?.() || 0;
  if (len) {
    animate(line, [{ strokeDasharray: len, strokeDashoffset: len }, { strokeDasharray: len, strokeDashoffset: 0 }],
      { duration: 520 });
  }
  animate(dot, [{ transform: 'scale(0)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
    { duration: 260, delay: 420 });
}

/** The year at a glance: density per day, and the way into any single week. */
function renderHeatmap(container, year, countsByDay, selection, animateIn) {
  clearChildren(container);
  const cell = 12, gap = 3, step = cell + gap;
  const gutterL = 28, gutterT = 18;
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  const gridStart = startOfWeek(jan1);
  const weeks = Math.ceil((daysBetween(gridStart, dec31) + 1) / 7);
  const width = gutterL + weeks * step;
  const height = gutterT + 7 * step;
  const todayKey = dayKey(new Date());

  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
  svg.setAttribute('style', `width:${width}px;max-width:none`);

  [0, 2, 4].forEach((row) => {
    const t = svgEl('text', { x: 0, y: gutterT + row * step + cell - 2, class: 'od-dow-text' });
    t.textContent = DOW[row].slice(0, 1);
    svg.appendChild(t);
  });

  let lastMonthCol = -2;
  for (let w = 0; w < weeks; w++) {
    for (let r = 0; r < 7; r++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + r);
      if (d.getFullYear() !== year) continue;
      const key = dayKey(d);
      const count = countsByDay.get(key) || 0;
      const x = gutterL + w * step;
      const y = gutterT + r * step;

      const bin = count === 0 ? 0 : Math.min(4, count);
      const rect = svgEl('rect', {
        x, y, width: cell, height: cell, class: 'od-cell',
        fill: `var(--ramp-${bin})`,
      });
      if (key > todayKey) rect.setAttribute('opacity', '0.35');
      svg.appendChild(rect);
      // ripple across the year, week column by week column — only when the year
      // itself changes, so stepping through weeks doesn't replay it
      if (animateIn) {
        animate(rect, [
          { opacity: 0, transform: 'scale(0.6)' },
          { opacity: rect.getAttribute('opacity') ?? 1, transform: 'scale(1)' },
        ], { duration: 260, delay: 60 + w * 7 });
      }

      if (selection && key >= selection.from && key <= selection.to) {
        const ring = svgEl('rect', {
          x: x - 1.5, y: y - 1.5, width: cell + 3, height: cell + 3, class: 'od-cell-sel',
        });
        svg.appendChild(ring);
        // A selection marker should track the selection instantly; it only
        // fades in when the calendar itself is new.
        if (animateIn) animate(ring, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
      }

      const hit = svgEl('rect', {
        x: x - gap / 2, y: y - gap / 2, width: step, height: step,
        class: 'od-hit', tabindex: '0',
      });
      hit.style.cursor = 'pointer';
      const jump = () => {
        state.gran = 'week';
        state.anchor = startOfWeek(d);
        syncControls();
        render();
      };
      hit.addEventListener('click', jump);
      hit.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') jump(); });
      attachTooltip(hit, () => `<b>${count} ${count === 1 ? 'entry' : 'entries'}</b><br>`
        + `<span class="od-tt-sub">${fmtDayYear.format(d)}</span>`);
      svg.appendChild(hit);

      if (r === 0 && d.getDate() <= 7 && w > lastMonthCol + 2) {
        const t = svgEl('text', { x, y: 10, class: 'od-month-text' });
        t.textContent = MONTHS[d.getMonth()];
        svg.appendChild(t);
        lastMonthCol = w;
      }
    }
  }
  container.appendChild(svg);
}

/** Answers "what do I come back to" — the scene, performer and tag rankings. */
function renderRanked(container, rows, emptyText, animateIn = false) {
  clearChildren(container);
  if (!rows.length) {
    container.innerHTML = `<p class="od-empty">${emptyText}</p>`;
    return;
  }
  const max = Math.max(...rows.map((r) => r.value));
  for (const row of rows) {
    const wrap = document.createElement('div');
    wrap.className = 'od-rank-row';

    const name = document.createElement(row.href ? 'a' : 'span');
    name.className = 'od-rank-name';
    name.textContent = row.name;
    name.title = row.href ? `${row.name} — open in Stash` : row.name;
    if (row.href) {
      name.href = row.href;
      name.target = '_blank';
      name.rel = 'noopener noreferrer';
    }

    const value = document.createElement('span');
    value.className = 'od-rank-value';
    value.textContent = row.value;

    const track = document.createElement('div');
    track.className = 'od-rank-track';
    const fill = document.createElement('div');
    fill.className = animateIn ? 'od-rank-fill od-grow' : 'od-rank-fill';
    fill.style.width = `${Math.max(4, (row.value / max) * 100)}%`;
    track.appendChild(fill);

    wrap.append(name, value, track);
    if (row.meta) {
      const href = row.meta.id != null ? stashLink('studios', row.meta.id) : null;
      const meta = document.createElement(href ? 'a' : 'span');
      meta.className = 'od-rank-meta';
      meta.textContent = row.meta.name;
      if (href) {
        meta.href = href;
        meta.target = '_blank';
        meta.rel = 'noopener noreferrer';
        meta.title = `${row.meta.name} — open in Stash`;
      }
      wrap.appendChild(meta);
    }
    container.appendChild(wrap);
  }
}

/** The table twin of a chart, so no value is reachable only by hovering. */
function renderTable(container, head, rows) {
  clearChildren(container);
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of head) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const c of row) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  container.appendChild(table);
}

/* --------------------------------------------------------------------- */
/* aggregation                                                            */
/* --------------------------------------------------------------------- */

/** Narrows O events to the period on screen. */
function eventsBetween(from, to) {
  return state.events.filter((e) => e.date >= from && e.date < to);
}
/** Narrows views to the period on screen. */
function viewsBetween(from, to) {
  return state.views.filter((t) => t >= +from && t < +to);
}

/** Turns a flat list of events into per-day totals — the shape every chart
    here draws from. */
function countsByDayMap(events) {
  const map = new Map();
  for (const e of events) map.set(e.day, (map.get(e.day) || 0) + 1);
  return map;
}

/** Buckets for the main chart of the selected period. */
function bucketsForPeriod(gran, start) {
  const end = periodEnd(gran, start);
  const out = [];
  if (gran === 'year') {
    for (let m = 0; m < 12; m++) {
      const from = new Date(start.getFullYear(), m, 1);
      const to = new Date(start.getFullYear(), m + 1, 1);
      out.push({ from, to, label: MONTHS[m], full: fmtMonthYear.format(from), gran: 'month' });
    }
    return out;
  }
  for (let d = new Date(start); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const from = new Date(d);
    const to = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    out.push({
      from, to, gran: 'day',
      label: gran === 'week' ? DOW[(from.getDay() + 6) % 7] : String(from.getDate()),
      full: fmtDayYear.format(from),
    });
  }
  return out;
}

/** Builds the ranked lists: who or what shows up most.

    Counts events by entity. keyFn yields {id, name} objects, so ties keep their
    identity and each row can link back into Stash. */
function rankBy(events, keyFn, kind, limit = 6) {
  const map = new Map();
  for (const e of events) {
    for (const item of keyFn(e)) {
      if (!item || item.id == null) continue;
      const row = map.get(item.id) || { id: item.id, name: item.name, value: 0, meta: item.meta };
      row.value++;
      map.set(item.id, row);
    }
  }
  return [...map.values()]
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row) => ({ ...row, href: stashLink(kind, row.id) }));
}

/** Deep link into the running Stash UI — three modes, genuinely distinct:

    in-app     — running inside Stash. A root-relative path, which react-router
                 handles without a page load. Better UX than an absolute URL,
                 and it is why an empty stash_url is legitimate here.
    absolute   — standalone, pointing at a Stash elsewhere.
    none       — demo mode. `stash_url` is empty *and* we are not in-app, so
                 there is nothing to link to and the caller renders plain text.

    Collapsing the first and last would make demo mode emit links to scenes
    that do not exist. */
function stashLink(kind, id) {
  if (inApp) return `/${kind}/${id}`;
  const base = state.data?.stash_url;
  return base ? `${base}/${kind}/${id}` : null;
}

/** Resolves an event back to its scene, for labels and deep links. */
function sceneFor(e) { return state.data.scenes[e.sceneId] || null; }

const TIP_ROWS = 4;

/** Stops titles and names being read as markup when they reach innerHTML. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** Explains a bucket without making you leave the chart.
    Count, name, then a few entries — never a wall of text. */
function bucketTooltipHtml(bucket, events, drillable) {
  const head = `<b>${events.length} ${events.length === 1 ? 'entry' : 'entries'}</b>`
    + `<br><span class="od-tt-sub">${escapeHtml(bucket.full)}</span>`;
  if (!events.length) return head;
  const rows = events.slice(0, TIP_ROWS).map((e) => {
    const title = sceneFor(e)?.title || 'unknown scene';
    const short = title.length > 38 ? `${title.slice(0, 37)}…` : title;
    return `${fmtTime.format(e.date)} · ${escapeHtml(short)}`;
  });
  const more = events.length - rows.length;
  return head + '<br>' + rows.join('<br>')
    + (more > 0 ? `<br><span class="od-tt-sub">+ ${more} more</span>` : '')
    + (drillable ? '<br><span class="od-tt-sub">click to drill in</span>' : '');
}

/* --------------------------------------------------------------------- */
/* render                                                                 */
/* --------------------------------------------------------------------- */

/** Redraws everything for the current period and scope.
    Every interaction in the file ends here; nothing else touches the DOM wholesale. */
function render() {
  if (!state.data) return;
  writeHash();
  const { gran, anchor } = state;
  const start = anchor;
  const end = periodEnd(gran, start);
  const prevStart = shiftPeriod(gran, start, -1);

  const inPeriod = eventsBetween(start, end);
  const inPrev = eventsBetween(prevStart, start);
  const buckets = bucketsForPeriod(gran, start);
  const dayCounts = countsByDayMap(inPeriod);
  const view = `${gran}:${isoDay(start)}`; // identifies the period on screen

  byId('od-period-label').textContent = periodTitle(gran, start);

  /* ---- navigation limits ---- */
  const firstEvent = state.events[0]?.date ?? new Date();
  byId('od-prev-btn').disabled = +start <= +periodStart(gran, firstEvent);
  byId('od-next-btn').disabled = +start >= +periodStart(gran, new Date());

  /* ---- hero ---- */
  const isCurrent = +start === +periodStart(gran, new Date());
  byId('od-hero-label').textContent = isCurrent ? `This ${GRAN_LABEL[gran]}` : periodTitle(gran, start);
  countUpTo(byId('od-hero-value'), inPeriod.length, 0, isFirstShowOf(`hero:${view}`));
  const diff = inPeriod.length - inPrev.length;
  byId('od-hero-delta').textContent = state.events.length
    ? `${diff === 0 ? '±0' : (diff > 0 ? `↑ ${diff}` : `↓ ${Math.abs(diff)}`)} vs previous ${GRAN_LABEL[gran]} (${inPrev.length})`
    : '';

  // Look back 12 periods, but never past the first recorded entry — a flat run of
  // empty years before the data starts says nothing.
  const firstPeriod = periodStart(gran, state.events[0]?.date ?? start);
  let back = 0;
  while (back < 11 && shiftPeriod(gran, start, -(back + 1)) >= firstPeriod) back++;
  const sparkValues = [];
  for (let i = back; i >= 0; i--) {
    const s = shiftPeriod(gran, start, -i);
    sparkValues.push(eventsBetween(s, periodEnd(gran, s)).length);
  }
  renderSparkline(byId('od-hero-spark'), sparkValues, isFirstShowOf(`spark:${view}`));
  byId('od-hero-spark-caption').textContent = sparkValues.length > 1
    ? `last ${sparkValues.length} ${GRAN_LABEL[gran]}s — peak ${Math.max(...sparkValues)}`
    : '';

  /* ---- tiles ---- */
  const bucketCounts = buckets.map((b) => eventsBetween(b.from, b.to).length);
  const bestIdx = bucketCounts.indexOf(Math.max(...bucketCounts));
  const activeDays = new Set(inPeriod.map((e) => e.day)).size;
  const totalDays = daysBetween(start, end);
  const elapsedDays = Math.min(totalDays, Math.max(1, daysBetween(start, new Date()) + 1));
  const periodViews = viewsBetween(start, end).length;
  const subUnit = gran === 'year' ? 'month' : gran === 'month' ? 'day' : 'day';

  const tiles = [
    {
      label: 'Active days',
      value: activeDays,
      sub: `of ${totalDays} in the ${GRAN_LABEL[gran]}`,
    },
    {
      label: `Best ${subUnit}`,
      value: bucketCounts[bestIdx] || 0,
      sub: !bucketCounts[bestIdx] ? '—'
        : (() => {
            const ties = bucketCounts.filter((v) => v === bucketCounts[bestIdx]).length;
            return buckets[bestIdx].full + (ties > 1 ? ` + ${ties - 1} tied` : '');
          })(),
    },
    {
      label: `Average per ${gran === 'year' ? 'month' : 'day'}`,
      value: gran === 'year'
        ? (inPeriod.length / 12).toFixed(1)
        : (inPeriod.length / Math.max(1, elapsedDays)).toFixed(2),
      sub: gran === 'year' ? 'across 12 months' : `over ${elapsedDays} day${elapsedDays === 1 ? '' : 's'} elapsed`,
    },
    {
      label: 'Scenes watched',
      value: periodViews,
      sub: periodViews
        ? `${inPeriod.length} O per ${periodViews} views (${((inPeriod.length / periodViews) * 100).toFixed(1)}%)`
        : 'no views logged',
    },
  ];

  const tilesEl = byId('od-tiles');
  clearChildren(tilesEl);
  const tilesFirst = isFirstShowOf(`tiles:${view}`);
  tiles.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'od-tile';
    card.innerHTML = `<p class="od-label"></p><p class="od-tile-value"></p><p class="od-tile-sub"></p>`;
    card.children[0].textContent = t.label;
    card.children[1].textContent = t.value;
    card.children[2].textContent = t.sub;
    tilesEl.appendChild(card);
    if (tilesFirst) {
      animate(card, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
        { duration: 260, delay: i * 45 });
    }
  });

  /* ---- main chart ---- */
  byId('od-main-chart-title').textContent = gran === 'year' ? 'O count by month' : 'O count by day';
  byId('od-main-chart-caption').textContent = `${inPeriod.length} total · ${periodTitle(gran, start)}`;
  renderColumns(byId('od-main-chart'), buckets.map((b, i) => ({
    label: b.label,
    value: bucketCounts[i],
    dim: b.from > new Date(),
    tip: bucketTooltipHtml(b, eventsBetween(b.from, b.to), gran !== 'week'),
    onClick: gran === 'year' ? () => { state.gran = 'month'; state.anchor = b.from; syncControls(); render(); }
      : gran === 'month' ? () => { state.gran = 'week'; state.anchor = startOfWeek(b.from); syncControls(); render(); }
      : null,
  })), {
    tickEvery: gran === 'month' && buckets.length > 20 ? 2 : 1,
    animateIn: isFirstShowOf(`main:${view}`),
  });

  renderTable(byId('od-main-chart-table'), [gran === 'year' ? 'Month' : 'Day', 'O count'],
    buckets.map((b, i) => [b.full, bucketCounts[i]]));

  /* ---- heatmap (year containing the anchor) ---- */
  if (state.navDir) enterPanel(byId('od-main-chart'), state.navDir);

  const year = start.getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year + 1, 0, 1);
  const yearEvents = eventsBetween(yearStart, yearEnd);
  byId('od-heatmap-title').textContent = `${year} calendar`;
  // The ring marks the selected week/month inside the year; for a whole-year
  // selection it would outline every cell, so it is dropped.
  renderHeatmap(byId('od-heatmap'), year, countsByDayMap(yearEvents), gran === 'year' ? null : {
    from: dayKey(start),
    to: dayKey(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1)),
  }, isFirstShowOf(`heat:${year}`));
  const monthTotals = MONTHS.map((m, i) => [
    `${m} ${year}`,
    eventsBetween(new Date(year, i, 1), new Date(year, i + 1, 1)).length,
  ]);
  renderTable(byId('od-heatmap-table'), ['Month', 'O count'], monthTotals);

  /* ---- patterns + top lists (scoped) ---- */
  const scoped = state.scope === 'period' ? inPeriod : state.events;
  const scopeName = state.scope === 'period' ? periodTitle(gran, start) : 'all time';
  byId('od-scope-caption').textContent = `${scoped.length} ${scoped.length === 1 ? 'entry' : 'entries'} · ${scopeName}`;

  // patterns depend only on the scoped set, so all-time views share one key
  const patternKey = state.scope === 'period' ? `period:${view}` : 'all';

  const hourCounts = Array.from({ length: 24 }, () => 0);
  for (const e of scoped) hourCounts[e.date.getHours()]++;
  renderColumns(byId('od-hour-chart'), hourCounts.map((v, h) => ({
    label: h % 6 === 0 ? hourLabel(h) : '',
    value: v,
    tip: `<b>${v} ${v === 1 ? 'entry' : 'entries'}</b><br><span class="od-tt-sub">${hourLabel(h)}–${hourLabel((h + 1) % 24)}</span>`,
  })), { tickEvery: 3, plotHeight: 140, animateIn: isFirstShowOf(`hour:${patternKey}`) });
  renderTable(byId('od-hour-table'), ['Hour', 'O count'],
    hourCounts.map((v, h) => [`${hourLabel(h)}–${hourLabel((h + 1) % 24)}`, v]));

  const dowCounts = Array.from({ length: 7 }, () => 0);
  for (const e of scoped) dowCounts[(e.date.getDay() + 6) % 7]++;
  renderColumns(byId('od-dow-chart'), dowCounts.map((v, i) => ({
    label: DOW[i],
    value: v,
    tip: `<b>${v} ${v === 1 ? 'entry' : 'entries'}</b><br><span class="od-tt-sub">${DOW[i]}</span>`,
  })), { plotHeight: 140, animateIn: isFirstShowOf(`dow:${patternKey}`) });
  renderTable(byId('od-dow-table'), ['Weekday', 'O count'], dowCounts.map((v, i) => [DOW[i], v]));

  const ranksFirst = isFirstShowOf(`rank:${patternKey}`);
  renderRanked(byId('od-top-scenes'), rankBy(scoped, (e) => {
    const scene = sceneFor(e);
    if (!scene) return [];
    return [{
      id: e.sceneId,
      name: scene.title,
      meta: scene.studio ? { name: scene.studio, id: scene.studio_id } : undefined,
    }];
  }, 'scenes'), 'No entries in scope.', ranksFirst);
  renderRanked(byId('od-top-performers'),
    rankBy(scoped, (e) => sceneFor(e)?.performers || [], 'performers'),
    'No performers tagged.', ranksFirst);
  renderRanked(byId('od-top-tags'),
    rankBy(scoped, (e) => sceneFor(e)?.tags || [], 'tags'),
    'No tags on these scenes.', ranksFirst);

  renderFacts();
  state.navDir = 0;
}

/** The all-time summary: the figures that do not belong on a chart. */
function renderFacts() {
  const all = state.events;
  const el = byId('od-facts');
  clearChildren(el);
  if (!all.length) {
    el.innerHTML = '<p class="od-empty">No O history recorded yet.</p>';
    return;
  }

  const first = all[0].date;
  const last = all[all.length - 1].date;
  const spanDays = Math.max(1, daysBetween(first, new Date()) + 1);

  const dow = Array.from({ length: 7 }, () => 0);
  const hours = Array.from({ length: 24 }, () => 0);
  for (const e of all) {
    dow[(e.date.getDay() + 6) % 7]++;
    hours[e.date.getHours()]++;
  }
  const bestDow = dow.indexOf(Math.max(...dow));
  const bestHour = hours.indexOf(Math.max(...hours));

  let longestGap = 0, gapEnd = null;
  for (let i = 1; i < all.length; i++) {
    const gap = daysBetween(all[i - 1].date, all[i].date);
    if (gap > longestGap) { longestGap = gap; gapEnd = all[i].date; }
  }

  const byDay = countsByDayMap(all);
  const bestDayCount = Math.max(...byDay.values());
  const bestDayKey = [...byDay.entries()].find(([, v]) => v === bestDayCount)[0];
  const bestDayEvent = all.find((e) => e.day === bestDayKey);

  const uniqueScenes = new Set(all.map((e) => e.sceneId)).size;

  const facts = [
    ['Total recorded', `${all.length}`],
    ['First entry', fmtDate.format(first)],
    ['Most recent', `${fmtDate.format(last)} · ${daysBetween(last, new Date())} days ago`],
    ['Average per week', (all.length / (spanDays / 7)).toFixed(1)],
    ['Busiest day', `${bestDayCount} on ${fmtDate.format(bestDayEvent.date)}`],
    ['Favourite weekday', `${DOW[bestDow]} · ${dow[bestDow]} entries`],
    ['Peak hour', `${hourLabel(bestHour)} · ${hours[bestHour]} entries`],
    ['Longest gap', `${longestGap} days${gapEnd ? `, ended ${fmtDate.format(gapEnd)}` : ''}`],
    // The library total can arrive after the events do; say less rather than
    // "of undefined", and never a zero that reads as a real denominator.
    ['Distinct scenes', state.data.library_scenes
      ? `${uniqueScenes} of ${state.data.library_scenes} in the library`
      : `${uniqueScenes}`],
  ];

  for (const [label, value] of facts) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<p class="od-fact-label"></p><p class="od-fact-value"></p>';
    wrap.children[0].textContent = label;
    wrap.children[1].textContent = value;
    el.appendChild(wrap);
  }
}

/** Explains what the calendar's shades mean. */
function renderLegend() {
  const el = byId('od-heatmap-legend');
  el.innerHTML = '<span>Less</span><span class="od-swatches"></span><span>More</span>';
  const sw = el.querySelector('.od-swatches');
  for (let i = 0; i <= 4; i++) {
    const swatch = document.createElement('i');
    swatch.style.background = `var(--ramp-${i})`;
    swatch.title = i === 0 ? '0' : i === 4 ? '4 or more' : String(i);
    sw.appendChild(swatch);
  }
}

/* --------------------------------------------------------------------- */
/* controls & data                                                        */
/* --------------------------------------------------------------------- */

/** The view lives in the URL hash, so a period is bookmarkable and survives reload. */
/** Formats a day for the URL hash. */
function isoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Puts you back where you were, so a reload or a shared link lands on the
    same view. */
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const gran = params.get('g');
  if (['week', 'month', 'year'].includes(gran)) state.gran = gran;
  const day = params.get('d');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [y, m, d] = day.split('-').map(Number);
    state.anchor = periodStart(state.gran, new Date(y, m - 1, d));
  } else {
    state.anchor = periodStart(state.gran, new Date());
  }
  const scope = params.get('s');
  if (['period', 'all'].includes(scope)) state.scope = scope;
}

/** Keeps the URL describing what is on screen, without filling up the back button. */
function writeHash() {
  const next = `#g=${state.gran}&d=${isoDay(state.anchor)}&s=${state.scope}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

/** Keeps the controls announcing which option is active to assistive tech. */
function syncControls() {
  for (const b of document.querySelectorAll('#od-granularity button')) {
    b.setAttribute('aria-selected', String(b.dataset.gran === state.gran));
  }
  for (const b of document.querySelectorAll('#od-scope button')) {
    b.setAttribute('aria-selected', String(b.dataset.scope === state.scope));
  }
}

let isLoading = false;

/** Turns whatever a source produced into what the page shows.

    A whole-payload source calls this once. A progressive source calls it once
    per arriving piece, against an accumulator, so every field has to tolerate
    not having arrived yet. Nothing is rendered before the events do: they are
    the one piece the page cannot honestly draw without. */
function applyPayload(payload) {
  if (!payload.events) return;
  state.data = payload;

  state.events = payload.events
    .map((e) => {
      const date = new Date(e.t);
      return { date, day: dayKey(date), sceneId: String(e.s) };
    })
    .sort((a, b) => a.date - b.date);
  state.views = (payload.views ?? []).slice().sort((a, b) => a - b);
  // Entrance animations are keyed by this, so new data replays them once.
  state.dataVersion = `${payload.events.length}:${payload.events.at(-1)?.t ?? 0}`;

  byId('od-source-line').textContent = `${payload.events.length} O entries · ${sourceCaption(payload)}`;
  state.loadedAt = new Date(payload.generated_at);
  updateFreshness();
  render();
}

/** Each source names itself in the footer — "live from Stash", "demo data" —
    because the user should be able to tell at a glance which one they are
    looking at. The fallback covers a payload that forgot to say. */
function sourceCaption(payload) {
  if (payload.source_caption) return payload.source_caption;
  return `${payload.db_name} (read-only snapshot, `
    + `updated ${new Date(payload.db_mtime).toLocaleString()})`;
}

/** The refresh cycle: ask the source, show the answer.
    Holds the busy state briefly so a fast reply still reads as "it did something". */
async function load(force = false) {
  if (isLoading) return;
  isLoading = true;
  const main = byId('od-main');
  const btn = byId('od-refresh-btn');
  main.classList.add('od-loading'); // hold the previous render, no skeleton flash
  btn.dataset.busy = 'true';
  btn.disabled = true;
  byId('od-refresh-label').textContent = 'Refreshing…';
  const startedAt = performance.now();
  try {
    // Per-load accumulator: partials merge into it, so a key that arrives in
    // one load can never linger into the next.
    let acc = {};
    const apply = (part) => { acc = { ...acc, ...part }; applyPayload(acc); };
    apply(await dataSource.getPayload(force, apply));
  } catch (err) {
    // "the database" was accurate when a snapshot was the source. It is not
    // any more, and the message is the only thing the user sees when a
    // connection fails — it should name what actually failed.
    byId('od-source-line').textContent = `Could not read from Stash: ${err.message}`;
  } finally {
    // A local read finishes in ~30ms; without a floor the spinner is a flicker
    // that reads as "nothing happened".
    const held = Math.max(0, 320 - (performance.now() - startedAt));
    setTimeout(() => {
      main.classList.remove('od-loading');
      byId('od-refresh-btn').dataset.busy = 'false';
      byId('od-refresh-btn').disabled = false;
      byId('od-refresh-label').textContent = 'Refresh';
      isLoading = false;
    }, held);
  }
}

/** Keeps the reader aware these numbers are a snapshot, not a live feed. */
function updateFreshness() {
  if (!state.loadedAt) return;
  const secs = Math.max(0, Math.round((Date.now() - state.loadedAt) / 1000));
  const ago = secs < 45 ? 'just now'
    : secs < 5400 ? `${Math.round(secs / 60)} min ago`
    : `${Math.round(secs / 3600)} h ago`;
  // Not "from Stash": in demo mode nothing was read from Stash, and this line
  // sits directly under a caption that says so.
  byId('od-footer-line').textContent = `Read ${ago} `
    + `(${state.loadedAt.toLocaleTimeString()}) · refreshes only on load or when you ask · `
    + `timestamps converted from UTC to ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}
setInterval(updateFreshness, 30000);

/** Changes the zoom level without losing your place in time. */
function setGranularity(gran) {
  if (gran === state.gran) return;
  const focus = focusDay(state.gran, state.anchor);
  state.gran = gran;
  state.anchor = periodStart(gran, focus);
  const current = periodStart(gran, new Date());
  if (state.anchor > current) state.anchor = current; // never open a future period
  syncControls();
  render();
}

/** Window/document listeners survive a remount; element ones do not. */
let globalsBound = false;

/** Connects every control to the state it changes.
    Window-level listeners are attached once, since the route can remount. */
function bindControls() {
  byId('od-granularity').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (btn) setGranularity(btn.dataset.gran);
  });

  byId('od-scope').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn) return;
    state.scope = btn.dataset.scope;
    syncControls();
    render();
  });

  byId('od-prev-btn').addEventListener('click', () => stepPeriod(-1));
  byId('od-next-btn').addEventListener('click', () => stepPeriod(1));
  byId('od-today-btn').addEventListener('click', () => {
    state.anchor = periodStart(state.gran, new Date());
    render();
  });
  byId('od-refresh-btn').addEventListener('click', () => load(true));
  // No cycleTheme here. bindTheme() already binds this button to open the
  // menu, and binding both meant one tap opened the picker *and* advanced the
  // mode — so choosing a palette in Dark mode kicked you to Auto. A disclosure
  // control should not also mutate the thing it discloses. The button's own
  // tooltip says "t cycles mode", and `t` still does.

  // Element listeners above attach to freshly injected DOM on every mount.
  // These do not — they live on window/document and would stack up.
  if (globalsBound) return;
  globalsBound = true;

  window.addEventListener('keydown', (ev) => {
    if (!dashboardOwnsKeys(ev)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const key = ev.key.toLowerCase();
    if (ev.key === 'ArrowLeft') stepPeriod(-1);
    else if (ev.key === 'ArrowRight') stepPeriod(1);
    else if (key === 'w' || key === 'm' || key === 'y') {
      setGranularity({ w: 'week', m: 'month', y: 'year' }[key]);
    } else if (key === 'r') load(true);
    else if (key === 't') cycleTheme();
    else return;
    ev.preventDefault();
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 120);
  });
}

/** Moves through time, one period per press. */
function stepPeriod(n) {
  const btn = n < 0 ? byId('od-prev-btn') : byId('od-next-btn');
  if (btn.disabled) return;
  state.anchor = shiftPeriod(state.gran, state.anchor, n);
  state.navDir = n; // panels slide in from the side you came from
  render();
}

/* --------------------------------------------------------------------- */
/* theme: mode (auto/light/dark) x light palette (aubade/tokyonight-day)   */
/* --------------------------------------------------------------------- */

const MODES = ['auto', 'light', 'dark'];
const LIGHT_NAMES = {
  aubade: 'Aubade',
  'tokyonight-day': 'TokyoNight Day',
  'spicy-pumpkin': 'Spicy Pumpkin',
};
const DARK_NAMES = { stash: 'Stash', naughty: 'Naughty' };

/** The dark palette was called `dark` before it was named Spicy. Anyone who
    picked it already has that string in localStorage, and an unrecognised value
    would stamp data-theme="dark", which no rule matches any more — every custom
    property would fall back and the dashboard would render unstyled. */
const DARK_ALIASES = { dark: 'naughty', spicy: 'naughty' };
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

const theme = {
  mode: localStorage.getItem('o-dash-mode') || 'auto',
  // TokyoNight Day is the shipped default. Aubade remains available and is
  // unchanged; this only moves which one a fresh install starts on.
  light: (localStorage.getItem('o-dash-light') in LIGHT_NAMES)
    ? localStorage.getItem('o-dash-light') : 'tokyonight-day',
  // Dark used to ship a single palette, so it needed no state at all. It now
  // has two, and the choice persists independently of the light one — picking
  // a dark palette must not disturb the light preference, exactly as mode and
  // palette are already kept independent.
  dark: resolveDarkPalette(localStorage.getItem('o-dash-dark')),
};

/** Keeps a saved preference working after a palette has been renamed. */
function resolveDarkPalette(stored) {
  const name = DARK_ALIASES[stored] ?? stored;
  return name in DARK_NAMES ? name : 'stash';
}

/** Puts the chosen palette into effect everywhere it shows.
    Resolves auto against the OS, stamps the palette on the mount, and syncs
    the picker's own state. */
function applyTheme() {
  const dark = theme.mode === 'dark' || (theme.mode === 'auto' && prefersDark.matches);
  const darkMode = theme.mode === 'dark';
  // Stamped on the mount container, not <html>: Stash themes itself off the
  // document root, and two owners of one attribute is a fight the dashboard
  // would lose silently. styles.css selects palettes off .od-viz-root to match.
  vizRoot().setAttribute('data-theme', dark ? theme.dark : theme.light);

  const activeName = dark ? DARK_NAMES[theme.dark] : LIGHT_NAMES[theme.light];
  byId('od-theme-btn-label').textContent = theme.mode === 'auto' ? 'Auto' : activeName;
  byId('od-theme-note').textContent = theme.mode === 'auto'
    ? `Following the system — currently ${activeName}.`
    : darkMode
      ? 'Stash matches the host UI; Naughty is the standalone palette.'
      : 'Also used in Auto, whenever the system is light.';

  for (const b of document.querySelectorAll('#od-theme-mode button')) {
    b.setAttribute('aria-checked', String(b.dataset.mode === theme.mode));
    b.setAttribute('aria-selected', String(b.dataset.mode === theme.mode));
  }
  // Under Dark the light choices are swapped out for the dark ones rather than
  // leaving the section empty. In Auto the light list still matters: the system
  // can flip to light at any time.
  byId('od-theme-light').hidden = darkMode;
  byId('od-theme-dark').hidden = !darkMode;
  byId('od-palette-label').textContent = theme.mode === 'auto'
    ? 'Light palette (used when light)' : 'Palette';
  byId('od-theme-light').classList.toggle('od-inactive', dark);
  for (const b of document.querySelectorAll('#od-theme-light button')) {
    const chosen = b.dataset.light === theme.light;
    b.setAttribute('aria-checked', String(chosen));
    b.classList.toggle('od-is-active', chosen && !dark);
  }
  for (const b of document.querySelectorAll('#od-theme-dark button')) {
    const chosen = b.dataset.dark === theme.dark;
    b.setAttribute('aria-checked', String(chosen));
    b.classList.toggle('od-is-active', chosen && dark);
  }

  localStorage.setItem('o-dash-mode', theme.mode);
  localStorage.setItem('o-dash-light', theme.light);
  localStorage.setItem('o-dash-dark', theme.dark);
}

/** The T shortcut: steps through auto, light and dark. */
function cycleTheme() {
  theme.mode = MODES[(MODES.indexOf(theme.mode) + 1) % MODES.length];
  applyTheme();
}

/** Shows or hides the palette picker. */
function toggleThemeMenu(open) {
  const menu = byId('od-theme-menu');
  const next = open ?? menu.hidden;
  menu.hidden = !next;
  byId('od-theme-btn').setAttribute('aria-expanded', String(next));
}

let themeGlobalsBound = false;

/** Connects the palette picker to the theme state.
    Document-level listeners are attached once, since the route can remount. */
function bindTheme() {
  byId('od-theme-btn').addEventListener('click', (ev) => { ev.stopPropagation(); toggleThemeMenu(); });
  byId('od-theme-menu').addEventListener('click', (ev) => {
    ev.stopPropagation();
    const btn = ev.target.closest('button');
    if (!btn) return;
    // Mode and palette are independent: picking a palette never overrides the
    // mode you chose, so the two controls can't fight each other.
    if (btn.dataset.mode) theme.mode = btn.dataset.mode;
    if (btn.dataset.light) theme.light = btn.dataset.light;
    if (btn.dataset.dark) theme.dark = btn.dataset.dark;
    applyTheme();
  });
  if (themeGlobalsBound) return;
  themeGlobalsBound = true;

  // Escape is Stash's too — its modals and lightbox all use it. Guarded like
  // the shortcuts above, and additionally a no-op unless our menu is open, so
  // dismissing something of Stash's never reaches in here.
  document.addEventListener('click', () => { if (vizRoot()?.isConnected) toggleThemeMenu(false); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && vizRoot()?.isConnected) toggleThemeMenu(false);
  });
  prefersDark.addEventListener('change', () => { if (theme.mode === 'auto') applyTheme(); });
}

/** Brings the dashboard to life inside a container the caller owns.

    Standalone, that container is <body> and it is already in the document, so
    this runs immediately. In the plugin, app.js is loaded once when Stash
    starts — long before the route exists — and the route component calls this
    with its own div when the user navigates in. Safe to call again on a
    remount: the element listeners attach to freshly injected DOM, and the
    window/document ones guard themselves. */
function mountDashboard(container, options = {}) {
  if (container) setVizRoot(container);
  // Whether we are inside Stash is something only the caller knows — the data
  // source cannot tell, and guessing from the origin would be wrong in the dev
  // harness. The plugin entry passes it explicitly.
  if (options.inApp) inApp = true;
  applyTheme();
  bindTheme();
  readHash();
  renderLegend();
  syncControls();
  bindControls();
  load();
}

window.ODashboard = { mount: mountDashboard, setDataSource };

// Auto-mount only if the shell is already present. It is, standalone; it is
// not when Stash loads this at startup, which is exactly the distinction
// needed — no flag, no configuration.
{
  const existing = document.querySelector('.od-viz-root');
  if (existing) mountDashboard(existing);
}
})();
