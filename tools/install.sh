#!/bin/sh
# Copy the plugin into a Stash config directory.
#
#     sh tools/install.sh /path/to/stash/config      # explicit
#     STASH_CONFIG_DIR=... sh tools/install.sh       # or from the environment
#
# Defaults to ~/.stash, which is where Stash keeps its config on unix when it
# has not been told otherwise. No real path is committed to this repo; pass it
# in. If Stash runs in Docker, this must be the directory mounted at the
# container's /root/.stash — the container cannot follow a symlink out of it,
# which is why this copies rather than links, and why it has to be re-run after
# every edit.
#
# Afterwards: Settings -> Plugins -> Reload plugins, then enable "O Dashboard".

set -eu

CONFIG_DIR="${1:-${STASH_CONFIG_DIR:-$HOME/.stash}}"
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST="$CONFIG_DIR/plugins/o-dashboard"

if [ ! -d "$CONFIG_DIR" ]; then
  echo "not a directory: \$CONFIG_DIR" >&2
  echo "pass the Stash config directory as the first argument." >&2
  exit 1
fi

mkdir -p "$DEST/src"
cp "$REPO/o-dashboard.yml" "$DEST/"
cp "$REPO/src/app.js" "$REPO/src/graphql-source.js" "$REPO/src/demo-source.js" \
   "$REPO/src/plugin.js" "$REPO/src/styles.css" "$REPO/src/index.html" "$DEST/src/"

# Deliberately not copied: tools/ (dev harness), CLAUDE.md, .git.
# The plugin is the manifest plus src/, and nothing else.

echo "installed: o-dashboard.yml + src/ (6 files)"
echo "next: Settings -> Plugins -> Reload plugins, then enable \"O Dashboard\""
