"""Fetch the A-share quote and the quote provider's displayed total market cap.

Tencent's public quote endpoint is an unofficial, best-effort source. Do not
present these observations as an exchange-certified real-time feed.
"""

from __future__ import annotations

import json
import re
import time
from http.client import HTTPException
from datetime import datetime, timezone
from urllib.parse import quote as url_quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from catalog import stock_for


SHARE_SOURCE = "https://static.cninfo.com.cn/finalpage/2026-08-27/1225515675.PDF"
def yahoo_chart_url(symbol: str) -> str:
    return f"https://query1.finance.yahoo.com/v8/finance/chart/{url_quote(symbol)}?interval=1d&range=6mo"


def tencent_code(symbol: str) -> str:
    match = re.fullmatch(r"(\d{6})\.(SZ|SH)", symbol)
    if not match:
        raise ValueError(f"Unsupported A-share symbol: {symbol}")
    return match[2].lower() + match[1]


def _read(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=12) as response:
                return response.read()
        except (OSError, HTTPException, ValueError):
            if attempt == 2:
                raise
            time.sleep(0.4 * (attempt + 1))
    raise RuntimeError("Unreachable quote read")


def _quote_line(text: str, symbol: str) -> list[str]:
    match = re.search(rf'v_{symbol}="([^"]+)";', text)
    if not match:
        raise ValueError(f"Missing quote: {symbol}")
    fields = match.group(1).split("~")
    if len(fields) < 31 or fields[2] != symbol[-6:] and fields[2] != symbol[-5:]:
        raise ValueError(f"Malformed quote: {symbol}")
    return fields


def fetch_quotes(symbol: str = "300308.SZ") -> dict:
    code = tencent_code(symbol)
    url = f"https://qt.gtimg.cn/q={code}"
    stock = stock_for(symbol)
    raw = _read(url).decode("gbk", errors="replace")
    a = _quote_line(raw, code)
    if len(a) <= 73:
        raise ValueError("A-share quote missing total market cap or shares")
    a_price = float(a[3])
    market_cap_yi = float(a[45])
    total_shares = int(float(a[73]))
    if not 0 < a_price < 100_000 or not 0 < market_cap_yi or total_shares <= 0:
        raise ValueError("Invalid quote price")
    if abs(market_cap_yi - a_price * total_shares / 100_000_000) / market_cap_yi > 0.005:
        raise ValueError("Quoted total market cap does not match price and total shares")
    a_time = datetime.strptime(a[30][:14], "%Y%m%d%H%M%S").strftime("%Y-%m-%d %H:%M:%S")

    return {
        "symbol": symbol,
        "name": stock["name"],
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "priceCny": a_price,
        "quoteTimeCst": a_time,
        "totalShares": total_shares,
        "marketCapYiCny": market_cap_yi,
        "basis": stock["quoteBasis"],
        "sources": {"quote": url, "shares": SHARE_SOURCE},
        "notice": "公开行情接口可能延迟或中断；报价时间以接口返回值为准。",
    }


def fetch_quote(symbol: str) -> dict:
    """Normalize both quote providers to the same client schema.

    A price and cap come from Tencent. SKHY's company cap is derived from the
    ADR price and the manually reviewed, fixed post-offering share count.
    """
    stock = stock_for(symbol)
    if stock["currency"] == "CNY":
        raw = fetch_quotes(symbol)
        return {
            "symbol": symbol,
            "currency": "CNY",
            "price": raw["priceCny"],
            "marketCapYi": raw["marketCapYiCny"],
            "shares": raw["totalShares"],
            "quoteTime": raw["quoteTimeCst"],
            "timezone": "Asia/Shanghai",
            "fetchedAtUtc": raw["fetchedAtUtc"],
            "source": raw["sources"]["quote"],
            "marketCapMethod": raw["basis"],
            "notice": raw["notice"],
        }
    if stock["currency"] != "USD":
        raise ValueError(f"Unsupported currency: {stock['currency']}")
    url = yahoo_chart_url(symbol)
    payload = json.loads(_read(url).decode("utf-8"))
    result = payload["chart"]["result"][0]
    meta = result["meta"]
    if meta.get("symbol") != symbol or meta.get("currency") != "USD":
        raise ValueError("Unexpected SKHY quote identity or currency")
    price = float(meta["regularMarketPrice"])
    timestamp = int(meta["regularMarketTime"])
    if not 0 < price < 100_000 or timestamp <= 0:
        raise ValueError("Invalid SKHY quote price or time")
    shares = stock["shares"]
    ratio = stock["adsRatio"]
    if not 0 < ratio <= 1 or shares <= 0:
        raise ValueError("Invalid SKHY share basis")
    return {
        "symbol": symbol,
        "currency": "USD",
        "price": price,
        "marketCapYi": round(price * shares / ratio / 1e8, 4),
        "shares": shares,
        "adsRatio": ratio,
        "quoteTime": datetime.fromtimestamp(timestamp, ZoneInfo("America/New_York")).strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "America/New_York",
        "fetchedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": url,
        "marketCapMethod": stock["quoteBasis"],
        "notice": "Yahoo Finance 显示延迟报价；公司总市值为固定股数折算值，非数据商直接报出的市值。",
    }


if __name__ == "__main__":
    print(json.dumps(fetch_quotes(), ensure_ascii=False, indent=2))
