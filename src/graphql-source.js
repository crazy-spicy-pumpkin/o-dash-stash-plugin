/* O Dashboard — the live data source.

   ROLE. The only file that talks to Stash. It answers one question for the
   dashboard — "what happened, and to which scenes" — and everything about how
   Stash exposes that stays behind this boundary.

   One direction: Stash's GraphQL response in, the payload app.js renders from
   out. "The payload" is the contract defined at the top of app.js — this file
   never invents fields, it only reshapes what Stash returns into it.

   Load this BEFORE app.js: app.js starts its first load as it is parsed, and
   picks up whichever source has already published itself.

   Three queries, numbered Q1..Q3 throughout this file, the README and the flow
   diagram:

     Q1  scenes with O history, plus their metadata  ->  events + scenes
     Q2  scenes with view history                    ->  views
     Q3  library totals and the Stash version        ->  the all-time denominator

   They are issued together and delivered as each lands, because they are not
   equally useful: Q1 alone feeds the hero number, the calendar, the patterns
   and every ranked list, while Q2 feeds one comparison series and Q3 one
   denominator. Waiting for all three would hold first paint on the largest
   response for no benefit. */

(() => {
  /* ---------------------------------------------------------------- config

     Two deployments, one code path:

     In the plugin, Stash is the origin. `/graphql` is same-origin, the session
     cookie rides along, and there is nothing to configure — if you are looking
     at the page you are already logged in.

     Standalone, the page is served from somewhere else and must be told where
     Stash is. Cross-origin auth cannot use the cookie: Stash answers with
     `Access-Control-Allow-Origin: *`, and the fetch spec forbids credentials
     against a wildcard. It does allow an ApiKey header — its preflight
     advertises `Access-Control-Allow-Headers: Content-Type, Apikey`, checked
     against the running server, not assumed — so that is the standalone path.

     Settings come from, in order: an explicit global, the query string, then
     localStorage. Query parameters are a one-time hand-off: they are persisted
     and can then be dropped from the URL.

     A key in localStorage is a real trade-off worth stating plainly. It grants
     full access to Stash, and anything on that origin can read it; a key passed
     in a URL also lands in browser history and any proxy log in between. That
     is acceptable for a personal tool on a machine you control and not much
     else. Same-origin — the plugin — needs no key at all, which is the better
     answer whenever it is available. */

  const STORED_STASH_URL = 'o-dash-stash-url';
  const STORED_API_KEY = 'o-dash-api-key';

  /** Answers "which Stash, and are we allowed to ask it".
      This is the only thing that differs between running inside Stash and standalone.
      Order: an explicit global, then the query string, then what was stored earlier. */
  function connection() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('stash')) {
      localStorage.setItem(STORED_STASH_URL, params.get('stash').trim().replace(/\/+$/, ''));
    }
    if (params.has('key')) localStorage.setItem(STORED_API_KEY, params.get('key').trim());
    return {
      base: (window.OD_STASH_URL ?? localStorage.getItem(STORED_STASH_URL) ?? '').replace(/\/+$/, ''),
      apiKey: localStorage.getItem(STORED_API_KEY) || '',
    };
  }

  /** The single door to Stash — every query goes through here.
      Which is why failures are explained in one place, in words a user can act on. */
  async function runQuery(query) {
    const { base, apiKey } = connection();
    const endpoint = window.STASH_GRAPHQL_ENDPOINT || (base ? `${base}/graphql` : '/graphql');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.ApiKey = apiKey;

    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers,
        // Sends the session cookie same-origin, and is ignored cross-origin,
        // which is exactly the behaviour wanted in both deployments.
        credentials: 'same-origin',
        body: JSON.stringify({ query }),
      });
    } catch (err) {
      // A cross-origin failure surfaces as an opaque TypeError, so say what is
      // most likely rather than repeating the browser's non-explanation.
      throw new Error(base
        ? `cannot reach Stash at ${base} — is it running, and is the URL right?`
        : 'cannot reach Stash. Serving this page standalone? '
          + 'Append ?stash=http://your-stash:9999 to the URL.');
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error(apiKey
        ? 'Stash rejected the API key. Generate a new one in '
          + 'Settings → Security → Authentication and pass it as ?key=…'
        : 'Stash requires authentication. Create an API key in '
          + 'Settings → Security → Authentication and append ?key=… to this URL.');
    }
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

    const body = await res.json();
    // Report that it failed, never what it contained.
    if (body.errors?.length) throw new Error(`GraphQL: ${body.errors[0].message}`);
    return body.data;
  }

  /* Q1 — scenes with any O history, plus the metadata the ranked lists need.
     Filtering on o_counter > 0 is what keeps this to the scenes that actually
     have history, rather than the whole library. */
  const Q1_O_HISTORY = `
    query {
      findScenes(
        filter: { per_page: -1 }
        scene_filter: { o_counter: { value: 0, modifier: GREATER_THAN } }
      ) {
        scenes {
          id title date rating100
          files { basename }
          studio { id name }
          performers { id name }
          tags { id name }
          o_history
        }
      }
    }`;

  /* Q2 — view events. Two fields only; it is still the largest response, and
     the half that grows with the library rather than with activity. */
  const Q2_PLAY_HISTORY = `
    query {
      findScenes(
        filter: { per_page: -1 }
        scene_filter: { play_count: { value: 0, modifier: GREATER_THAN } }
      ) { scenes { id play_history } }
    }`;

  /* Q3 — the whole library's scene count, for the "x of y" denominator, and the
     version, which names the source in the footer. Tiny, and the only query
     here that does not scale with anything. */
  const Q3_STATS = `query { stats { scene_count } version { version } }`;

  /** Sort names by code unit, not locale. Intl collation orders accented names
      differently per locale, which would make the same library produce different
      ranked lists on different machines. */
  const byNameBinary = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  /** GraphQL IDs are strings. Coerce to numbers so ids are one type throughout
      the payload, whichever source produced it. */
  const toNumber = (v) => (v == null ? null : Number(v));

  /** Q1's GraphQL rows -> the payload's `events` and `scenes`.

      Stash returns one row per scene with its o_history nested inside; the
      payload wants the events flat and the scenes keyed by id, so this pivots
      one shape into the other. */
  function eventsAndScenesFrom(data) {
    const scenes = {};
    const events = [];

    for (const s of data.findScenes.scenes) {
      // Title, else the file's basename, else a synthesised label — a scene
      // with no title still has to be nameable in a ranked list.
      const name = s.title || s.files?.[0]?.basename || `Scene ${s.id}`;
      scenes[String(s.id)] = {
        title: name,
        studio: s.studio?.name ?? null,
        studio_id: toNumber(s.studio?.id),
        date: s.date ?? null,
        // rating100 is Stash's 0-100 scale. Nothing renders it today; it is
        // carried so the payload is complete.
        rating: s.rating100 ?? null,
        performers: (s.performers ?? []).map((p) => ({ id: toNumber(p.id), name: p.name }))
          .sort(byNameBinary),
        tags: (s.tags ?? []).map((t) => ({ id: toNumber(t.id), name: t.name }))
          .sort(byNameBinary),
      };

      for (const ts of s.o_history ?? []) {
        // RFC3339 always carries an explicit offset, so Date resolves it to an
        // unambiguous instant. Never slice these strings by hand: an event at
        // 22:15+05:30 is earlier than one at 23:45Z, and string order says the
        // opposite. tools/unit.mjs pins exactly this.
        events.push({ t: Date.parse(ts), s: toNumber(s.id) });
      }
    }

    events.sort((a, b) => a.t - b.t);
    return { events, scenes };
  }

  /** Q2's GraphQL rows -> the payload's `views`.

      Same pivot as Q1, minus the metadata. `view_events` is an extra beyond the
      contract: it keeps which scene each view belongs to, which Stash gives for
      free and the flat `views` array throws away. */
  function viewsFrom(data) {
    const views = [];
    const viewEvents = [];
    for (const s of data.findScenes.scenes) {
      for (const ts of s.play_history ?? []) {
        const t = Date.parse(ts);
        views.push(t);
        // views[] is the flat array the charts consume; view_events keeps the
        // scene each view belongs to, which the API gives for free and a future
        // per-scene view panel would need.
        viewEvents.push({ t, s: toNumber(s.id) });
      }
    }
    return { views, view_events: viewEvents };
  }

  const graphqlSource = {
    /** `force` is accepted and ignored: it existed to bypass the server's 10 s
        snapshot cache, and there is no cache here to bypass. */
    async getPayload(force, onPartial) {
      const base = {
        generated_at: new Date().toISOString(),
        // Empty in the plugin, where links are relative react-router paths.
        // Standalone against a remote Stash it is that Stash's base URL, so
        // deep links still resolve. An empty value is legitimate: it means
        // "no links", which is what demo mode wants.
        stash_url: connection().base,
        source_caption: 'live from Stash',
      };

      const oHistory = runQuery(Q1_O_HISTORY).then(eventsAndScenesFrom);
      const views = runQuery(Q2_PLAY_HISTORY).then(viewsFrom);
      const stats = runQuery(Q3_STATS).then((d) => ({
        library_scenes: d.stats.scene_count,
        source_caption: `live from Stash ${d.version.version} · no snapshot`,
      }));

      // Deliver each as it resolves. load() merges into a per-load accumulator
      // and holds the render until the events are in, so these can land in any
      // order without the page ever drawing a half-true number.
      if (onPartial) {
        oHistory.then((p) => onPartial({ ...base, ...p }));
        views.then(onPartial);
        stats.then(onPartial);
      }

      const [o, v, s] = await Promise.all([oHistory, views, stats]);
      return { ...base, ...o, ...v, ...s };
    },
  };

  /* Published, not installed. app.js picks this up itself when it initialises
     (`window.graphqlSource ?? …`), which works in both environments.

     The obvious `if (typeof setDataSource === 'function') setDataSource(...)`
     is a trap here. Standalone, these are two <script> tags and the guard
     correctly reports "app.js hasn't loaded yet". Stash concatenates every
     ui.javascript entry into ONE script served at /plugin/{id}/javascript — so
     app.js's function declarations are hoisted across the whole file, the
     guard passes, and assigning to a `let` declared further down throws
     "Cannot access 'dataSource' before initialization". The plugin then loads
     no dashboard at all.

     setDataSource stays exported on window.ODashboard for an explicit swap
     after startup, which is the case it is actually good for. */
  window.graphqlSource = graphqlSource;
})();
