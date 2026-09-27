"use strict";

const el = id => document.getElementById(id);
const whole = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const sharesFormat = new Intl.NumberFormat("zh-CN");
const requestedSymbol = new URLSearchParams(location.search).get("symbol") || "300308.SZ";
let stock;
let quote;
let profitRange = "latest";

const set = (id, value) => { if (el(id)) el(id).textContent = value; };
const cap = value => `${whole.format(value)} ${stock.capUnit}`;
const price = value => `${stock.currencySymbol}${Number(value).toFixed(2)}`;
const quarterIndex = label => {
  const match = /^(\d{4}) Q([1-4])$/.exec(label);
  if (!match) throw new Error(`季度标签错误：${label}`);
  return Number(match[1]) * 4 + Number(match[2]);
};
async function getJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
function validateStock(item) {
  const v = item.valuation;
  if (!item.symbol || !["CNY", "USD"].includes(item.currency) ||
      v.quarters.length !== 4 || v.quarterLabels.length !== 4 ||
      v.scenarios.map(s => s.key).join(",") !== "low,base,high") throw new Error("研究数据格式错误");
  const order = v.quarterLabels.map(quarterIndex);
  if (order.some((q, i) => i && q !== order[i - 1] + 1)) throw new Error("预测季度不连续");
  const sum = v.quarters.reduce((a, b) => a + b, 0);
  const [low, base, high] = v.scenarios.map(s => s.marketCapYi);
  if (!(low < base && base < high)) throw new Error("估值区间顺序错误");
  if (!Number.isFinite(sum) || Math.abs(sum - v.forwardFourQuarterProfitYi) > 0.0001 ||
      v.scenarios.some(s => Math.abs(s.marketCapYi - sum * s.pe) > 0.0001)) throw new Error("估值计算不一致");
  for (const actual of v.actualQuarterProfits || []) {
    if (quarterIndex(actual.quarter) >= order[0] || !Number.isFinite(actual.profitYi)) throw new Error("实际季度错误");
  }
  return sum;
}
function valuationScale(current) {
  const [low, base, high] = stock.valuation.scenarios.map(s => s.marketCapYi);
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
function renderProfitBars() {
  const v = stock.valuation;
  const revisions = [...(v.priorValuations || [])].sort((a, b) => b.researchDate.localeCompare(a.researchDate));
  const actuals = (v.actualQuarterProfits || []).map(item => {
    const former = revisions.find(snapshot => snapshot.quarterLabels.includes(item.quarter));
    const index = former?.quarterLabels.indexOf(item.quarter) ?? -1;
    return { ...item, type: "actual", formerForecast: index >= 0 ? former.quarters[index] : null };
  });
  const forecasts = v.quarterLabels.map((quarter, i) => ({ quarter, profitYi: v.quarters[i], type: "forecast" }));
  const all = [...actuals, ...forecasts].sort((a, b) => quarterIndex(a.quarter) - quarterIndex(b.quarter));
  const visible = profitRange === "all" ? all : all.slice(-4);
  const max = Math.max(...all.flatMap(item => item.formerForecast === null || item.formerForecast === undefined ? [item.profitYi] : [item.profitYi, item.formerForecast]));
  set("profit-panel-title", `${visible[0].quarter}—${visible.at(-1).quarter} 归母净利润`);
  document.querySelectorAll("[data-profit-range]").forEach(button => button.classList.toggle("selected", button.dataset.profitRange === profitRange));
  const root = el("profit-bars"); root.replaceChildren();
  for (const item of visible) {
    const group = document.createElement("div"); group.className = `profit-quarter ${item.type}`;
    group.title = `${item.quarter} · ${item.type === "actual" ? "公司披露" : stock.forecastNote} · ${precise.format(item.profitYi)} ${stock.profitUnit}${item.formerForecast != null ? `；原预测 ${precise.format(item.formerForecast)} ${stock.profitUnit}` : ""}`;
    const plot = document.createElement("div"); plot.className = "profit-plot";
    const bar = document.createElement("span"); bar.className = `profit-column ${item.type}`;
    const height = Math.max(8, Math.round(130 * item.profitYi / max)); bar.style.height = `${height}px`;
    const number = document.createElement("span"); number.className = "profit-number"; number.style.bottom = `${height + 7}px`; number.textContent = whole.format(item.profitYi);
    plot.append(bar, number);
    if (item.formerForecast != null) {
      const marker = document.createElement("span"); marker.className = "profit-forecast-marker";
      marker.style.bottom = `${Math.round(130 * item.formerForecast / max)}px`; plot.appendChild(marker);
    }
    const label = document.createElement("small"); label.textContent = item.quarter;
    const kind = document.createElement("small"); kind.className = `profit-kind ${item.type}`; kind.textContent = item.type === "actual" ? "实际" : "预测";
    group.append(plot, label, kind); root.appendChild(group);
  }
  const legend = el("profit-legend"); legend.replaceChildren();
  for (const type of ["actual", "forecast"]) {
    if (!visible.some(item => item.type === type)) continue;
    const entry = document.createElement("span"); entry.className = type;
    const dot = document.createElement("i"); const label = document.createElement("span");
    label.textContent = type === "actual" ? "实际 · 公司披露" : `预测 · ${stock.forecastNote}`;
    entry.append(dot, label); legend.appendChild(entry);
  }
  if (visible.some(item => item.formerForecast != null)) {
    const entry = document.createElement("span"); entry.className = "former-forecast";
    const dash = document.createElement("i"); const label = document.createElement("span"); label.textContent = "虚线 · 原预测";
    entry.append(dash, label); legend.appendChild(entry);
  }
}
function renderStock(item) {
  const sum = validateStock(item);
  stock = item;
  const v = item.valuation;
  const period = `${v.quarterLabels[0]}—${v.quarterLabels.at(-1)}`;
  document.title = `${item.name}估值研究 · 估值笔记`;
  document.body.classList.toggle("us-stock", item.marketKey === "us");
  el("nav-a").classList.toggle("active", item.marketKey === "a");
  el("nav-us").classList.toggle("active", item.marketKey === "us");
  const marketHref = `./index.html#${item.marketKey}-market`;
  el("market-crumb").href = marketHref; el("back-link").href = marketHref;
  const pool = item.marketKey === "us" ? "美股研究池" : "A 股研究池";
  set("market-crumb", pool); set("crumb-name", item.name);
  set("back-link", `← 返回 ${pool}`); set("stock-eyebrow", `EQUITY RESEARCH · ${item.symbol}`);
  set("stock-name", item.name); set("stock-market", item.market); set("stock-intro", item.intro);
  set("valuation-note", `${item.researchNote} ${item.quoteBasis}`.replace(/。\s+/g, "。"));
  set("valuation-title", `${item.name} · 未来四个财报季度估值`);
  set("profit-kicker", item.forecastNote + " · 未来约 12 个月归母净利润");
  set("forward-profit", `${whole.format(sum)} ${item.profitUnit}`);
  set("forecast-period", `${period} · ${v.quarters.map(q => whole.format(q)).join(" + ")} ${item.profitUnit}`);
  set("price-kicker", item.priceLabel); set("shares-kicker", item.sharesLabel); set("shares-note", item.shareNote);
  set("cap-kicker", item.capLabel); set("chart-unit", `单位：${item.capUnit}`);
  set("chart-title", item.chartLabel); set("market-legend", item.capLabel);
  el("market-history-chart").setAttribute("aria-label", `${item.capLabel}与三档研究估值线`);
  set("profit-unit", `单位：${item.profitUnit}`); set("quote-title", `${item.symbol} 行情`);
  set("quote-price-label", item.priceLabel); set("quote-shares-label", item.sharesLabel);
  set("quote-cap-label", item.capLabel); set("heatmap-period", `横轴：${period} 归母净利润合计（${item.profitUnit}）；纵轴：研究 PE`);
  set("method-valuation", `${period} 归母净利润预计 ${precise.format(sum)} ${item.profitUnit}。估值下沿、基准估值、估值上沿的 PE 分别为 ${v.scenarios.map(s => `${s.pe}×`).join("、")}，对应研究市值 ${v.scenarios.map(s => cap(s.marketCapYi)).join("、")}。${item.forecastNote}。`);
  set("method-actuals", `已披露归母净利润：${v.actualQuarterProfits.map(a => `${a.quarter} ${precise.format(a.profitYi)} ${item.profitUnit}`).join("、")}。${item.methodActuals}实际季度不计入前瞻估值。`);
  set("method-market", item.quoteBasis); set("method-history", item.historyBasis);
  set("method-extra", item.fx ? `美元换算采用 ${item.fx.date} 固定参考汇率：1 美元约 ${precise.format(item.fx.wonPerUsd)} 韩元。报价由数据接口返回，后续回购可能改变实际股数。` : "公开行情接口可能延迟或中断；以页面显示的报价时间为准。");
  const sources = el("source-list"); sources.replaceChildren("来源：");
  item.sources.forEach(source => { const a = document.createElement("a"); a.href = source.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = `${source.label} ↗`; sources.appendChild(a); });
  renderProfitBars();
  const root = el("scenarios"); root.replaceChildren();
  for (const scenario of v.scenarios) {
    const card = document.createElement("article"); card.className = `panel scenario ${scenario.key}`;
    const head = document.createElement("div"); head.className = "scenario-headline";
    const name = document.createElement("b"); name.textContent = scenario.label;
    const pe = document.createElement("span"); pe.textContent = `${scenario.pe}× 预估 PE · 研究假设`; head.append(name, pe);
    const value = document.createElement("strong"); value.textContent = cap(scenario.marketCapYi);
    card.append(head, value);
    if (item.adsRatio) {
      const adr = document.createElement("p"); adr.className = "scenario-adr-value";
      adr.textContent = `模型对应 ${price(scenario.marketCapYi * 1e8 * item.adsRatio / item.shares)} / ADR`;
      card.appendChild(adr);
    }
    const formula = document.createElement("p"); formula.textContent = `${precise.format(sum)} ${item.profitUnit} × ${scenario.pe} 倍`;
    const relative = document.createElement("div"); relative.className = "vs-current missing"; relative.dataset.scenario = scenario.key; relative.textContent = "等待行情比较";
    card.append(formula, relative); root.appendChild(card);
  }
  document.dispatchEvent(new CustomEvent("stock-ready", { detail: item }));
  if (quote) renderQuote(quote, "已保存快照");
}
function renderQuote(data, mode) {
  if (!stock || data.symbol !== stock.symbol || data.currency !== stock.currency ||
      !Number.isFinite(data.price) || !Number.isFinite(data.marketCapYi) || !Number.isFinite(data.shares) || !data.quoteTime)
    throw new Error("行情格式错误");
  quote = data;
  const label = data.stale ? "缓存行情" : mode;
  const current = data.marketCapYi;
  const [low, base, high] = stock.valuation.scenarios.map(s => s.marketCapYi);
  const position = current < low ? "低于估值下沿" : current < base ? "估值区间下半段" : current <= high ? "估值区间上半段" : "高于估值上沿";
  const difference = (current / base - 1) * 100;
  const gap = Math.abs(difference) < .05 ? "接近基准估值" : `较基准${difference < 0 ? "低" : "高"} ${Math.abs(difference).toFixed(1)}%`;
  set("a-price", price(data.price)); set("quote-a-price", price(data.price));
  set("total-shares", `${(data.shares / 1e8).toFixed(3)} 亿股`); set("quote-shares", `${sharesFormat.format(data.shares)} 股`);
  set("cap-second", cap(current)); set("total-cap", cap(current));
  set("a-time", `报价时间：${data.quoteTime}（${data.timezone === "Asia/Shanghai" ? "北京时间" : "纽约时间"}）`);
  set("cap-time", `${label} · ${data.quoteTime}`);
  set("quote-status", `${label} · ${data.quoteTime}。${data.notice || stock.quoteBasis}`);
  set("position-caption", `${label}市值 ${cap(current)} · ${position} · ${gap}`);
  const scale = valuationScale(current);
  const track = document.querySelector(".detail-track");
  for (const point of ["low", "base", "high"]) track.style.setProperty(`--${point}-pct`, `${scale[point]}%`);
  const marker = el("detail-current");
  marker.style.left = `${scale.current}%`;
  marker.style.setProperty("--marker-tone", markerTone(scale));
  marker.hidden = false;
  for (const point of ["low", "base", "high"]) el(`${point}-tick`).style.left = `${scale[point]}%`;
  for (const scenario of stock.valuation.scenarios) {
    const relative = document.querySelector(`[data-scenario="${scenario.key}"]`);
    relative.classList.remove("missing");
    const pct = (scenario.marketCapYi / current - 1) * 100;
    relative.textContent = `相对${label}市值 ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  }
  document.dispatchEvent(new CustomEvent("quote-ready", { detail: data }));
}
async function refreshQuote() {
  const button = el("refresh"); button.disabled = true; button.textContent = "更新中…";
  try {
    let data, mode;
    try { data = await getJson(`./api/quote?symbol=${encodeURIComponent(stock.symbol)}&t=${Date.now()}`); mode = "接口行情"; }
    catch {
      const file = stock.symbol === "SKHY" ? "./data/hynix-quote.json" :
        stock.symbol === "300308.SZ" ? "./data/quotes.json" : `./data/cache/${stock.symbol}.quote.json`;
      data = await getJson(file); mode = "已保存快照";
    }
    renderQuote(data, mode);
  } catch (error) {
    set("quote-status", `行情暂不可用：${error.message}。研究估值仍可查看。`);
  } finally { button.disabled = false; button.textContent = "刷新行情 ↻"; }
}
async function start() {
  try {
    const catalog = await getJson("./data/stocks.json");
    const selected = catalog.stocks.find(item => item.symbol === requestedSymbol);
    if (!selected) throw new Error(`未收录股票 ${requestedSymbol}`);
    renderStock(selected);
  } catch (error) { set("quote-status", `研究数据载入失败：${error.message}`); return; }
  document.querySelectorAll("[data-profit-range]").forEach(button => button.addEventListener("click", () => { profitRange = button.dataset.profitRange; renderProfitBars(); }));
  el("refresh").addEventListener("click", refreshQuote);
  await refreshQuote();
  window.setInterval(refreshQuote, 60_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshQuote(); });
}
start();
