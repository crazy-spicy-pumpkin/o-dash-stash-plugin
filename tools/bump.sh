#!/bin/sh
# Move the version forward by one step.
#
# ROLE. The version is the only thing that makes an update visible to people
# who already installed, so it gets edited often — and editing it by hand in
# YAML is how a version ends up malformed, duplicated, or accidentally moving
# backwards. This makes the bump a single command with one obvious argument.
#
#     sh tools/bump.sh [patch|minor|major]      # default: patch
#
# Which step to take is a judgement about the change, not something a tool can
# infer, which is why this is run deliberately rather than wired into CI:
#   patch  a fix or a wording change; nothing about using it is different
#   minor  a new panel, control or theme; existing behaviour still stands
#   major  saved state, the payload shape or the manifest id changed

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
MANIFEST="$REPO/o-dashboard.yml"
PART="${1:-patch}"

current=$(sed -n 's/^version: *//p' "$MANIFEST" | head -1)
[ -n "$current" ] || { echo "no version in o-dashboard.yml" >&2; exit 1; }

case "$current" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "version '$current' is not major.minor.patch" >&2; exit 1 ;;
esac

major=${current%%.*}
rest=${current#*.}
minor=${rest%%.*}
patch=${rest#*.}

case "$PART" in
  major) major=$((major + 1)); minor=0; patch=0 ;;
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
  *) echo "usage: bump.sh [patch|minor|major]" >&2; exit 1 ;;
esac

next="$major.$minor.$patch"

# Rewrite through a temp file so a failure mid-write cannot leave the manifest
# without a version — the one field every install path reads.
tmp="$MANIFEST.tmp.$$"
sed "s/^version: .*/version: $next/" "$MANIFEST" > "$tmp"
grep -q "^version: $next$" "$tmp" || { rm -f "$tmp"; echo "rewrite failed" >&2; exit 1; }
mv "$tmp" "$MANIFEST"

echo "$current -> $next"
echo "commit this together with the change it covers."
