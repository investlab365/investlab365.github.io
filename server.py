"""Local preview server with a best-effort quote endpoint."""

import json
import re
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import time
from urllib.parse import parse_qs, urlsplit

from catalog import stock_for
from history import fetch_history, fetch_history_for
from quotes import fetch_quote, fetch_quotes


ROOT = Path(__file__).parent
SNAPSHOTS = {
    "/api/quotes": (fetch_quotes, ROOT / "data" / "legacy-quotes.json"),
    "/api/history": (fetch_history, ROOT / "data" / "legacy-history.json"),
}
STOCK_SNAPSHOTS = {
    "300308.SZ": (ROOT / "data" / "quotes.json", ROOT / "data" / "history.json"),
    "SKHY": (ROOT / "data" / "hynix-quote.json", ROOT / "data" / "hynix-history.json"),
}


def snapshot_paths(symbol: str) -> tuple[Path, Path]:
    stock_for(symbol)
    if not re.fullmatch(r"[A-Z0-9.]+", symbol):
        raise ValueError("Invalid stock symbol")
    return STOCK_SNAPSHOTS.get(symbol, (
        ROOT / "data" / "cache" / f"{symbol}.quote.json",
        ROOT / "data" / "cache" / f"{symbol}.history.json",
    ))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlsplit(self.path)
        route = parsed.path
        if route in ("/api/quote", "/api/history"):
            symbol = parse_qs(parsed.query).get("symbol", [""])[0]
            try:
                quote_snapshot, history_snapshot = snapshot_paths(symbol)
            except ValueError:
                self.send_error(400, "Unsupported stock symbol")
                return
            if route == "/api/quote":
                fetch, snapshot, ttl = lambda: fetch_quote(symbol), quote_snapshot, 30
            else:
                fetch, snapshot, ttl = lambda: fetch_history_for(symbol), history_snapshot, 900
        elif route in SNAPSHOTS:
            fetch, snapshot = SNAPSHOTS[route]
            ttl = 0
        else:
            return super().do_GET()
        try:
            cached = None
            if ttl and snapshot.exists() and time() - snapshot.stat().st_mtime < ttl:
                cached = json.loads(snapshot.read_text(encoding="utf-8"))
                if route == "/api/quote" and (cached.get("symbol") != symbol or "marketCapYi" not in cached):
                    cached = None
                if route == "/api/history" and (cached.get("symbol") != symbol or
                    not cached.get("points") or "marketCapYi" not in cached["points"][0]):
                    cached = None
            if cached is not None:
                data = cached
            else:
                data = fetch()
                snapshot.parent.mkdir(parents=True, exist_ok=True)
                snapshot.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            status = 200
        except Exception as exc:
            if snapshot.exists():
                data = json.loads(snapshot.read_text(encoding="utf-8"))
                data["stale"] = True
                data["refreshError"] = str(exc)
                status = 200
            else:
                data = {"error": "行情暂不可用", "detail": str(exc)}
                status = 503
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    print("Preview: http://127.0.0.1:8765/")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
