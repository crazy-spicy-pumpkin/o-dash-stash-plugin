/* O Dashboard — the demo data source.

   ROLE. Lets the dashboard be shown, screenshotted and developed against
   **without touching a real library**. Every image in this repo comes from
   here, and it is what makes the project demonstrable to someone who does not
   have Stash running.

   It satisfies the same payload contract as the live source, which is why demo
   mode is a source rather than a flag scattered through the rendering code.

   Nothing here reads the network, a database, or the filesystem. The labels are
   deliberately neutral placeholders: weather, landscape and colour words.
   Nothing explicit, nothing resembling a real person or studio.

   Activate with ?demo=1, or by setting window.OD_DEMO = true before app.js.

   Deterministic: one seed, so the same day produces the same history and a
   screenshot can be reproduced. The RNG is a small local PRNG rather than
   Math.random, which cannot be seeded. */

(() => {
  const SEED = 20260101;
  const MONTHS_OF_HISTORY = 14;

  const STUDIOS = ['Northwind', 'Blue Harbour', 'Meridian', 'Lantern House', 'Fieldnote'];
  const PERFORMERS = ['Aurora', 'Juniper', 'Cassini', 'Marlow', 'Wren', 'Solstice',
    'Halcyon', 'Indigo', 'Pemberley', 'Thistle'];
  const TAGS = ['favourite', 'highlight', 'long', 'short', 'rewatch', 'archive', 'hd', 'classic'];
  const ADJECTIVES = ['Quiet', 'Golden', 'Long', 'Bright', 'Still', 'Distant', 'Soft', 'Late'];
  const NOUNS = ['Morning', 'Harbour', 'Weekend', 'Afternoon', 'Window', 'Meadow', 'Tide', 'Hour'];

  /** Makes the demo reproducible: the same day always yields the same history.
      mulberry32, because Math.random cannot be seeded. */
  function seededRng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      random: next,
      randrange: (lo, hi) => (hi === undefined
        ? Math.floor(next() * lo)
        : lo + Math.floor(next() * (hi - lo))),
      choice: (xs) => xs[Math.floor(next() * xs.length)],
      /** k distinct items, order irrelevant to the caller. */
      sample: (xs, k) => {
        const pool = xs.slice();
        const out = [];
        for (let i = 0; i < k && pool.length; i += 1) {
          out.push(pool.splice(Math.floor(next() * pool.length), 1)[0]);
        }
        return out;
      },
      /** One weighted pick, with replacement. */
      weighted: (xs, weights) => {
        const total = weights.reduce((a2, b) => a2 + b, 0);
        let r = next() * total;
        for (let i = 0; i < xs.length; i += 1) {
          r -= weights[i];
          if (r <= 0) return xs[i];
        }
        return xs[xs.length - 1];
      },
      expovariate: (lambda) => -Math.log(1 - next()) / lambda,
    };
  }

  /** Gives the synthetic history a believable daily rhythm, so the time-of-day
      chart shows a shape instead of noise. */
  function hourlyWeights() {
    const w = new Array(24).fill(0.4);
    const peaks = {
      9: 0.5, 12: 0.6, 14: 0.7, 16: 0.8,
      19: 2.0, 20: 3.0, 21: 4.5, 22: 5.5, 23: 5.0,
      0: 3.5, 1: 2.0, 2: 0.9,
    };
    for (const [h, v] of Object.entries(peaks)) w[Number(h)] = v;
    return w;
  }

  const DAY_MS = 86400000;
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-`
    + `${String(d.getDate()).padStart(2, '0')}`;

  /** Produces a complete, plausible history without touching a real library.
      Catalogue, events, views, and a deliberately non-empty current week. */
  function buildDemoPayload() {
    const rng = seededRng(SEED);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today.getTime() - MONTHS_OF_HISTORY * 30 * DAY_MS);

    // --- the catalogue ---
    const scenes = {};
    for (let i = 1; i <= 40; i += 1) {
      let title = `${rng.choice(ADJECTIVES)} ${rng.choice(NOUNS)}`;
      if (rng.random() < 0.25) title += ` ${rng.randrange(2, 5)}`;
      const studioIdx = rng.randrange(STUDIOS.length);
      const cast = rng.sample(PERFORMERS, rng.choice([1, 1, 1, 2]));
      const tags = rng.sample(TAGS, rng.choice([0, 1, 2, 2, 3]));
      scenes[String(i)] = {
        title,
        studio: STUDIOS[studioIdx],
        studio_id: studioIdx + 1,
        date: isoDate(new Date(start.getTime() + rng.randrange(400) * DAY_MS)),
        rating: rng.choice([null, null, 60, 80, 80, 100]),
        performers: cast.map((name) => ({ id: PERFORMERS.indexOf(name) + 1, name })),
        tags: tags.map((tag) => ({ id: TAGS.indexOf(tag) + 1, name: tag })),
      };
    }

    // A few scenes are clear favourites, so the ranked lists have a shape.
    const ids = Object.keys(scenes);
    const idWeights = ids.map((_, i) => (i < 3 ? 8.0 : i < 9 ? 3.0 : 1.0));

    // --- the history ---
    const hours = hourlyWeights();
    const hourChoices = Array.from({ length: 24 }, (_, i) => i);

    // One quiet stretch, so "longest gap" is interesting rather than uniform.
    const gapStart = start.getTime() + rng.randrange(120, 240) * DAY_MS;
    const gapEnd = gapStart + rng.randrange(18, 30) * DAY_MS;

    const events = [];
    const views = [];
    const momentOn = (day, hour) => new Date(day.getFullYear(), day.getMonth(), day.getDate(),
      hour, rng.randrange(60), rng.randrange(60)).getTime();

    for (let day = new Date(start); day <= today; day = new Date(day.getTime() + DAY_MS)) {
      const weekend = day.getDay() === 0 || day.getDay() === 6;
      const quiet = day.getTime() >= gapStart && day.getTime() < gapEnd;
      const chance = quiet ? 0.02 : weekend ? 0.34 : 0.22;
      const viewRate = quiet ? 0.3 : weekend ? 2.2 : 1.4;

      let count = 0;
      if (rng.random() < chance) count = rng.random() > 0.18 ? 1 : 2;
      for (let i = 0; i < count; i += 1) {
        const when = momentOn(day, rng.weighted(hourChoices, hours));
        if (when > now.getTime()) continue;
        events.push({ t: when, s: Number(rng.weighted(ids, idWeights)) });
      }

      // Views outnumber O events severalfold, which is what makes the
      // "scenes watched" comparison meaningful.
      const viewCount = Math.floor(rng.expovariate(1 / viewRate));
      for (let i = 0; i < viewCount; i += 1) {
        const when = momentOn(day, rng.weighted(hourChoices, hours));
        if (when <= now.getTime()) views.push(when);
      }
    }

    // The dashboard opens on the current week, so make sure it has something in
    // it — otherwise the first thing anyone sees is an empty chart.
    const weekStart = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY_MS);
    let recent = events.filter((e) => e.t >= weekStart.getTime()).length;
    const daysIn = Math.round((today - weekStart) / DAY_MS);
    for (const offset of rng.sample(Array.from({ length: daysIn + 1 }, (_, i) => i), daysIn + 1)) {
      if (recent >= 3) break;
      const day = new Date(weekStart.getTime() + offset * DAY_MS);
      const when = momentOn(day, rng.choice([20, 21, 22, 23]));
      if (when > now.getTime()) continue;
      events.push({ t: when, s: Number(rng.weighted(ids, idWeights)) });
      recent += 1;
      for (let i = 0; i < 2; i += 1) views.push(when - rng.randrange(600, 5400) * 1000);
    }

    events.sort((a, b) => a.t - b.t);
    views.sort((a, b) => a - b);

    return {
      generated_at: now.toISOString(),
      source_caption: 'demo data (synthetic) · no library was read',
      library_scenes: 420,
      // No deep links in demo mode: the ids are invented, so they would point
      // at the wrong scenes in a real Stash.
      stash_url: '',
      events,
      views,
      scenes,
    };
  }

  const demoSource = {
    /** Whole payload in one go — there is no network to be progressive about. */
      async getPayload() {
      return buildDemoPayload();
    },
  };

  // Always published, so tests and tools can build a payload without asking
  // the dashboard to use one.
  window.demoSource = demoSource;

  // Only when actually asked for. odSourceOverride is the slot app.js checks
  // first — this is what makes ?demo=1 win over the live source, and what keeps
  // this file inert the rest of the time.
  const wanted = window.OD_DEMO === true
    || new URLSearchParams(window.location.search).get('demo') === '1';
  if (wanted) window.odSourceOverride = demoSource;
})();
