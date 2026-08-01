#!/bin/sh
# Query timings — measured from the shell, deliberately.
#
# The verification page runs under headless Chrome's --virtual-time-budget,
# which advances the clock artificially and makes performance.now() a fiction;
# that has produced a false reading here before.
# curl's own timer is real, so timings live here and correctness lives there.
#
#     sh tools/measure.sh [stash-url]
#
# Prints milliseconds and ratios only. Never a row, and never a count.

set -eu
STASH="${1:-http://127.0.0.1:9999}"
RUNS=5

Q_O='query { findScenes(filter: {per_page: -1}, scene_filter: {o_counter: {value: 0, modifier: GREATER_THAN}}) { scenes { id title date rating100 files { basename } studio { id name } performers { id name } tags { id name } o_history } } }'
Q_V='query { findScenes(filter: {per_page: -1}, scene_filter: {play_count: {value: 0, modifier: GREATER_THAN}}) { scenes { id play_history } } }'
Q_S='query { stats { scene_count } version { version } }'

measure() {
  label="$1"; query="$2"
  body=$(printf '%s' "$query" | python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))')
  # One warm-up, then RUNS measured passes; report the median.
  curl -s -o /dev/null -X POST "$STASH/graphql" -H 'Content-Type: application/json' -d "$body"
  times=""
  i=0
  while [ "$i" -lt "$RUNS" ]; do
    t=$(curl -s -o /dev/null -w '%{time_total}' -X POST "$STASH/graphql" \
        -H 'Content-Type: application/json' -d "$body")
    times="$times $t"
    i=$((i + 1))
  done
  size=$(curl -s -o /dev/null -w '%{size_download}' -X POST "$STASH/graphql" \
         -H 'Content-Type: application/json' -d "$body")
  echo "$label|$size|$times"
}

echo "Stash: $STASH  ·  median of $RUNS warm runs"
echo

{
  measure "Q1 o_history + metadata" "$Q_O"
  measure "Q2 play_history        " "$Q_V"
  measure "Q3 stats               " "$Q_S"
} | python3 -c '
import sys
rows = []
for line in sys.stdin:
    label, size, times = line.strip().split("|")
    ts = sorted(float(t) * 1000 for t in times.split())
    rows.append((label, int(size), ts[len(ts) // 2]))
base = rows[0][1]
for label, size, ms in rows:
    print(f"  {label}  {ms:6.1f} ms   payload {size / base:5.2f}x Q1")
print()
print(f"  warm total (all three, sequential)  {sum(r[2] for r in rows):.1f} ms")
print("  the 320 ms busy-state floor swallows this either way")
'
