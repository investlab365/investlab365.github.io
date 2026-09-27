"""Refresh every stock's static daily-history fallback."""

import json

from catalog import CATALOG_PATH
from history import fetch_history_for
from server import snapshot_paths


for stock in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))["stocks"]:
    symbol = stock["symbol"]
    _, target = snapshot_paths(symbol)
    data = fetch_history_for(symbol)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(symbol, len(data["points"]), target)
