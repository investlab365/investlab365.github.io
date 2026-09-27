"""Refresh every stock's static quote fallback from its public quote adapter."""

import json

from catalog import CATALOG_PATH
from quotes import fetch_quote
from server import snapshot_paths


for stock in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["stocks"]:
    symbol = stock["symbol"]
    target, _ = snapshot_paths(symbol)
    data = fetch_quote(symbol)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(symbol, data["quoteTime"], target)
