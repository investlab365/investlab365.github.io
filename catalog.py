"""Shared, manually reviewed research data for the local quote adapters."""

import json
from pathlib import Path


CATALOG_PATH = Path(__file__).parent / "data" / "stocks.json"


def stock_for(symbol: str) -> dict:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    for stock in catalog["stocks"]:
        if stock["symbol"] == symbol:
            return stock
    raise ValueError(f"Unsupported symbol: {symbol}")
