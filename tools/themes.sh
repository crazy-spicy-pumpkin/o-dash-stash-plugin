#!/bin/sh
# Rebuild docs/themes.gif — the five palettes, one frame each.
#
# ROLE. The GIF at the top of the README is a picture of the dashboard, so it
# goes stale whenever the dashboard changes, and nothing fails when it does: a
# tile was replaced once and the README went on showing the old one. The recipe
# used to live nowhere but the memory of whoever ran it. This is that recipe.
#
#     sh tools/themes.sh
#
# Run it after any change that alters what the page looks like, and commit the
# GIF with that change.
#
# Every frame comes from tools/capture.html, which refuses to render without
# demo=1. No library is read; nothing here can photograph a real one.
#
# Starts its own dev server on a spare port and stops it again, and removes its
# frames, so it leaves nothing running and nothing behind. Needs Chrome and
# ImageMagick.

set -eu

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PORT="${PORT:-8437}"
BASE="http://127.0.0.1:$PORT"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT="$REPO/docs/themes.gif"

# The order the README's alt text names them in: light palettes, then dark.
FRAMES="light:tokyonight-day light:aubade light:spicy-pumpkin dark:stash dark:naughty"
# Hundredths of a second per frame — long enough to read the menu.
DELAY=220
# One fixed window for every frame. A GIF has a single canvas, and frames of
# differing heights make the page appear to jump between palettes. Captured at
# a desktop width and scaled down: at 1000 wide the tiles wrap, and the README
# would show a layout most people never see.
SIZE="1280,2100"
WIDTH=1000
# Seconds before a frame is given up on. A frame takes about two.
PATIENCE=40

[ -x "$CHROME" ] || { echo "Chrome not found at $CHROME (set CHROME=)" >&2; exit 2; }
command -v magick >/dev/null || { echo "ImageMagick is required (brew install imagemagick)" >&2; exit 2; }

WORK=$(mktemp -d)
python3 "$REPO/tools/devserve.py" --port "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
chrome=""
cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  [ -z "$chrome" ] || kill "$chrome" 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

i=0
while [ $i -lt 30 ]; do
  curl -s -o /dev/null --max-time 1 "$BASE/src/index.html" && break
  i=$((i + 1)); sleep 0.2
done

n=0
for spec in $FRAMES; do
  mode=${spec%%:*}
  palette=${spec#*:}
  # menu=1 opens the theme switcher, so the frame shows where the control is
  # and which palette is active rather than changing colour for no visible reason.
  #
  # No --user-data-dir. With one, this Chrome takes the screenshot and then
  # never exits, and a headless Chrome that does not exit holds its memory
  # until someone goes looking. capture.html clears localStorage itself, so the
  # default profile cannot leak a theme between frames. The watchdog is for
  # whatever the next such surprise turns out to be.
  "$CHROME" --headless --disable-gpu --no-sandbox --hide-scrollbars \
    --force-device-scale-factor=1 --window-size="$SIZE" \
    --virtual-time-budget=15000 \
    --screenshot="$WORK/frame-$n.png" \
    "$BASE/tools/capture.html?demo=1&mode=$mode&palette=$palette&menu=1" >/dev/null 2>&1 &
  chrome=$!
  ( sleep "$PATIENCE"; kill "$chrome" 2>/dev/null ) &
  watchdog=$!
  wait "$chrome" || true
  kill "$watchdog" 2>/dev/null || true
  [ -s "$WORK/frame-$n.png" ] || { echo "no frame for $palette" >&2; exit 1; }
  echo "  frame $n  $palette"
  n=$((n + 1))
done

# Written beside the target and moved into place, so a failed build cannot
# leave the README pointing at half a GIF.
#
# +dither: a GIF holds 256 colours, and the default way of faking the rest is
# to speckle them. On flat UI colour that reads as dirt on every card, and the
# noise costs bytes. Nearest-colour is both cleaner and smaller here.
magick -delay "$DELAY" -loop 0 "$WORK"/frame-[0-9].png -resize "${WIDTH}x" \
  +dither -layers Optimize "$OUT.tmp.gif"
mv "$OUT.tmp.gif" "$OUT"

echo "wrote docs/themes.gif — $n frames"
