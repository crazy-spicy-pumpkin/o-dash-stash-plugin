#!/usr/bin/env python3
"""Dev server — serves this repo and proxies Stash.

    python3 tools/devserve.py [--port 8421]

Everything is served from one origin, which is both a convenience and the point:
it is the environment the plugin actually runs in, where /graphql is same-origin
and no CSP entry is needed.

    /               -> src/ and tools/ from this repo
    /graphql        -> Stash            (default http://127.0.0.1:9999)
    /stash-ui.css   -> Stash's own stylesheet, for the CSS containment check

This is a development tool. It binds loopback only, and nothing here ships with
the plugin.
"""

import argparse
import http.server
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


class Handler(http.server.SimpleHTTPRequestHandler):
    """Serves the repo as if it were Stash.

    ROLE. Collapses the two things the dashboard needs — its own files and a
    Stash to query — onto one origin, so the standalone page behaves the way it
    will once it is a plugin. That is what makes the fast loop possible: edit,
    reload, no install step.
    """

    stash_url = "http://127.0.0.1:9999"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO), **kwargs)

    def log_message(self, fmt, *args):
        # Request paths are harmless, but keep the console quiet enough that a
        # real error is visible.
        if "favicon" not in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def _relay(self, upstream: str, body: bytes | None, content_type: str | None):
        """Forward one request and hand the response back verbatim.

        Failures are reported as a status and a reason, never with the upstream
        body echoed into the page.
        """
        req = urllib.request.Request(upstream, data=body, method=self.command)
        if content_type:
            req.add_header("Content-Type", content_type)
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                payload = res.read()
                self.send_response(res.status)
                self.send_header("Content-Type", res.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as err:
            self._fail(err.code, f"upstream returned {err.code}")
        except urllib.error.URLError as err:
            self._fail(502, f"cannot reach {upstream.split('/')[2]}: {err.reason}")

    def _fail(self, code: int, message: str):
        payload = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/graphql":
            self._fail(404, "not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        self._relay(f"{self.stash_url}/graphql", body, self.headers.get("Content-Type"))

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0]
        if path == "/stash-ui.css":
            self._relay_stash_css()
            return
        super().do_GET()

    def _relay_stash_css(self):
        """Serve Stash's own stylesheet, so the inbound leak check is real.

        Scoping our rules proves we do not leak *out* — that is a property of
        the selectors and holds anywhere. Bootstrap leaking *in* cannot be
        tested without Bootstrap, and Stash's bundle is the only honest source
        of it. The filename is content-hashed, so it is discovered from the
        served page rather than hard-coded.
        """
        try:
            with urllib.request.urlopen(f"{self.stash_url}/", timeout=15) as res:
                page = res.read().decode("utf-8", "replace")
        except urllib.error.URLError as err:
            self._fail(502, f"cannot reach Stash: {err.reason}")
            return
        match = re.search(r'href="\.?/?(assets/[^"]+\.css)"', page)
        if not match:
            self._fail(502, "no stylesheet link found in the Stash page")
            return
        self._relay(f"{self.stash_url}/{match.group(1)}", None, None)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=8421)
    parser.add_argument("--stash-url", default="http://127.0.0.1:9999")
    args = parser.parse_args()

    Handler.stash_url = args.stash_url.rstrip("/")

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"dev server  http://127.0.0.1:{args.port}/src/index.html?demo=1")
    print(f"  /graphql      -> {Handler.stash_url}")
    print(f"  /stash-ui.css -> {Handler.stash_url} (for the containment check)")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
