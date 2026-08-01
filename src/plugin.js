/* O Dashboard — the plugin entry point.

   ROLE. Makes the dashboard reachable from inside Stash: a nav item to click
   and a route to land on. It is the only file that knows Stash's UI exists;
   remove it and the rest still runs standalone.

   Registers a route and a nav item. Everything it needs is borrowed from
   Stash's own PluginApi: React is provided, so nothing is bundled, and
   React.createElement means no JSX and therefore no build step.

   The patch semantics below were read out of the v0.31.1 bundle rather than
   assumed. `patch.before(name, fn)` replaces the *argument list*: fn receives
   the props and must return an array of new arguments. Stash's own
   `register.route` is implemented with exactly this call against the
   "PluginRoutes" point, which is the best available confirmation that the
   shape is right. */

(() => {
  const api = window.PluginApi;
  if (!api) return; // loaded outside Stash (the dev harness); nothing to do

  const { React } = api;
  const { NavLink } = api.libraries.ReactRouterDOM;
  const { Nav, Button } = api.libraries.Bootstrap;
  const { faChartLine } = api.libraries.FontAwesomeSolid;
  const Icon = api.components.Icon;

  const PLUGIN_ID = 'o-dashboard';
  const ASSETS = `/plugin/${PLUGIN_ID}/assets`;
  const ROUTE = '/o-dashboard';
  const TITLE = 'O Dashboard';

  /* The directory URL, not `${ASSETS}/src/index.html`. Stash serves plugin
     assets through Go's file server, which redirects any path ending in
     "/index.html" to "./" — and under this mount it builds that redirect
     wrongly, landing on .../assets/src/src/ and 404ing. Requesting the
     directory serves the same file directly. The explicit path is kept as a
     fallback so this keeps working if Stash ever fixes the redirect. */
  const SHELL_URLS = [`${ASSETS}/src/`, `${ASSETS}/src/index.html`];

  /** Proves the response really is the shell and not something served in its
      place. Any id the shell is guaranteed to contain would do. */
  const SHELL_MARKER = 'od-main';

  /** Gets the dashboard's markup from the files Stash is serving. */
  async function fetchShell() {
    let lastError;
    for (const url of SHELL_URLS) {
      try {
        // `cache: 'no-cache'` forces revalidation — one conditional request,
        // and only at mount. Stash sends the JS and CSS bundles with
        // Cache-Control: no-cache but the assets route with neither that nor an
        // ETag, only Last-Modified, so the browser is free to heuristically
        // cache the shell. It does: after an upgrade you get new code driving
        // old markup, which shows up as a feature that is present in every file
        // on disk and absent from the page — a theme missing from the picker
        // was the first symptom.
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) {
          const markup = await res.text();
          // A 200 is not proof we got the shell. With authentication enabled,
          // an expired session turns this into a redirect to the login page,
          // which fetch follows and reports as a perfectly good 200. Injecting
          // that would put Stash's login form inside the dashboard's own div
          // and then mount against markup that has none of its ids.
          if (markup.includes(SHELL_MARKER)) return markup;
          lastError = new Error('not signed in to Stash — sign in and reload');
          continue;
        }
        lastError = new Error(`shell HTTP ${res.status}`);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new Error('shell unreachable');
  }

  let shell = null;

  /** Gives every visit to the route the same markup, fetched once.

    A failure is never cached, so a transient error does not disable the page
    for the rest of the session.

      The markup lives in index.html, which is also the standalone page — one
      source of truth for the layout. Scripts are stripped before it is
      injected: innerHTML would not execute them anyway, and leaving them in
      invites someone to believe otherwise. */
  function loadShell() {
    shell ??= fetchShell()
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        for (const s of doc.body.querySelectorAll('script')) s.remove();
        return doc.body.innerHTML;
      })
      .catch((err) => { shell = null; throw err; }); // don't cache a failure
    return shell;
  }

  /** What Stash renders when someone visits the dashboard's route. */
  function ODashboardRoute() {
    const ref = React.useRef(null);
    const [error, setError] = React.useState(null);

    React.useEffect(() => {
      let cancelled = false;
      loadShell().then((markup) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = markup;
        // inApp switches deep links to root-relative react-router paths, so
        // clicking through to a scene does not reload the whole app.
        window.ODashboard.mount(ref.current, { inApp: true });
      }).catch((err) => { if (!cancelled) setError(err.message); });
      return () => { cancelled = true; };
    }, []);

    if (error) {
      return React.createElement('div', { className: 'od-viz-root', style: { padding: 24 } },
        `${TITLE} could not load: ${error}`);
    }
    return React.createElement('div', { className: 'od-viz-root', ref });
  }

  api.register.route(ROUTE, ODashboardRoute);

  /* Nav entry. The markup mirrors what Stash builds for its own items —
     Nav.Link > NavLink > Button > Icon + span, with the same Bootstrap column
     classes — so the item sits in the row correctly at every breakpoint
     instead of approximately. */
  api.patch.before('MainNavBar.MenuItems', function (props) {
    return [{
      children: React.createElement(
        React.Fragment,
        null,
        props.children,
        React.createElement(
          Nav.Link,
          { eventKey: ROUTE, as: 'div', className: 'col-4 col-sm-3 col-md-2 col-lg-auto' },
          React.createElement(
            NavLink,
            { activeClassName: 'active', exact: true, to: ROUTE },
            React.createElement(
              Button,
              {
                className: 'minimal p-4 p-xl-2 d-flex d-xl-inline-block flex-column '
                  + 'justify-content-between align-items-center',
                title: TITLE,
              },
              React.createElement(Icon, {
                icon: faChartLine,
                className: 'nav-menu-icon d-block d-xl-inline mb-2 mb-xl-0',
              }),
              React.createElement('span', null, TITLE),
            ),
          ),
        ),
      ),
    }];
  });
})();
