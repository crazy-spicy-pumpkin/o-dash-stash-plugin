#!/bin/sh
# Refuse a change that users would never be offered.
#
# ROLE. Stash decides whether an update exists by comparing version strings,
# not file contents. So a commit that edits a shipped file without bumping the
# version ships to nobody: Stash sees 0.1.0 installed and 0.1.0 published and
# does nothing. There is no error anywhere — the fix simply never arrives. This
# check turns that silence into a failure at the moment the change is made.
#
#     sh tools/version-check.sh
#
# Compares the working tree against HEAD, so it describes the commit you are
# about to make. On a clean tree there is nothing to judge and it passes.

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$REPO/tools/shipped.sh"
MANIFEST="$REPO/o-dashboard.yml"

cd "$REPO"
git rev-parse --verify HEAD >/dev/null 2>&1 || { echo "no HEAD yet — nothing to compare"; exit 0; }

# Staged and unstaged together: what a commit -a would capture.
changed=$(git diff HEAD --name-only)

touched=""
for f in $(shipped_files); do
  case "
$changed" in *"
$f"*) touched="$touched $f" ;; esac
done

[ -n "$touched" ] || { echo "no shipped files changed"; exit 0; }

version_now=$(sed -n 's/^version: *//p' "$MANIFEST" | head -1)
version_head=$(git show HEAD:o-dashboard.yml | sed -n 's/^version: *//p' | head -1)

if [ "$version_now" = "$version_head" ]; then
  echo "shipped files changed but version is still $version_now:"
  for f in $touched; do echo "    $f"; done
  echo
  echo "  Stash compares versions, so this would reach nobody who already"
  echo "  installed. Bump it:  sh tools/bump.sh patch"
  exit 1
fi

# A bump that goes backwards is worse than none: Stash will not offer an
# update, and a fresh install gets a version lower than one already out there.
older=$(printf '%s\n%s\n' "$version_now" "$version_head" | sort -V | head -1)
if [ "$version_now" != "$version_head" ] && [ "$older" = "$version_now" ]; then
  echo "version went backwards: $version_head -> $version_now"
  exit 1
fi

echo "version $version_head -> $version_now covers$touched"
