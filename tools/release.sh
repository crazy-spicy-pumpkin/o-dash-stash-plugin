#!/bin/sh
# Cut a release: tag the manifest's version and let CI publish it.
#
# ROLE. Publishing is deliberate rather than incidental. Pushing to main no
# longer changes what anyone installs — only a tag does — so this is the single
# place a release begins. It exists mostly to refuse: a dirty tree, a version
# already released, or failing checks all stop here rather than reaching people
# who have the plugin installed.
#
#     sh tools/release.sh            # tag the current version and push
#     SKIP_CHECKS=1 sh tools/release.sh
#
# The manifest is the source of truth for the version; the tag mirrors it, and
# the workflow refuses to publish if the two ever disagree. So the order is
# always: bump.sh, commit, release.sh.

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$REPO"

VERSION=$(sed -n 's/^version: *//p' o-dashboard.yml | head -1)
[ -n "$VERSION" ] || { echo "no version in o-dashboard.yml" >&2; exit 1; }
TAG="v$VERSION"

# A tag names a commit, so anything uncommitted is not in the release however
# much it looks like it is.
[ -z "$(git status --porcelain)" ] || {
  echo "working tree is dirty — commit or stash first:" >&2
  git status --short >&2
  exit 1
}

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = "main" ] || {
  echo "on '$branch', not main — releasing from a side branch publishes it to everyone" >&2
  exit 1
}

# Reusing a tag is the one mistake with no clean recovery: anyone who already
# fetched it keeps the old commit, and the published sha256 stops matching what
# the tag says. Bump instead.
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "$TAG already exists — bump before releasing again:" >&2
  echo "    sh tools/bump.sh patch" >&2
  exit 1
fi

if [ "${SKIP_CHECKS:-0}" = "1" ]; then
  echo "skipping checks at your request"
else
  echo "running checks..."
  sh tools/check.sh >/dev/null 2>&1 || { echo "checks failed — run: sh tools/check.sh" >&2; exit 1; }
  echo "checks pass"
fi

# Push the commits before the tag. A tag that arrives first points at a commit
# the remote does not have yet, and the workflow checks out nothing.
git push origin "$branch"
git tag -a "$TAG" -m "O Dashboard $VERSION"
git push origin "$TAG"

echo
echo "released $TAG — the publish workflow builds and deploys from the tag."
echo "watch it:  gh run watch"
