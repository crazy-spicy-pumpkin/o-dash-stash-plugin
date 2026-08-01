#!/bin/sh
# Build an installable plugin package plus the index a Stash plugin source
# serves.
#
#     sh tools/package.sh [outdir]      # default: dist/
#
# Produces:
#     dist/o-dashboard.zip   the plugin — manifest + src/, nothing else
#     dist/index.yml         the package index Stash reads
#
# Anyone can then install it without touching a filesystem:
#   Settings -> Plugins -> Available Plugins -> Add Source -> <url>/index.yml
#   then tick O Dashboard and Install.
#
# The zip is also a valid manual install on its own: unzip it into the Stash
# config's plugins/ directory.

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="${1:-$REPO/dist}"
ID=o-dashboard
STAGE="$OUT/.stage/$ID"

VERSION=$(sed -n 's/^version: *//p' "$REPO/$ID.yml" | head -1)
[ -n "$VERSION" ] || { echo "no version in $ID.yml" >&2; exit 1; }

rm -rf "$OUT/.stage"
mkdir -p "$STAGE/src" "$OUT"

# Resolve to an absolute path: the zip is created from inside the staging
# directory, so a relative outdir would land the archive under it.
OUT=$(cd "$OUT" && pwd)
STAGE="$OUT/.stage/$ID"

# The list lives in shipped.sh because version-check.sh has to agree with it.
. "$REPO/tools/shipped.sh"
for f in $(shipped_files); do
  cp "$REPO/$f" "$STAGE/$f"
done

# Zip the plugin's *contents*, with no wrapping directory. Stash unpacks a
# package into plugins/<id>/ itself, so a wrapper here lands the files at
# plugins/<id>/<id>/ and the plugin does not load. Verified by installing from
# a served index, not by reading the docs.
# zip appends to an existing archive, so a rebuild would otherwise carry every
# previous layout along with the current one.
rm -f "$OUT/$ID.zip"
(cd "$STAGE" && zip -qr "$OUT/$ID.zip" .)
rm -rf "$OUT/.stage"

SHA=$(shasum -a 256 "$OUT/$ID.zip" | cut -d' ' -f1)
DATE=$(date -u +"%Y-%m-%d %H:%M:%S")

cat > "$OUT/index.yml" <<EOF
- id: $ID
  name: O Dashboard
  version: $VERSION
  date: $DATE
  path: $ID.zip
  sha256: $SHA
  requires: []
  metadata:
    description: >-
      A dashboard over your Stash O-count history — daily counts, a calendar,
      time-of-day and day-of-week patterns, and ranked scenes, performers and
      tags. Reads through Stash's own GraphQL API; no database access, no
      second server, and no write path.
EOF

# A landing page at the site root. Without one the published URL is a 404,
# because a plugin source is only ever fetched as index.yml — which is fine for
# Stash and useless for a person who was handed the link. This is the page that
# answers "what do I paste where?".
cat > "$OUT/index.html" <<EOF
<!doctype html>
<meta charset="utf-8">
<title>O Dashboard — a Stash plugin</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  /* The Spicy Pumpkin palette from src/styles.css, with Naughty for dark —
     the same two themes the dashboard itself ships, so the page someone lands
     on looks like the thing they are about to install. */
  :root {
    color-scheme: light dark;
    --surface: #fdf7f0; --plane: #f6ebdf;
    --text: #3c2316; --text-2: #6a5044; --muted: #8e766a;
    --border: rgba(60, 35, 22, .12); --accent: #d2601a; --accent-ink: #994000;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --surface: #1a1a19; --plane: #0d0d0d;
      --text: #ffffff; --text-2: #c3c2b7; --muted: #898781;
      --border: rgba(255, 255, 255, .10); --accent: #e8752a; --accent-ink: #f19d74;
    }
  }
  body { margin: 0; padding: 3rem 1.25rem; background: var(--surface); color: var(--text);
         font: 16px/1.65 system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 44rem; margin: 0 auto }
  .title { display: flex; align-items: center; gap: .6rem }
  .title svg { width: 2rem; height: 2rem; fill: var(--accent); flex: none }
  h1 { font-size: 1.9rem; margin: 0 }
  p.lede { color: var(--text-2); margin: .5rem 0 2rem }
  h2 { font-size: 1.05rem; margin: 2.25rem 0 .6rem; color: var(--accent-ink) }
  code, .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace }
  .copyrow { position: relative; margin: .5rem 0 1rem }
  .url { display: block; background: var(--plane); border: 1px solid var(--border);
         border-radius: .5rem; padding: .8rem 3rem .8rem 1rem;
         word-break: break-all; color: var(--accent-ink); font-size: .95rem }
  /* Sits inside the block, like the one on brew.sh — an affordance, not a slab. */
  .copy { position: absolute; top: .5rem; right: .5rem;
          width: 2rem; height: 2rem; display: grid; place-items: center;
          cursor: pointer; border: 0; border-radius: .375rem;
          background: transparent; color: var(--muted);
          opacity: .75; transition: opacity .15s, color .15s, background .15s }
  .copy:hover { opacity: 1; color: var(--accent); background: var(--border) }
  .copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px }
  .copy svg { width: 1.05rem; height: 1.05rem; fill: none;
              stroke: currentColor; stroke-width: 2;
              stroke-linecap: round; stroke-linejoin: round }
  /* Success wears the accent, not a green borrowed from somewhere else — the
     palette is warm throughout. The tick shape is what says it worked. */
  .copy.ok { color: var(--accent); opacity: 1; background: var(--border) }
  ol { padding-left: 1.2rem } li { margin: .3rem 0 }
  a { color: var(--accent) }
  footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--border);
           color: var(--muted); font-size: .9rem }
</style>
<main>
  <div class="title">
    <!-- the dashboard's own title mark: one path, three placements -->
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path transform="translate(18.1 6.7) rotate(-71) scale(0.971)"
            d="M0-12C2.7-7 5-3.3 5 0a5 5 0 0 1-10 0C-5-3.3-2.7-7 0-12z"/>
      <path transform="translate(4.9 15.8) rotate(-16) scale(0.780)"
            d="M0-12C2.7-7 5-3.3 5 0a5 5 0 0 1-10 0C-5-3.3-2.7-7 0-12z"/>
      <path transform="translate(16.1 18.8) rotate(-28) scale(0.661)"
            d="M0-12C2.7-7 5-3.3 5 0a5 5 0 0 1-10 0C-5-3.3-2.7-7 0-12z"/>
    </svg>
    <h1>O Dashboard</h1>
  </div>
  <p class="lede">A dashboard over your Stash O-count history — daily counts, a
  year calendar, time-of-day and day-of-week patterns, and ranked scenes,
  performers and tags. Version $VERSION.</p>

  <h2>Install</h2>
  <ol>
    <li>In Stash: <strong>Settings → Plugins → Available Plugins → Add Source</strong></li>
    <li>Paste this as the source URL:</li>
  </ol>
  <div class="copyrow">
    <span class="url" id="src-url">https://crazy-spicy-pumpkin.github.io/o-dash-stash-plugin/index.yml</span>
    <button class="copy" id="copy" type="button" aria-label="Copy the source URL" title="Copy">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="9" y="9" width="12" height="12" rx="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
    </button>
  </div>
  <ol start="3">
    <li>Name the source anything; set <strong>Local Path</strong> to <code>o-dashboard</code></li>
    <li>Expand it, tick <strong>O Dashboard</strong>, and click <strong>Install</strong></li>
  </ol>

  <h2>What it reads</h2>
  <p>Stash's own GraphQL API — no database access, no second server, and no
  write path back to Stash.</p>

  <footer>
    <a href="https://github.com/crazy-spicy-pumpkin/o-dash-stash-plugin">Source, screenshots and a code tour on GitHub</a>
    · <a href="$ID.zip">download the zip</a>
    · MIT
  </footer>
</main>
<script>
  // No template literals or backticks in here: this file is written from a
  // shell heredoc, where both would be interpreted before they ever reach the
  // page.
  (function () {
    var button = document.getElementById('copy');
    var source = document.getElementById('src-url');

    var clipboardIcon = button.innerHTML;
    var tickIcon = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
                   '<path d="M20 6L9 17l-5-5"/></svg>';

    // The icon is the whole feedback: a tick for success, and the title
    // attribute carries the wording for the case where it did not work.
    function flash(worked, note) {
      button.innerHTML = worked ? tickIcon : clipboardIcon;
      button.title = note;
      button.setAttribute('aria-label', note);
      button.classList.toggle('ok', worked);
      setTimeout(function () {
        button.innerHTML = clipboardIcon;
        button.title = 'Copy';
        button.setAttribute('aria-label', 'Copy the source URL');
        button.classList.remove('ok');
      }, 1600);
    }

    // The older selection-based copy. Still the only thing that works outside
    // a secure context, and the backstop when the async API is present but
    // refuses — a permissions policy or a browser that wants a stricter
    // gesture will reject rather than throw.
    function legacyCopy(text) {
      var field = document.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      var done = false;
      try {
        done = document.execCommand('copy');
      } catch (e) {
        done = false;
      }
      document.body.removeChild(field);
      return done;
    }

    button.addEventListener('click', function () {
      var text = source.textContent.trim();
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(function () {
          flash(true, 'Copied');
        }, function () {
          var worked = legacyCopy(text);
          flash(worked, worked ? 'Copied' : 'Select it and press Ctrl-C');
        });
        return;
      }
      var worked = legacyCopy(text);
      flash(worked, worked ? 'Copied' : 'Select it and press Ctrl-C');
    });
  })();
</script>
EOF

echo "built $OUT/$ID.zip  ($VERSION)"
echo "      $OUT/index.yml"
echo "      $OUT/index.html"
echo
echo "serve that directory over HTTP and add <url>/index.yml as a plugin source."
