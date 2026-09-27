"use strict";

const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const refreshButton = document.getElementById("refresh");
let stocks = [];

async function json(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function cap(stock, value) { return `${number.format(value)} ${stock.capUnit}`; }
function valuationScale(low, base, high, current) {
  const span = high - low;
  const min = Math.min(low - span * .35, current - span * .08);
  const max = Math.max(high + span * .35, current + span * .08);
  const percent = value => (value - min) / (max - min) * 100;
  return { low: percent(low), base: percent(base), high: percent(high), current: percent(current) };
}
function markerTone(scale) {
  // These stops match the linear gradient in styles.css.
  const stops = [[0, [131, 207, 164]], [scale.low, [93, 187, 147]],
    [scale.base, [244, 212, 102]], [scale.high, [215, 126, 125]], [100, [231, 149, 145]]];
  const value = Math.max(0, Math.min(100, scale.current));
  const right = Math.max(1, stops.findIndex(([position]) => position >= value));
  const [from, start] = stops[right - 1];
  const [to, end] = stops[right];
  const ratio = (value - from) / (to - from);
  return `rgb(${start.map((channel, i) => Math.round(channel + (end[i] - channel) * ratio)).join(", ")})`;
}
function position(stock, value) {
  const [low, base, high] = stock.valuation.scenarios.map(s => s.marketCapYi);
  const label = value < low ? "低于估值下沿" : value < base ? "估值区间下半段" : value <= high ? "估值区间上半段" : "高于估值上沿";
  const difference = (value / base - 1) * 100;
  const gap = Math.abs(difference) < .05 ? "接近基准估值" : `较基准${difference < 0 ? "低" : "高"} ${Math.abs(difference).toFixed(1)}%`;
  return { label, gap, scale: valuationScale(low, base, high, value) };
}
function card(stock) {
  const link = document.createElement("a");
  link.className = "panel stock-card";
  link.href = `./detail.html?symbol=${encodeURIComponent(stock.symbol)}`;
  link.setAttribute("aria-label", `打开 ${stock.name}估值详情`);
  link.dataset.symbol = stock.symbol;
  const identity = document.createElement("div"); identity.className = "stock-identity";
  const avatar = document.createElement("span"); avatar.className = "stock-avatar"; avatar.textContent = stock.avatar;
  const info = document.createElement("div");
  const sector = document.createElement("span"); sector.className = "sector-label"; sector.textContent = stock.sector;
  const title = document.createElement("h2"); title.textContent = stock.name;
  const ticker = document.createElement("small"); ticker.textContent = `${stock.symbol} · ${stock.market}`; title.appendChild(ticker);
  const subtitle = document.createElement("p"); subtitle.textContent = `${stock.capLabel}位置`;
  info.append(sector, title, subtitle); identity.append(avatar, info);
  const value = document.createElement("div"); value.className = "stock-value";
  const heading = document.createElement("span"); heading.textContent = `${stock.capLabel} `;
  const status = document.createElement("small"); status.className = "quote-label"; status.textContent = "加载行情中"; heading.appendChild(status);
  const amount = document.createElement("strong"); amount.className = "market-cap"; amount.textContent = "—";
  const relation = document.createElement("small"); relation.className = "relative-position"; relation.textContent = "等待行情";
  const gap = document.createElement("small"); gap.className = "relative-gap";
  const time = document.createElement("small"); time.className = "market-time"; time.textContent = "";
  value.append(heading, amount, relation, gap, time);
  const mini = document.createElement("div"); mini.className = "mini-position";
  const labels = document.createElement("div"); labels.className = "mini-labels";
  stock.valuation.scenarios.forEach(scenario => { const span = document.createElement("span"); span.textContent = scenario.label; labels.appendChild(span); });
  const track = document.createElement("div"); track.className = "gradient-track";
  const marker = document.createElement("span"); marker.className = "gradient-marker"; marker.hidden = true; track.appendChild(marker);
  const foot = document.createElement("div"); foot.className = "mini-foot";
  stock.valuation.scenarios.forEach(s => { const span = document.createElement("span"); span.textContent = cap(stock, s.marketCapYi); foot.appendChild(span); });
  mini.append(labels, track, foot);
  const arrow = document.createElement("span"); arrow.className = "stock-arrow"; arrow.setAttribute("aria-hidden", "true"); arrow.textContent = "↗";
  link.append(identity, value, mini, arrow);
  return link;
}
async function refreshStock(stock) {
  const element = document.querySelector(`[data-symbol="${stock.symbol}"]`);
  if (!element) return;
  const status = element.querySelector(".quote-label");
  try {
    let data, mode;
    try { data = await json(`./api/quote?symbol=${encodeURIComponent(stock.symbol)}&t=${Date.now()}`); mode = data.stale ? "缓存行情" : "接口行情"; }
    catch {
      const file = stock.symbol === "SKHY" ? "./data/hynix-quote.json" :
        stock.symbol === "300308.SZ" ? "./data/quotes.json" : `./data/cache/${stock.symbol}.quote.json`;
      data = await json(file); mode = "已保存快照";
    }
    if (data.symbol !== stock.symbol || data.currency !== stock.currency || !Number.isFinite(data.marketCapYi)) throw new Error("行情格式错误");
    const location = position(stock, data.marketCapYi);
    status.textContent = mode;
    element.querySelector(".market-cap").textContent = cap(stock, data.marketCapYi);
    element.querySelector(".relative-position").textContent = location.label;
    element.querySelector(".relative-gap").textContent = location.gap;
    element.querySelector(".market-time").textContent = `报价：${data.quoteTime}（${data.timezone === "Asia/Shanghai" ? "北京时间" : "纽约时间"}）`;
    const mini = element.querySelector(".mini-position");
    for (const point of ["low", "base", "high"]) mini.style.setProperty(`--${point}-pct`, `${location.scale[point]}%`);
    const marker = element.querySelector(".gradient-marker");
    marker.style.left = `${location.scale.current}%`;
    marker.style.setProperty("--marker-tone", markerTone(location.scale));
    marker.setAttribute("aria-label", `${cap(stock, data.marketCapYi)}，${location.label}`);
    marker.hidden = false;
  } catch {
    status.textContent = "行情暂不可用";
    element.querySelector(".relative-position").textContent = "研究估值仍可查看";
  }
}
async function refreshAll() {
  refreshButton.disabled = true; refreshButton.textContent = "更新中…";
  await Promise.allSettled(stocks.map(refreshStock));
  refreshButton.disabled = false; refreshButton.textContent = "刷新全部行情 ↻";
}
async function start() {
  try {
    stocks = (await json("./data/stocks.json")).stocks;
    for (const key of ["a", "us"]) {
      const root = document.getElementById(`${key}-cards`); root.replaceChildren();
      stocks.filter(stock => stock.marketKey === key).forEach(stock => root.appendChild(card(stock)));
    }
  } catch {
    document.getElementById("a-cards").textContent = "研究数据暂不可用";
    document.getElementById("us-cards").textContent = "研究数据暂不可用";
    return;
  }
  refreshButton.addEventListener("click", refreshAll);
  await refreshAll();
  window.setInterval(refreshAll, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshAll(); });
}
start();
