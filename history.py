"""Reconstruct the A-share quote-page market cap from daily closes and shares.

The A-share quote convention applies the A-share price to all issued shares,
including H shares after listing. Share-count step dates are issuer disclosures.
"""

import json
from datetime import datetime, timezone
from urllib.parse import quote
from zoneinfo import ZoneInfo

from catalog import stock_for
from quotes import _read, tencent_code, yahoo_chart_url


def fetch_history(symbol: str = "300308.SZ") -> dict:
    stock = stock_for(symbol)
    code = tencent_code(symbol)
    steps = stock.get("shareSteps")
    if not steps or any(steps[i]["date"] >= steps[i + 1]["date"] for i in range(len(steps) - 1)):
        raise ValueError(f"Missing or unordered share-count steps for {symbol}")
    url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={quote(code + ',day,,,180,')}"
    payload = json.loads(_read(url).decode("utf-8"))
    rows = payload["data"][code]["day"]
    points = []
    for row in rows:
        date = row[0]
        if date < steps[0]["date"]:
            continue
        close = float(row[2])
        shares = next(item["shares"] for item in reversed(steps) if item["date"] <= date)
        if not 0 < close < 100_000:
            raise ValueError(f"Invalid daily close for {date}")
        points.append({
            "date": date,
            "aCloseCny": close,
            "totalShares": shares,
            "marketCapYiCny": round(close * shares / 100_000_000, 4),
        })
    if len(points) < 2:
        raise ValueError("Insufficient A-share daily history")
    return {
        "symbol": symbol,
        "basis": stock["historyBasis"],
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "points": points,
        "sources": {
            "aDaily": url,
            "shares": [source["url"] for source in stock["sources"] if source["url"] != url],
        },
    }


def fetch_history_for(symbol: str) -> dict:
    stock = stock_for(symbol)
    if stock["currency"] == "CNY":
        raw = fetch_history(symbol)
        return {
            "symbol": symbol,
            "currency": "CNY",
            "fetchedAtUtc": raw["fetchedAtUtc"],
            "basis": raw["basis"],
            "points": [{"date": item["date"], "close": item["aCloseCny"],
                        "shares": item["totalShares"], "marketCapYi": item["marketCapYiCny"]}
                       for item in raw["points"]],
            "source": raw["sources"]["aDaily"],
        }
    if stock["currency"] != "USD":
        raise ValueError(f"Unsupported currency: {stock['currency']}")
    url = yahoo_chart_url(symbol)
    payload = json.loads(_read(url).decode("utf-8"))
    result = payload["chart"]["result"][0]
    meta = result["meta"]
    if meta.get("symbol") != symbol or meta.get("currency") != "USD":
        raise ValueError("Unexpected SKHY history identity or currency")
    closes = result["indicators"]["quote"][0]["close"]
    points = []
    for timestamp, value in zip(result["timestamp"], closes):
        if value is None:
            continue
        close = round(float(value), 4)
        if not 0 < close < 100_000:
            continue
        date = datetime.fromtimestamp(timestamp, ZoneInfo("America/New_York")).date().isoformat()
        points.append({
            "date": date,
            "close": close,
            "shares": stock["shares"],
            "marketCapYi": round(close * stock["shares"] / stock["adsRatio"] / 1e8, 4),
        })
    if len(points) < 20 or any(a["date"] >= b["date"] for a, b in zip(points, points[1:])):
        raise ValueError("Insufficient or unordered SKHY history")
    return {
        "symbol": symbol,
        "currency": "USD",
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "basis": stock["historyBasis"],
        "points": points,
        "source": url,
    }


if __name__ == "__main__":
    print(json.dumps(fetch_history(), ensure_ascii=False, indent=2))
