"use strict";

const chartSvg = document.getElementById("market-history-chart");
const chartTooltip = document.getElementById("history-tooltip");
const chartNS = "http://www.w3.org/2000/svg";
const formatYi = value => `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value)} ${chartStock?.capUnit || "亿"}`;
let chartStock;
let chartValuation;
let chartQuote;
let chartHistory;
let chartRange = "3M";
let chartPoints = [];
let hoverGuide;
let hoverDot;
let selectedCell = null;
let historyMode = "已保存历史快照";
let valuationRevisions = [];

function valuationAt(date) {
  let selected = valuationRevisions[0];
  for (const revision of valuationRevisions) {
    if (revision.researchDate > date) break;
    selected = revision;
  }
  return selected;
}

function svgElement(tag, attributes = {}, parent = chartSvg) {
  const node = document.createElementNS(chartNS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  parent.appendChild(node);
  return node;
}

function chartText(x, y, value, attributes = {}) {
  const node = svgElement("text", { x, y, ...attributes });
  node.textContent = value;
  return node;
}

function drawChart() {
  if (!chartValuation || !chartHistory?.points?.length) return;
  chartSvg.replaceChildren();
  chartTooltip.hidden = true;
  const months = Number(chartRange.slice(0, -1));
  const lastCloseDate = chartHistory.points.at(-1).date;
  const quoteDate = chartQuote?.quoteTime?.slice(0, 10);
  const useQuote = quoteDate && quoteDate >= lastCloseDate && Number.isFinite(chartQuote.marketCapYi);
  const lastMarketDate = useQuote ? quoteDate : lastCloseDate;
  const endDate = lastMarketDate > chartValuation.researchDate ? lastMarketDate : chartValuation.researchDate;
  const endTime = Date.parse(`${endDate}T00:00:00Z`);
  const startDate = new Date(endTime);
  startDate.setUTCMonth(startDate.getUTCMonth() - months);
  const startTime = startDate.getTime();
  const startIso = startDate.toISOString().slice(0, 10);
  const points = chartHistory.points.filter(item => item.date >= startIso && item.date <= lastMarketDate).map(item => ({ ...item }));
  if (useQuote) {
    const latest = { date: quoteDate, close: chartQuote.price, shares: chartQuote.shares,
      marketCapYi: chartQuote.marketCapYi, live: true };
    if (points.at(-1)?.date === quoteDate) points[points.length - 1] = latest;
    else points.push(latest);
  }
  if (!points.length) {
    chartPoints = [];
    document.getElementById("history-status").textContent = "所选时间范围内没有收盘数据。";
    return;
  }
  const updates = valuationRevisions.filter(item => item.researchDate > startIso && item.researchDate <= endDate);
  const boundaries = [startIso, ...updates.map(item => item.researchDate), endDate];
  const segments = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    if (boundaries[index] === boundaries[index + 1]) continue;
    segments.push({
      from: boundaries[index],
      to: boundaries[index + 1],
      valuation: valuationAt(boundaries[index]),
      borrowed: boundaries[index] < valuationRevisions[0].researchDate,
    });
  }
  const fallbackNote = startIso < valuationRevisions[0].researchDate
    ? `首份评估 ${valuationRevisions[0].researchDate} 之前借用该版作历史对照，非当时已有评估。`
    : "";
  document.getElementById("history-status").textContent = `${historyMode} · ${months} 个月视图：${startIso} 至 ${endDate}，${points.length} 个交易日${useQuote ? `；末点按 ${chartQuote.quoteTime} 最新报价更新` : `；历史收盘截至 ${lastCloseDate}`}。${fallbackNote}`;
  const visibleCaps = [...points.map(item => item.marketCapYi), ...segments.flatMap(item => item.valuation.scenarios.map(scenario => scenario.marketCapYi)), ...valuationAt(endDate).scenarios.map(item => item.marketCapYi)];
  const min = Math.floor(Math.min(...visibleCaps) * 0.94 / 1000) * 1000;
  const max = Math.ceil(Math.max(...visibleCaps) * 1.06 / 1000) * 1000;
  const y = value => 305 - (value - min) / (max - min) * 265;
  const x = date => 65 + (Date.parse(`${date}T00:00:00Z`) - startTime) / (endTime - startTime) * 803;
  chartPoints = points.map(item => ({ ...item, x: x(item.date), y: y(item.marketCapYi) }));
  const defs = svgElement("defs");
  const gradient = svgElement("linearGradient", { id: "research-band", x1: "0", x2: "0", y1: "0", y2: "1" }, defs);
  svgElement("stop", { offset: "0%", "stop-color": "#e7958b" }, gradient);
  svgElement("stop", { offset: "50%", "stop-color": "#f0d56d" }, gradient);
  svgElement("stop", { offset: "100%", "stop-color": "#91cf9e" }, gradient);

  for (let index = 0; index <= 4; index++) {
    const value = min + (max - min) * index / 4;
    const yy = y(value);
    svgElement("line", { x1: 65, x2: 868, y1: yy, y2: yy, stroke: "#e8eeea", "stroke-width": 1 });
    chartText(53, yy + 4, new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value), { "text-anchor": "end", fill: "#9aac9e", "font-size": 11 });
  }
  for (const segment of segments) {
    const [low, , high] = segment.valuation.scenarios.map(item => item.marketCapYi);
    svgElement("rect", { x: x(segment.from), y: y(high), width: x(segment.to) - x(segment.from), height: y(low) - y(high), fill: "url(#research-band)", "fill-opacity": segment.borrowed ? 0.08 : 0.18 });
  }
  const lineStyles = [["#52a673", "5 5"], ["#d9ad39", "7 4"], ["#d67b73", "5 5"]];
  lineStyles.forEach(([color, dash], index) => {
    let previousValue;
    for (const segment of segments) {
      const value = segment.valuation.scenarios[index].marketCapYi;
      if (previousValue !== undefined && previousValue !== value) {
        svgElement("line", { x1: x(segment.from), x2: x(segment.from), y1: y(previousValue), y2: y(value), stroke: color, "stroke-width": 1.8 });
      }
      svgElement("line", { x1: x(segment.from), x2: x(segment.to), y1: y(value), y2: y(value), stroke: color, "stroke-width": index === 1 ? 2.3 : 1.8, "stroke-dasharray": dash, "stroke-opacity": segment.borrowed ? 0.55 : 1 });
      previousValue = value;
    }
    const endValue = valuationAt(endDate).scenarios[index].marketCapYi;
    if (previousValue !== undefined && previousValue !== endValue) {
      svgElement("line", { x1: 868, x2: 868, y1: y(previousValue), y2: y(endValue), stroke: color, "stroke-width": 1.8 });
    }
  });
  for (const update of updates) {
    const markerX = x(update.researchDate);
    svgElement("line", { x1: markerX, x2: markerX, y1: 38, y2: 305, stroke: "#a8b9ae", "stroke-width": 1, "stroke-dasharray": "3 6", "stroke-opacity": 0.65 });
    chartText(markerX > 790 ? markerX - 4 : markerX + 4, 351, `${update.researchDate.slice(5)} 评估`, { "text-anchor": markerX > 790 ? "end" : "start", fill: "#748d7d", "font-size": 10 });
  }
  const latestVisible = valuationAt(endDate);
  const [lowScenario, baseScenario, highScenario] = latestVisible.scenarios;
  chartText(858, y(highScenario.marketCapYi) - 8, `${highScenario.label} · 预估 PE ${highScenario.pe}× · ${formatYi(highScenario.marketCapYi)}`, { fill: "#b9635e", "font-size": 11, "font-weight": 700, "text-anchor": "end" });
  chartText(858, y(baseScenario.marketCapYi) - 8, `${baseScenario.label} · 预估 PE ${baseScenario.pe}× · ${formatYi(baseScenario.marketCapYi)}`, { fill: "#ad852d", "font-size": 11, "font-weight": 700, "text-anchor": "end" });
  chartText(858, y(lowScenario.marketCapYi) - 8, `${lowScenario.label} · 预估 PE ${lowScenario.pe}× · ${formatYi(lowScenario.marketCapYi)}`, { fill: "#40895f", "font-size": 11, "font-weight": 700, "text-anchor": "end" });
  chartText(858, 23, `最新研究评估 · ${chartValuation.researchDate}`, { fill: "#9cae9e", "font-size": 10, "text-anchor": "end" });

  const path = chartPoints.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  svgElement("path", { d: path, fill: "none", stroke: "#128471", "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" });
  const last = chartPoints.at(-1);
  svgElement("circle", { cx: last.x, cy: last.y, r: 8, fill: "#d8eee5" });
  svgElement("circle", { cx: last.x, cy: last.y, r: 4, fill: "#128471", stroke: "#fff", "stroke-width": 1.5 });
  if (last.live) chartText(last.x > 770 ? last.x - 11 : last.x + 11, last.y - 10,
    "最新报价", { "text-anchor": last.x > 770 ? "end" : "start", fill: "#128471", "font-size": 10, "font-weight": 700 });
  for (let index = 0; index <= 4; index++) {
    const date = new Date(startTime + (endTime - startTime) * index / 4);
    const label = `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}`;
    chartText(65 + 803 * index / 4, 331, label, { "text-anchor": index === 0 ? "start" : index === 4 ? "end" : "middle", fill: "#9aac9e", "font-size": 11 });
  }
  hoverGuide = svgElement("line", { x1: 0, x2: 0, y1: 38, y2: 305, stroke: "#9bbbaa", "stroke-dasharray": "4 4", visibility: "hidden" });
  hoverDot = svgElement("circle", { cx: 0, cy: 0, r: 5, fill: "#128471", stroke: "#fff", "stroke-width": 2, visibility: "hidden" });
}

function chartHover(event) {
  if (!chartPoints.length) return;
  const bounds = chartSvg.getBoundingClientRect();
  const svgX = (event.clientX - bounds.left) / bounds.width * 900;
  if (svgX < chartPoints[0].x - 8 || svgX > 876) {
    chartTooltip.hidden = true;
    hoverGuide?.setAttribute("visibility", "hidden");
    hoverDot?.setAttribute("visibility", "hidden");
    return;
  }
  const point = chartPoints.reduce((closest, item) => Math.abs(item.x - svgX) < Math.abs(closest.x - svgX) ? item : closest);
  hoverGuide.setAttribute("x1", point.x);
  hoverGuide.setAttribute("x2", point.x);
  hoverGuide.setAttribute("visibility", "visible");
  hoverDot.setAttribute("cx", point.x);
  hoverDot.setAttribute("cy", point.y);
  hoverDot.setAttribute("visibility", "visible");
  const valuation = valuationAt(point.date);
  const [low, base, high] = valuation.scenarios;
  const borrowed = point.date < valuationRevisions[0].researchDate ? "（借作历史对照）" : "";
  chartTooltip.textContent = `${point.date} · ${chartStock.capLabel} ${formatYi(point.marketCapYi)} · ${point.live ? "最新报价" : "收盘"} ${chartStock.currencySymbol}${point.close.toFixed(2)} · 总股本 ${new Intl.NumberFormat("zh-CN").format(point.shares)} 股 · 评估 ${valuation.researchDate}${borrowed}：${low.label} ${formatYi(low.marketCapYi)} / ${base.label} ${formatYi(base.marketCapYi)} / ${high.label} ${formatYi(high.marketCapYi)}`;
  chartTooltip.hidden = false;
  chartTooltip.style.left = `${Math.max(8, Math.min(chartSvg.clientWidth - 295, point.x / 900 * bounds.width + 12))}px`;
  chartTooltip.style.top = `${Math.max(12, point.y / 380 * bounds.height - 70)}px`;
}

function selectCell(button, profit, pe) {
  document.querySelectorAll(".heat-cell").forEach(cell => cell.classList.toggle("selected", cell === button));
  selectedCell = { button, profit, pe };
  document.getElementById("selected-value").textContent = formatYi(profit * pe);
  document.getElementById("selected-profit").textContent = `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(profit)} ${chartStock.profitUnit}`;
  document.getElementById("selected-pe").textContent = `${pe} ×`;
  document.getElementById("selected-upside").textContent = chartQuote ? `${((profit * pe / chartQuote.marketCapYi - 1) * 100).toFixed(1)}%` : "等待行情快照";
  syncInsightColor();
}

function syncInsightColor() {
  const color = selectedCell?.button.style.background;
  if (!color) return;
  const panel = document.getElementById("selected-scenario");
  panel.style.backgroundColor = color;
  panel.style.borderColor = color;
  const textColor = window.getComputedStyle(selectedCell.button).color;
  panel.style.color = textColor;
  panel.querySelectorAll("*").forEach(element => { element.style.color = textColor; });
}

function paintHeatmap() {
  const current = chartQuote?.marketCapYi;
  const cells = [...document.querySelectorAll(".heat-cell")];
  const values = cells.map(cell => Number(cell.dataset.value));
  if (!values.length) return;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const blend = (from, to, amount) => from.map((part, index) => Math.round(part + (to[index] - part) * amount));
  const green = [127, 205, 150];
  const yellow = [242, 214, 107];
  const red = [225, 128, 124];
  cells.forEach(cell => {
    const position = (Number(cell.dataset.value) - low) / (high - low);
    const rgb = position <= 0.5 ? blend(green, yellow, position * 2) : blend(yellow, red, (position - 0.5) * 2);
    cell.style.background = `rgb(${rgb.join(",")})`;
  });
  syncInsightColor();
  if (selectedCell) {
    document.getElementById("selected-upside").textContent = current ? `${((selectedCell.profit * selectedCell.pe / current - 1) * 100).toFixed(1)}%` : "等待行情快照";
  }
}

function buildHeatmap() {
  if (!chartValuation) return;
  const root = document.getElementById("heatmap");
  root.replaceChildren();
  const forward = chartValuation.forwardFourQuarterProfitYi;
  const profits = [Math.round(forward * 0.7), Math.round(forward * 0.85), forward, Math.round(forward * 1.15), Math.round(forward * 1.3)];
  const pe = chartValuation.scenarios[1].pe;
  const multiples = chartValuation.heatmapPe;
  const corner = document.createElement("span");
  corner.className = "heat-corner";
  corner.textContent = "PE ↓ / 利润 →";
  root.appendChild(corner);
  profits.forEach(profit => {
    const head = document.createElement("span");
    head.className = "heat-head";
    head.textContent = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(profit);
    root.appendChild(head);
  });
  multiples.forEach(multiple => {
    const head = document.createElement("span");
    head.className = "heat-row-head";
    head.textContent = `${multiple}×`;
    root.appendChild(head);
    profits.forEach(profit => {
      const target = profit * multiple;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "heat-cell";
      button.dataset.value = String(target);
      button.textContent = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(target);
      button.setAttribute("aria-label", `利润 ${profit.toFixed(2)} ${chartStock.profitUnit}，PE ${multiple} 倍，估值 ${formatYi(target)}`);
      button.addEventListener("click", () => selectCell(button, profit, multiple));
      root.appendChild(button);
      if (profit === forward && multiple === pe) selectCell(button, profit, multiple);
    });
  });
  paintHeatmap();
}

async function loadHistory() {
  let data, mode;
  try {
    const response = await fetch(`./api/history?symbol=${encodeURIComponent(chartStock.symbol)}&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    mode = data.stale ? "缓存历史" : "接口历史";
  } catch {
    const file = chartStock.symbol === "SKHY" ? "./data/hynix-history.json" :
      chartStock.symbol === "300308.SZ" ? "./data/history.json" : `./data/cache/${chartStock.symbol}.history.json`;
    const response = await fetch(`${file}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    mode = "已保存历史快照";
  }
  if (data.symbol !== chartStock.symbol || !Array.isArray(data.points) || data.points.length < 20)
    throw new Error("历史行情格式错误");
  for (let i = 0; i < data.points.length; i++) {
    const point = data.points[i];
    if (i && point.date <= data.points[i - 1].date) throw new Error("交易日期顺序错误");
    if (!Number.isFinite(point.close) || !Number.isFinite(point.marketCapYi)) throw new Error("历史价格或市值错误");
  }
  chartHistory = data;
  historyMode = mode;
  drawChart();
}

chartSvg.addEventListener("pointermove", chartHover);
chartSvg.addEventListener("pointerleave", () => {
  chartTooltip.hidden = true;
  hoverGuide?.setAttribute("visibility", "hidden");
  hoverDot?.setAttribute("visibility", "hidden");
});
document.querySelectorAll("[data-range]").forEach(button => button.addEventListener("click", () => {
  chartRange = button.dataset.range;
  document.querySelectorAll("[data-range]").forEach(other => other.classList.toggle("selected", button === other));
  drawChart();
}));
document.addEventListener("stock-ready", event => {
  chartStock = event.detail;
  chartValuation = chartStock.valuation;
  valuationRevisions = [...(chartValuation.priorValuations || []), chartValuation].sort((a, b) => a.researchDate.localeCompare(b.researchDate));
  const [low, base, high] = chartValuation.scenarios;
  document.getElementById("legend-low").lastChild.textContent = ` ${low.label} · 预估 PE ${low.pe}×`;
  document.getElementById("legend-base").lastChild.textContent = ` ${base.label} · 预估 PE ${base.pe}×`;
  document.getElementById("legend-high").lastChild.textContent = ` ${high.label} · 预估 PE ${high.pe}×`;
  buildHeatmap();
  loadHistory().catch(() => { document.getElementById("history-status").textContent = "历史收盘暂不可用，请检查接口或保存快照。"; });
});
document.addEventListener("quote-ready", event => {
  chartQuote = event.detail;
  paintHeatmap();
  drawChart();
});
window.setInterval(() => { if (chartStock) loadHistory().catch(() => {}); }, 15 * 60_000);
