#!/usr/bin/env python3
"""Generate the architecture and flow diagrams.

Emits, for each diagram:
  docs/<name>.excalidraw  — editable source, opens in Excalidraw (local or web)
  docs/<name>.svg         — self-contained image, renders inline on GitHub

Both are committed, so the diagrams live in the repo rather than on someone
else's server. Run after editing SPECS:

    python3 docs/diagrams.py
"""

from __future__ import annotations

import json
import random
import zlib
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent
# Single quotes inside: this string is emitted inside a double-quoted SVG attribute.
FONT = "system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

# Excalidraw's own font ids: 1 = hand-drawn, 2 = normal (sans), 3 = code.
FONT_FAMILY = 2
CHAR_W = 0.55  # rough advance width per character, as a fraction of font size


# --------------------------------------------------------------------------- #
# Diagram specs — compact; expanded into both formats below
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# Shared colour legend — appended to every diagram, so a colour means the same
# thing wherever it appears.
# --------------------------------------------------------------------------- #

LEGEND_ROWS = [
    ("#ffd8a8", "#f59e0b", "the plugin — the files in this repo"),
    ("#d0bfff", "#8b5cf6", "Stash — its server, and what it returns"),
    ("#a5d8ff", "#4a9eed", "the browser — code, and the payload"),
    ("#b2f2bb", "#22c55e", "data — the library, and parsed state"),
    ("#fff3bf", "#f59e0b", "a note worth knowing"),
    ("#ffc9c9", "#ef4444", "something that never happens"),
]


def legend(y: int) -> list:
    """The colour key, as elements: two columns starting at y."""
    out = []
    for i, (fill, stroke, label) in enumerate(LEGEND_ROWS):
        col, row = divmod(i, 3)
        x = 58 + col * 372
        ry = y + row * 34
        out.append(("box", x, ry, 24, 22, "", fill, stroke))
        out.append(("text", x + 36, ry + 3, label, 15, "#757575", "left"))
    return out


ARCHITECTURE = {
    "name": "architecture",
    "title": "O Dashboard — Architecture",
    "size": (820, 812),
    "elements": [
        ("text", 410, 16, "O Dashboard — Architecture", 24, "#1e1e1e", "center"),
        ("text", 410, 48, "rounded panels are boundaries — where the code runs", 16, "#757575", "center"),

        ("zone", 50, 82, 700, 156, "#dbe4ff", "#4a9eed"),
        ("text", 68, 90, "1 · Browser — any device that can reach Stash", 16, "#2563eb", "left"),
        ("box", 80, 118, 300, 46, "Stash UI (React) + PluginApi", "#a5d8ff", "#4a9eed"),
        ("box", 420, 118, 300, 46, "route /o-dashboard", "#ffd8a8", "#f59e0b"),
        ("box", 80, 174, 640, 46, "app.js — buckets, charts, themes (no deps)", "#ffd8a8", "#f59e0b"),

        ("arrow", 300, 240, 300, 296, "POST /graphql", "#8b5cf6", False),
        ("arrow", 500, 296, 500, 240, "JSON · RFC3339", "#8b5cf6", True),

        ("zone", 50, 298, 700, 156, "#e5dbff", "#8b5cf6"),
        ("text", 68, 306, "2 · Stash server — same origin, session cookie", 16, "#6d28d9", "left"),
        ("box", 80, 334, 300, 46, "/graphql · findScenes + stats", "#d0bfff", "#8b5cf6"),
        ("box", 400, 334, 320, 46, "the plugin\u2019s files, served here", "#ffd8a8", "#f59e0b"),
        ("box", 80, 390, 640, 46, "dataloaders batch o_history / play_history", "#d0bfff", "#8b5cf6"),

        ("arrow", 400, 516, 400, 456, "reads", "#22c55e", False),

        ("zone", 50, 514, 700, 158, "#d3f9d8", "#22c55e"),
        ("text", 68, 522, "3 · Data — read-only, one direction", 16, "#15803d", "left"),
        ("box", 120, 548, 200, 62, "Stash app", "#a5d8ff", "#4a9eed"),
        ("arrow", 324, 579, 376, 579, "writes", "#f59e0b", False),
        ("box", 380, 548, 220, 62, "stash-go.sqlite", "#b2f2bb", "#22c55e"),
        ("note", 120, 622, 480, 32, "the plugin never opens this file", "#ffc9c9", "#ef4444"),

        ("text", 70, 738, "The plugin is three files of JS and one of CSS. Stash serves them,", 16, "#757575", "left"),
        ("text", 70, 762, "runs them in its own page, and answers their queries.", 16, "#757575", "left"),
        ("text", 70, 786, "Standalone: the same files from any origin, with an ApiKey header.", 16, "#757575", "left"),
    ],
}

FLOW = {
    "name": "flow",
    "title": "Load — what actually happens",
    "size": (940, 764),
    "elements": [
        ("text", 470, 16, "Load — what actually happens", 24, "#1e1e1e", "center"),
        ("text", 470, 48, "time runs downward · each dashed line is one file doing its part", 16, "#757575", "center"),

        ("zone", 40, 80, 620, 520, "#dbe4ff", "#4a9eed"),
        ("text", 58, 88, "Browser", 16, "#2563eb", "left"),
        ("zone", 680, 80, 220, 520, "#e5dbff", "#8b5cf6"),
        ("text", 698, 88, "Stash server", 16, "#6d28d9", "left"),

        ("box", 60, 112, 170, 42, "plugin.js", "#ffd8a8", "#f59e0b"),
        ("life", 145, 154, 145, 566),
        ("box", 250, 112, 170, 42, "app.js", "#ffd8a8", "#f59e0b"),
        ("life", 335, 154, 335, 566),
        ("box", 440, 112, 170, 42, "graphql-source.js", "#ffd8a8", "#f59e0b"),
        ("life", 525, 154, 525, 566),
        ("box", 700, 112, 180, 42, "/graphql", "#d0bfff", "#8b5cf6"),
        ("life", 790, 154, 790, 566),

        ("arrow", 145, 196, 335, 196, "mount(container)", "#f59e0b", False),
        ("arrow", 335, 238, 525, 238, "getPayload()", "#f59e0b", False),

        ("arrow", 525, 282, 790, 282, "Q1  o_history + scene metadata", "#22c55e", False),
        ("arrow", 525, 316, 790, 316, "Q2  play_history", "#22c55e", False),
        ("arrow", 525, 350, 790, 350, "Q3  stats", "#22c55e", False),
        ("note", 320, 376, 330, 30, "all three sent at once, not one by one", "#fff3bf", "#f59e0b"),

        ("arrow", 790, 432, 335, 432, "Q1 lands", "#22c55e", True),
        ("note", 170, 458, 330, 30, "FIRST PAINT — hero, chart, calendar", "#d3f9d8", "#22c55e"),

        ("arrow", 790, 520, 335, 520, "Q2 and Q3 land", "#22c55e", True),
        ("note", 170, 546, 330, 30, "comparison + all-time denominator", "#dbe4ff", "#4a9eed"),

        ("text", 60, 676, "Nothing renders until Q1 arrives, so no panel ever shows a half-true zero.", 16, "#757575", "left"),
        ("text", 60, 700, "Changing week, month or year is pure client-side — no round trip.", 16, "#757575", "left"),
        ("text", 60, 724, "In demo mode demo-source.js answers instead, and the server column never runs.", 16, "#757575", "left"),
    ],
}

DATA = {
    "name": "data",
    "title": "Data — the shapes, and what turns into what",
    "size": (880, 792),
    "elements": [
        ("text", 440, 16, "Data — the shapes, and what turns into what", 24, "#1e1e1e", "center"),
        ("text", 440, 48, "three shapes, two transformations", 16, "#757575", "center"),

        ("zone", 40, 84, 800, 118, "#e5dbff", "#8b5cf6"),
        ("text", 58, 92, "1 · what Stash returns — one row per scene, history nested inside", 16, "#6d28d9", "left"),
        ("box", 60, 120, 760, 66, "findScenes.scenes[] · { id, title, studio, performers, tags, o_history[] }", "#d0bfff", "#8b5cf6"),

        ("arrow", 440, 204, 440, 250, "graphql-source.js reshapes", "#f59e0b", False),

        ("zone", 40, 252, 800, 168, "#dbe4ff", "#4a9eed"),
        ("text", 58, 260, "2 · the payload — the contract every source satisfies", 16, "#2563eb", "left"),
        ("box", 60, 288, 380, 54, "events[] · { t: epoch ms, s: scene id }", "#a5d8ff", "#4a9eed"),
        ("box", 456, 288, 364, 54, "scenes{} · keyed by id", "#a5d8ff", "#4a9eed"),
        ("box", 60, 350, 380, 54, "views[] · epoch ms, no scene", "#a5d8ff", "#4a9eed"),
        ("box", 456, 350, 364, 54, "library_scenes · stash_url · caption", "#a5d8ff", "#4a9eed"),

        ("arrow", 440, 422, 440, 468, "app.js parses, once per load", "#f59e0b", False),

        ("zone", 40, 470, 800, 130, "#d3f9d8", "#22c55e"),
        ("text", 58, 478, "3 · what the dashboard holds — ready to bucket and draw", 16, "#15803d", "left"),
        ("box", 60, 506, 380, 54, "state.events[] · { date, day, sceneId }", "#b2f2bb", "#22c55e"),
        ("box", 456, 506, 364, 54, "state.views[] · sorted epoch ms", "#b2f2bb", "#22c55e"),
        ("note", 60, 566, 760, 26, "day is a calendar-day integer, computed in the reader's local time", "#fff3bf", "#f59e0b"),

        ("text", 58, 626, "One event, all the way through:", 16, "#1e1e1e", "left"),
        ("box", 58, 652, 268, 48, "\"2026-01-03T22:15:00+05:30\"", "#d0bfff", "#8b5cf6"),
        ("arrow", 332, 676, 372, 676, "", "#f59e0b", False),
        ("box", 378, 652, 214, 48, "{ t: 1767458700000, s: 7 }", "#a5d8ff", "#4a9eed"),
        ("arrow", 598, 676, 638, 676, "", "#f59e0b", False),
        ("box", 644, 652, 226, 48, "{ date, day, sceneId: \"7\" }", "#b2f2bb", "#22c55e"),

        ("text", 58, 722, "The offset is honoured, never sliced off: that instant is 16:45 UTC, so it can", 16, "#757575", "left"),
        ("text", 58, 746, "sort before a 23:45Z event on the following line. tools/unit.mjs pins exactly this.", 16, "#757575", "left"),
    ],
}

RELEASE = {
    "name": "release",
    "title": "Release — how a change reaches someone else's Stash",
    "size": (940, 1002),
    "elements": [
        ("text", 470, 16, "Release — how a change reaches someone else’s Stash", 24, "#1e1e1e", "center"),
        ("text", 470, 48, "steps 1 and 2 you do · steps 3 and 4 happen on their own", 16, "#757575", "center"),
        ("text", 470, 72, "one worked example, carried through: 0.1.0 → 0.1.1", 16, "#757575", "center"),

        ("text", 68, 110, "YOU — nothing is published until you say so", 15, "#b45309", "left"),

        ("zone", 50, 132, 840, 146, "#ffe8cc", "#f59e0b"),
        ("text", 68, 140, "1 · Bump the manifest", 16, "#b45309", "left"),
        ("box", 80, 168, 330, 46, "sh tools/bump.sh patch", "#ffd8a8", "#f59e0b"),
        ("arrow", 410, 191, 452, 191, "", "#f59e0b", False),
        ("box", 452, 168, 408, 46, "o-dashboard.yml · version: 0.1.0 → 0.1.1", "#ffd8a8", "#f59e0b"),
        ("note", 80, 228, 780, 32, "check.sh fails if a shipped file changed and the version did not", "#fff3bf", "#f59e0b"),

        ("arrow", 470, 280, 470, 316, "git commit — still private", "#f59e0b", False),

        ("zone", 50, 318, 840, 146, "#ffe8cc", "#f59e0b"),
        ("text", 68, 326, "2 · Cut the release", 16, "#b45309", "left"),
        ("box", 80, 354, 330, 46, "sh tools/release.sh", "#ffd8a8", "#f59e0b"),
        ("arrow", 410, 377, 452, 377, "", "#f59e0b", False),
        ("box", 452, 354, 408, 46, "reads 0.1.1 → tags v0.1.1 → pushes", "#ffd8a8", "#f59e0b"),
        ("note", 80, 414, 780, 32, "refuses a dirty tree · a branch other than main · a tag that exists · failing checks", "#fff3bf", "#f59e0b"),

        ("arrow", 470, 470, 470, 522, "pushing the tag — the only automatic link", "#f59e0b", False),

        ("text", 68, 548, "AUTOMATIC — from here nothing waits on you", 15, "#b45309", "left"),

        ("zone", 50, 570, 840, 214, "#ffe8cc", "#f59e0b"),
        ("text", 68, 578, "3 · The tag fires CI", 16, "#b45309", "left"),
        ("box", 80, 606, 780, 46, "publish.yml · on: push tags v*", "#ffd8a8", "#f59e0b"),
        ("box", 80, 668, 244, 42, "tag == manifest?", "#ffd8a8", "#f59e0b"),
        ("box", 348, 668, 244, 42, "package.sh → zip + index", "#ffd8a8", "#f59e0b"),
        ("box", 616, 668, 244, 42, "sha256 · top level?", "#ffd8a8", "#f59e0b"),
        ("note", 80, 726, 780, 32, "any one failing stops it — nothing reaches Pages, and 0.1.0 stays live", "#fff3bf", "#f59e0b"),

        ("arrow", 470, 786, 470, 822, "deploy to GitHub Pages", "#8b5cf6", False),

        ("zone", 50, 824, 840, 158, "#e5dbff", "#8b5cf6"),
        ("text", 68, 832, "4 · Someone else’s Stash offers the update", 16, "#6d28d9", "left"),
        ("box", 80, 860, 380, 46, "published index.yml says 0.1.1", "#ffd8a8", "#f59e0b"),
        ("box", 480, 860, 380, 46, "their installed copy says 0.1.0", "#d0bfff", "#8b5cf6"),
        ("note", 80, 920, 780, 46, "strings differ → Update appears.  Same string → nothing happens, and nothing says why.", "#ffc9c9", "#ef4444"),
    ],
}

# The legend is the same for every diagram, so it is one diagram of its own
# rather than a footer repeated three times.
LEGEND = {
    "name": "legend",
    "title": "Diagram legend",
    "size": (820, 214),
    "elements": [
        ("text", 410, 16, "Diagram legend", 24, "#1e1e1e", "center"),
        ("text", 410, 48, "these colours mean the same thing in every diagram", 16, "#757575", "center"),
    ] + legend(88),
}

SPECS = [ARCHITECTURE, FLOW, DATA, RELEASE, LEGEND]




def text_width(text: str, size: int) -> float:
    return len(text) * size * CHAR_W


# --------------------------------------------------------------------------- #
# Excalidraw
# --------------------------------------------------------------------------- #

def base(el_id: str, kind: str, x, y, w, h, rng, **extra) -> dict:
    element = {
        "id": el_id,
        "type": kind,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": "#1e1e1e",
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": rng.randint(1, 2**31),
        "version": 1,
        "versionNonce": rng.randint(1, 2**31),
        "isDeleted": False,
        "boundElements": [],
        "updated": 1,
        "link": None,
        "locked": False,
    }
    element.update(extra)
    return element


def bound_label(el_id: str, container_id: str, text: str, size: int, container, rng) -> dict:
    """A label inside a shape is a separate text element in real Excalidraw:
    the text points at its container, and the container lists it back."""
    width = text_width(text, size)
    return base(
        el_id, "text",
        container["x"] + (container["width"] - width) / 2,
        container["y"] + (container["height"] - size * 1.25) / 2,
        width, size * 1.25, rng,
        text=text, originalText=text, rawText=text,
        fontSize=size, fontFamily=FONT_FAMILY,
        textAlign="center", verticalAlign="middle",
        containerId=container_id, lineHeight=1.25, autoResize=True,
    )


def to_excalidraw(spec: dict) -> dict:
    # Excalidraw wants a seed and a nonce per element; their values are
    # arbitrary, but they must not change between runs or every diagram shows
    # up modified whenever any one of them is edited. Python's hash() is salted
    # per process, so it cannot be used here — crc32 is stable by definition.
    rng = random.Random(zlib.crc32(spec["name"].encode()))
    elements: list[dict] = []
    n = 0

    for item in spec["elements"]:
        kind = item[0]
        n += 1
        eid = f"{spec['name'][:2]}{n}"

        if kind in ("box", "note"):
            _, x, y, w, h, label, fill, stroke = item
            size = 16 if kind == "box" else 14
            shape = base(eid, "rectangle", x, y, w, h, rng,
                         backgroundColor=fill, strokeColor=stroke,
                         roundness={"type": 3},
                         strokeWidth=2 if kind == "box" else 1,
                         opacity=100 if kind == "box" else 60)
            text = bound_label(f"{eid}t", eid, label, size, shape, rng)
            shape["boundElements"] = [{"id": f"{eid}t", "type": "text"}]
            elements += [shape, text]

        elif kind == "zone":
            _, x, y, w, h, fill, stroke = item
            elements.append(base(eid, "rectangle", x, y, w, h, rng,
                                 backgroundColor=fill, strokeColor=stroke,
                                 strokeWidth=1, roundness={"type": 3}, opacity=35))

        elif kind == "text":
            _, x, y, content, size, colour, align = item
            width = text_width(content, size)
            left = x - width / 2 if align == "center" else x
            elements.append(base(eid, "text", left, y, width, size * 1.25, rng,
                                 text=content, originalText=content, rawText=content,
                                 fontSize=size, fontFamily=FONT_FAMILY,
                                 textAlign="left", verticalAlign="top",
                                 containerId=None, lineHeight=1.25, autoResize=True,
                                 strokeColor=colour))

        elif kind == "life":  # dashed lifeline for the sequence diagram
            _, x1, y1, x2, y2 = item
            elements.append(base(eid, "arrow", x1, y1, 0, y2 - y1, rng,
                                 points=[[0, 0], [x2 - x1, y2 - y1]],
                                 strokeColor="#b0b0b0", strokeWidth=1,
                                 strokeStyle="dashed", startArrowhead=None,
                                 endArrowhead=None, roundness={"type": 2}))

        elif kind == "arrow":
            _, x1, y1, x2, y2, label, colour, dashed = item
            arrow = base(eid, "arrow", x1, y1, x2 - x1, y2 - y1, rng,
                         points=[[0, 0], [x2 - x1, y2 - y1]],
                         strokeColor=colour, strokeWidth=2,
                         strokeStyle="dashed" if dashed else "solid",
                         startArrowhead=None, endArrowhead="arrow",
                         roundness={"type": 2})
            elements.append(arrow)
            if label:
                mid_x, mid_y = (x1 + x2) / 2, (y1 + y2) / 2
                width = text_width(label, 14)
                text = base(f"{eid}t", "text", mid_x - width / 2, mid_y - 9, width, 17.5, rng,
                            text=label, originalText=label, rawText=label,
                            fontSize=14, fontFamily=FONT_FAMILY,
                            textAlign="center", verticalAlign="middle",
                            containerId=eid, lineHeight=1.25, autoResize=True,
                            strokeColor="#1e1e1e")
                arrow["boundElements"] = [{"id": f"{eid}t", "type": "text"}]
                elements.append(text)

    return {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {"gridSize": None, "viewBackgroundColor": "#ffffff"},
        "files": {},
    }


# --------------------------------------------------------------------------- #
# SVG — clean-line rendering of the same spec, for inline display
# --------------------------------------------------------------------------- #

def svg_text(x, y, content, size, colour, anchor="middle", weight="400") -> str:
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{FONT}" font-size="{size}" '
            f'fill="{colour}" text-anchor="{anchor}" font-weight="{weight}" '
            f'dominant-baseline="middle">{escape(content)}</text>')


def svg_arrow(x1, y1, x2, y2, colour, dashed) -> list[str]:
    """Line plus an explicit arrowhead polygon.

    No <marker>/context-stroke: GitHub sanitises SVG before serving it, and a
    plain polygon renders everywhere.
    """
    dx, dy = x2 - x1, y2 - y1
    length = max(1e-6, (dx * dx + dy * dy) ** 0.5)
    ux, uy = dx / length, dy / length
    head, half = 10.0, 4.5
    bx, by = x2 - ux * head, y2 - uy * head          # base of the head
    px, py = -uy * half, ux * half                   # perpendicular offset
    dash = ' stroke-dasharray="7 5"' if dashed else ""
    return [
        f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{bx:.1f}" y2="{by:.1f}" '
        f'stroke="{colour}" stroke-width="2"{dash}/>',
        f'<polygon points="{x2:.1f},{y2:.1f} {bx + px:.1f},{by + py:.1f} '
        f'{bx - px:.1f},{by - py:.1f}" fill="{colour}"/>',
    ]


def to_svg(spec: dict) -> str:
    w, h = spec["size"]
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" '
        f'height="{h}" role="img" aria-label="{escape(spec["title"])}">',
        f'<rect width="{w}" height="{h}" fill="#ffffff"/>',
    ]

    for item in spec["elements"]:
        kind = item[0]

        if kind == "zone":
            _, x, y, bw, bh, fill, stroke = item
            out.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="12" '
                       f'fill="{fill}" fill-opacity="0.45" stroke="{stroke}" stroke-width="1"/>')

        elif kind in ("box", "note"):
            _, x, y, bw, bh, label, fill, stroke = item
            size = 16 if kind == "box" else 13
            opacity = "1" if kind == "box" else "0.65"
            out.append(f'<rect x="{x}" y="{y}" width="{bw}" height="{bh}" rx="10" '
                       f'fill="{fill}" fill-opacity="{opacity}" stroke="{stroke}" '
                       f'stroke-width="{2 if kind == "box" else 1}"/>')
            out.append(svg_text(x + bw / 2, y + bh / 2 + 1, label, size, "#1e1e1e",
                                weight="600" if kind == "box" else "400"))

        elif kind == "text":
            _, x, y, content, size, colour, align = item
            anchor = "middle" if align == "center" else "start"
            out.append(svg_text(x, y + size * 0.62, content, size, colour, anchor,
                                weight="600" if size >= 24 else "400"))

        elif kind == "life":
            _, x1, y1, x2, y2 = item
            out.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#b0b0b0" '
                       f'stroke-width="1" stroke-dasharray="5 5"/>')

        elif kind == "arrow":
            _, x1, y1, x2, y2, label, colour, dashed = item
            out += svg_arrow(x1, y1, x2, y2, colour, dashed)
            if label:
                mid_x, mid_y = (x1 + x2) / 2, (y1 + y2) / 2
                pad, tw = 5, text_width(label, 13)
                horizontal = abs(x2 - x1) >= abs(y2 - y1)
                span = max(abs(x2 - x1), abs(y2 - y1))
                if horizontal and tw + 44 > span:
                    # The label needs more room than the arrow has: sit it above,
                    # rather than blanking out the line it belongs to. (Vertical
                    # arrows keep the pill — it masks the line behind the text.)
                    out.append(svg_text(mid_x, mid_y - 14, label, 13, "#3f3f3f"))
                else:
                    out.append(f'<rect x="{mid_x - tw / 2 - pad:.1f}" y="{mid_y - 10:.1f}" '
                               f'width="{tw + pad * 2:.1f}" height="20" rx="4" fill="#ffffff"/>')
                    out.append(svg_text(mid_x, mid_y, label, 13, "#3f3f3f"))

    out.append('</svg>')
    return "\n".join(out)


def main() -> None:
    for spec in SPECS:
        scene = OUT / f"{spec['name']}.excalidraw"
        scene.write_text(json.dumps(to_excalidraw(spec), indent=2) + "\n")
        image = OUT / f"{spec['name']}.svg"
        image.write_text(to_svg(spec) + "\n")
        print(f"wrote {scene.name} and {image.name}")


if __name__ == "__main__":
    main()
