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

cp "$REPO/$ID.yml" "$STAGE/"
cp "$REPO/src/app.js" "$REPO/src/graphql-source.js" "$REPO/src/demo-source.js" \
   "$REPO/src/plugin.js" "$REPO/src/styles.css" "$REPO/src/index.html" "$STAGE/src/"

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

echo "built $OUT/$ID.zip  ($VERSION)"
echo "      $OUT/index.yml"
echo
echo "serve that directory over HTTP and add <url>/index.yml as a plugin source."
