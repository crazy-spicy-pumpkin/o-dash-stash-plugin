#!/bin/sh
# Run every check. Exits non-zero if any of them fail.
#
#     sh tools/check.sh
#
# Starts its own dev server on a spare port and stops it again, so it leaves
# nothing running. Needs node and Chrome; needs Stash only for the arms that
# say so, and skips those cleanly when it is not up.

set -u

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="${PORT:-8431}"
BASE="http://127.0.0.1:$PORT"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
FAILED=0
SKIPPED=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILED=$((FAILED + 1)); }
skip() { printf '  SKIP  %s — %s\n' "$1" "$2"; SKIPPED=$((SKIPPED + 1)); }

# --- prerequisites --------------------------------------------------------
command -v node >/dev/null || { echo "node is required" >&2; exit 2; }
[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=)" >&2; exit 2; }

# --- dev server, ours to start and ours to stop ---------------------------
python3 "$REPO/tools/devserve.py" --port "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null; }
trap cleanup EXIT INT TERM

i=0
while [ $i -lt 30 ]; do
  curl -s -o /dev/null --max-time 1 "$BASE/src/index.html" && break
  i=$((i + 1)); sleep 0.2
done

# --- syntax ---------------------------------------------------------------
echo
echo "syntax"
for f in "$REPO"/src/*.js; do
  if node --check "$f" 2>/dev/null; then pass "$(basename "$f")"; else fail "$(basename "$f")"; fi
done
for f in "$REPO"/tools/*.sh; do
  if sh -n "$f" 2>/dev/null; then pass "$(basename "$f")"; else fail "$(basename "$f")"; fi
done
if python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "$REPO/tools/devserve.py" 2>/dev/null \
   && python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "$REPO/docs/diagrams.py" 2>/dev/null; then
  pass "python sources"
else
  fail "python sources"
fi

# --- unit tests -----------------------------------------------------------
echo
echo "unit"
if node "$REPO/tools/unit.mjs" >/tmp/od-unit.$$ 2>&1; then
  pass "$(tail -1 /tmp/od-unit.$$)"
else
  fail "unit tests"; sed 's/^/        /' /tmp/od-unit.$$ | grep -E 'FAIL|UNIT'
fi
rm -f /tmp/od-unit.$$

# --- browser checks -------------------------------------------------------
# Each page prints a verdict line ending in PASS or FAIL; the exit status of
# the browser tells us nothing, so the verdict is what we match on.
verdict() { # <url> <container-id> <label>
  out=$("$CHROME" --headless --disable-gpu --no-sandbox --virtual-time-budget=20000 \
        --dump-dom "$1" 2>/dev/null | python3 -c "
import sys, re, html
m = re.search(r'id=\"$2\">(.*?)</pre>', sys.stdin.read(), re.S)
t = html.unescape(re.sub(r'<[^>]+>', '', m.group(1))).strip() if m else ''
print(t.splitlines()[-1] if t else 'NO OUTPUT')
")
  case "$out" in
    *PASS*) pass "$3" ;;
    *) fail "$3 — $out" ;;
  esac
}

echo
echo "browser"
verdict "$BASE/tools/style-check.html" "report" "style: marks are actually styled"
verdict "$BASE/tools/theme-check.html" "out" "theme: defaults, switching, persistence"
verdict "$BASE/tools/theme-check.html?upgrade=dark" "out" "theme: migrates a stored 'dark'"
verdict "$BASE/tools/theme-check.html?upgrade=spicy" "out" "theme: migrates a stored 'spicy'"

# leak-check needs Stash's stylesheet for its inbound arm
if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:9999/"; then
  if sh "$REPO/tools/leak-check.sh" "$BASE" >/tmp/od-leak.$$ 2>&1; then
    pass "css containment, both directions"
  else
    fail "css containment"; grep FAIL /tmp/od-leak.$$ | sed 's/^/        /'
  fi
  rm -f /tmp/od-leak.$$
else
  skip "css containment" "Stash not running; the inbound arm needs its stylesheet"
fi

# --- demo mode renders ----------------------------------------------------
echo
echo "demo"
dom=$("$CHROME" --headless --disable-gpu --no-sandbox --virtual-time-budget=15000 \
      --dump-dom "$BASE/src/index.html?demo=1" 2>/dev/null)
case "$dom" in
  *od-band-wash*) pass "renders synthetic data with styled charts" ;;
  *) fail "demo mode did not render" ;;
esac
case "$dom" in
  *"demo data (synthetic)"*) pass "says plainly that no library was read" ;;
  *) fail "demo caption missing" ;;
esac

# --- packaging ------------------------------------------------------------
echo
echo "packaging"
if sh "$REPO/tools/package.sh" >/dev/null 2>&1; then
  pass "package builds"
  if grep -q "^  sha256: [0-9a-f]\{64\}$" "$REPO/dist/index.yml"; then
    pass "index.yml carries a sha256"
  else
    fail "index.yml sha256 malformed"
  fi
else
  fail "package build"
fi

# --- verdict --------------------------------------------------------------
echo
if [ "$FAILED" -eq 0 ]; then
  printf 'CHECKS: PASS'
  [ "$SKIPPED" -gt 0 ] && printf ' (%d skipped)' "$SKIPPED"
  echo
  exit 0
fi
echo "CHECKS: FAIL ($FAILED)"
exit 1
