#!/bin/sh
# CSS containment check — see tools/leak-check.html for what each arm is for.
#
#     sh tools/leak-check.sh [dev-server-url]
#
# Requires tools/devserve.py running (it proxies Stash's stylesheet), and Stash
# up for the inbound arms. Prints verdicts and property names only.

set -eu
BASE="${1:-http://127.0.0.1:8421}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

arm() {
  "$CHROME" --headless --disable-gpu --no-sandbox --virtual-time-budget=15000 \
    --dump-dom "$BASE/tools/leak-check.html$1" 2>/dev/null \
    | python3 -c '
import sys, re, html, json
m = re.search(r"id=\"report\">(.*?)</pre>", sys.stdin.read(), re.S)
print(html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else "{}")
' > "$2"
}

arm "?host=0&ours=0" "$TMP/bare.json"
arm "?host=0&ours=1" "$TMP/ours.json"
arm "?host=1&ours=0" "$TMP/host.json"
arm "?host=1&ours=1" "$TMP/both.json"

python3 - "$TMP" <<'PY'
import json, sys, pathlib
d = pathlib.Path(sys.argv[1])
load = lambda n: json.loads((d / n).read_text() or "{}")
bare, ours, host, both = load("bare.json"), load("ours.json"), load("host.json"), load("both.json")

fails = []

def diff_host(a, b, label):
    """Host elements must measure the same with and without our stylesheet."""
    changed = []
    for el, props in a.get("host", {}).items():
        for prop, val in props.items():
            other = b.get("host", {}).get(el, {}).get(prop)
            if other != val:
                changed.append(f"{el}.{prop}")
    ok = not changed
    print(f"{'PASS' if ok else 'FAIL'}  outbound, {label}: host elements unchanged by styles.css")
    if changed:
        print("        changed:", ", ".join(sorted(set(changed))[:12]))
        fails.append(label)

# Sanity: the arms must actually differ in what they loaded, or every
# comparison below is vacuously true.
sanity = [
    ("control arm really has no styles.css", not bare.get("oursLoaded", True)),
    ("treatment arm really has styles.css", ours.get("oursLoaded", False)),
    ("host arms really loaded Stash's bundle", host.get("stashCssLoaded", False) and both.get("stashCssLoaded", False)),
]
for name, ok in sanity:
    print(f"{'PASS' if ok else 'FAIL'}  sanity: {name}")
    if not ok:
        fails.append(name)

diff_host(bare, ours, "without Stash CSS")
diff_host(host, both, "with Stash CSS")

# Inbound: our elements must keep our values once Bootstrap is present.
changed = []
for el, props in ours.get("mount", {}).items():
    for prop, val in props.items():
        other = both.get("mount", {}).get(el, {}).get(prop)
        if other != val:
            changed.append(f"{el}.{prop}: {val} -> {other}")
ok = not changed
print(f"{'PASS' if ok else 'FAIL'}  inbound: our elements unchanged by Stash's stylesheet")
if changed:
    print("        changed:", "; ".join(sorted(changed)[:12]))
    fails.append("inbound")

print()
print("LEAK CHECK: PASS" if not fails else f"LEAK CHECK: FAIL ({len(fails)})")
sys.exit(1 if fails else 0)
PY
