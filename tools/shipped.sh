# The files that make up the plugin, named once.
#
# ROLE. Two tools need to agree on exactly what ships: package.sh copies these
# into the archive, and version-check.sh treats a change to any of them as
# something users must be offered an update for. Kept in one place because the
# failure mode of two lists is silent — a file added to the package but not to
# the guard changes what people install without ever bumping the version.
#
# Sourced, not run. Paths are relative to the repo root.

shipped_files() {
  echo o-dashboard.yml
  for name in app.js graphql-source.js demo-source.js plugin.js styles.css index.html; do
    echo "src/$name"
  done
}
