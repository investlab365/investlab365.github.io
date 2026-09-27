# 估值笔记 · GitHub Pages

首页按 A 股和美股 ADR 展示研究卡片；两只股票共用 `detail.html?symbol=...`、`stock-detail.js` 和 `stock-charts.js`。原来的 `hynix.html` 链接会跳转到统一详情页。**人工维护的股票资料集中在 `data/stocks.json`**；行情和历史 JSON 是接口自动生成的回退快照。

## 本地运行

```bash
python3 server.py
```

打开 <http://127.0.0.1:8765/>。首页和详情页载入时请求 `/api/quote?symbol=...`，此后每 60 秒及重新切回页面时刷新。详情页请求 `/api/history?symbol=...`，每 15 分钟重取历史日线。图表末点会用最新报价更新，历史线其余点仍是日收盘价；研究估值线只随人工评估版本变化。

市值位置量尺按数值线性定位：估值下沿至估值上沿占中间区间，绿色和红色向两侧连续延伸，分别表示更低和更高的市值。两侧默认各预留估值跨度的 35%；若行情超出预留范围，量尺会扩展以容纳行情，三个估值刻度和行情圆点始终使用同一比例。首页同时显示市值相对基准估值的差距；这些数字只反映所选盈利与 PE 模型。

本地服务将报价缓存 30 秒、历史数据缓存 15 分钟，避免同一时间多个页面重复请求。接口失败时返回上次成功的快照并标记“缓存行情”；直接使用普通静态 HTTP 服务时，页面读取保存的快照并标记“已保存快照”。**刷新频率不等于交易所逐笔实时行情**，请看每张卡片的报价时间。

| 市场 | 报价与历史接口 | 总市值口径 |
| --- | --- | --- |
| A 股 | [腾讯公开行情](https://qt.gtimg.cn/q=sz300308)及[日线接口](https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz300308,day,,,180,) | 报价页总市值，经 A 股价格 × 总股本核对；历史按当日股本计算 |
| 美股 ADR | [Yahoo Finance SKHY](https://finance.yahoo.com/quote/SKHY/) 的延迟美元报价及历史日线 | ADR 美元价格 × 普通股股数 ÷ 每 ADS 对应的普通股数，属于本站折算值 |

这些是公开、非交易所认证的接口，可能延迟、限流或中断。海力士使用[招股文件](https://www.sec.gov/Archives/edgar/data/2120882/000119312526299963/d32785d424b4.htm)发行后 **728,865,500** 股和 **1 ADS = 0.1 普通股**；后续回购会使固定股数折算市值与实际市值出现差异。页面不会把这一折算值说成数据商直接发布的市值。

## 增加股票与更新研究估值

在 `data/stocks.json` 的 `stocks` 数组增加一条记录，填写股票代码、市场、币种、展示文案、季度实际与预测利润、三档 PE、来源链接和估值日期。不需要再复制 HTML、JS 或 CSS。A 股还需提供按生效日期排列的 `shareSteps`，用于正确计算历史市值；美股 ADR 需提供普通股数和 ADS 比例。新增股票运行本地服务后自动生成自己的报价及历史回退快照。

研究数据与行情分开：季度财报或预测改变时，先把旧 `valuation` 版本放入 `priorValuations`，再更新当前四季利润、PE 和研究日期。走势图按版本日期切换估值线，缺少新评估时沿用最近一版。利润图默认显示最近四季，可切换全部季度；实际值与预测值分色，若存档有原预测则在实际柱上标虚线。

可用以下命令主动更新全部已收录股票的静态回退快照：

```bash
python3 refresh_quotes.py
python3 refresh_history.py
```

GitHub Pages 的快照由 GitHub Actions 每个工作日 **15:15（北京时间）**自动更新报价和历史日线。只有行情或历史数据发生变化时，Actions 才会提交 JSON 并重新部署页面；可以在 GitHub 的 Actions 页面手动运行同一工作流立即更新。行情接口可能延迟或不可用，页面仍以数据中的报价时间为准。

## 目前两只股票的研究口径

**中际旭创 300308.SZ**：用户提供 2026 Q3、Q4、2027 Q1、Q2 归母净利润预测 **95、130、155、180 亿元**，合计 **560 亿元**。基准预估 PE **26×**，估值下沿与上沿为基准市值 ±20%，对应 **11,648 / 14,560 / 17,472 亿元**。2026 Q1 实际值 **57.35 亿元**来自[一季报](https://static.cninfo.com.cn/finalpage/2026-04-17/1225111941.PDF)；Q2 **79.17 亿元**由[半年报](https://static.cninfo.com.cn/finalpage/2026-08-22/1225491753.PDF)的上半年累计减 Q1 得到。研究利润和 PE 并非公司指引。2026 年股本变化按公司公告生效日维护在 `shareSteps`。

**SK 海力士 SKHY**：2026 Q1、Q2 归母净利润取自[公司向 SEC 提交的业绩公告](https://www.sec.gov/Archives/edgar/data/2120882/000119312526321989/d115239d6k.htm)。未来四季季度营业利润路径来自[未来资产证券 2026-06-09 报告](https://securities.miraeasset.com/bbs/download/2145136.pdf?attachmentId=2145136)，本站按该报告年度归母净利润／营业利润比例换算季度归母净利润。**这不是机构直接发布的季度净利润，也不是市场一致预期**。Q2 一次性投资收益未外推到预测。研究 PE **5.6× / 7× / 8.4×** 为本站情景，并非机构直接给出的目标 PE。

海力士韩元研究输入及来源保留在 `data/stocks.json` 的 `sourceInputs` 中；美元展示固定采用[欧洲央行 2026-09-25 欧元兑美元](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-usd.en.html)及[欧元兑韩元](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/eurofxref-graph-krw.en.html)交叉汇率，约 **1 美元 = 1,355.05 韩元**。报价本身直接以美元获取，汇率不会用于计算 SKHY 的美元报价市值。

## 文件与发布

- `data/stocks.json`：全部股票的人工研究资料、估值版本和来源。
- `quotes.py`、`history.py`、`catalog.py`、`server.py`：本地行情适配、缓存与 API。
- `data/quotes.json`、`data/history.json`、`data/hynix-quote.json`、`data/hynix-history.json`：自动生成的回退快照；新股票使用 `data/cache/`。
- `index.html`、`detail.html`、`market.js`、`stock-detail.js`、`stock-charts.js`、`styles.css`：共用页面。

## GitHub Pages 部署

推送到 `main` 会触发 `.github/workflows/deploy.yml`，将页面和 `data/` 下的行情快照部署到 `https://investlab365.github.io/`。GitHub Pages 是静态托管，不能运行这里的 Python 行情服务；线上刷新按钮会读取已发布快照，不会在访客浏览器中直连行情接口。GitHub Actions 会在工作日下午 3:15（北京时间）抓取报价与历史日线、保存有变化的数据并部署页面。
