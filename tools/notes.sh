#!/bin/sh
# Print one version's section from CHANGELOG.md.
#
# ROLE. Release notes exist in three places — the git tag, the GitHub Release
# page, and the repo — and three hand-maintained copies disagree within one
# release. This makes CHANGELOG.md the only copy and lets the others read from
# it.
#
#     sh tools/notes.sh 0.1.0
#
# Exits non-zero when there is no section for that version, so a caller can
# refuse to release rather than publish an empty description.

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
VERSION="${1:?usage: notes.sh <version>}"

notes=$(awk -v v="$VERSION" '
  $0 ~ "^## " v "([ ]|$)" { on = 1; next }
  on && /^## / { exit }
  on { print }
' "$REPO/CHANGELOG.md" | sed '/./,$!d')

[ -n "$notes" ] || {
  echo "CHANGELOG.md has no '## $VERSION' section" >&2
  exit 1
}

printf '%s\n' "$notes"
