const fs = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { fetchAStockDataEnrichment } = require('./a-stock-data-adapter');
const { validateDailyMarketData } = require('./market-schema');

const GBK_DECODER = new TextDecoder('gbk');
const MARKET_BREADTH_PAGE_SIZE = 200;
const EASTMONEY_BASE_URLS = [
  'https://push2.eastmoney.com/api/qt/clist/get',
  'https://82.push2.eastmoney.com/api/qt/clist/get',
  'https://16.push2.eastmoney.com/api/qt/clist/get',
  'http://push2.eastmoney.com/api/qt/clist/get',
];

const INDEX_CODES = [
  { name: '上证指数', code: 'sh000001' },
  { name: '深证成指', code: 'sz399001' },
  { name: '创业板指', code: 'sz399006' },
  { name: '科创50', code: 'sh000688' },
];

const TRACKED_STOCKS = [
  ['中国卫星', '600118'],
  ['西部材料', '002149'],
  ['信维通信', '300136'],
  ['绿的谐波', '688017'],
  ['索辰科技', '688507'],
  ['汇川技术', '300124'],
  ['埃斯顿', '002747'],
  ['三花智控', '002050'],
  ['鸣志电器', '603728'],
  ['双环传动', '002472'],
  ['兆易创新', '603986'],
  ['佰维存储', '688525'],
  ['京东方A', '000725'],
  ['亨通光电', '600487'],
  ['东山精密', '002384'],
  ['天孚通信', '300394'],
  ['新易盛', '300502'],
  ['光迅科技', '002281'],
  ['中际旭创', '300308'],
  ['工业富联', '601138'],
  ['华工科技', '000988'],
  ['三环集团', '300408'],
  ['风华高科', '000636'],
  ['中钨高新', '000657'],
  ['横店东磁', '002056'],
  ['晋控煤业', '601001'],
  ['福能股份', '600483'],
  ['春秋电子', '603890'],
  ['钧达股份', '002865'],
  ['顺灏股份', '002565'],
  ['北方华创', '002371'],
  ['通富微电', '002156'],
  ['北部湾港', '000582'],
  ['大连重工', '002204'],
  ['泰坦股份', '003036'],
  ['百合花', '603823'],
  ['友邦吊顶', '002718'],
  ['远东股份', '600869'],
  ['江南新材', '603124'],
  ['宇环数控', '002903'],
  ['沪电股份', '002463'],
  ['深南电路', '002916'],
  ['生益科技', '600183'],
  ['光华科技', '002741'],
  ['华天科技', '002185'],
  ['士兰微', '600460'],
  ['新洁能', '605111'],
  ['雅克科技', '002409'],
  ['长电科技', '600584'],
  ['金安国纪', '002636'],
  ['宏和科技', '603256'],
  ['中国巨石', '600176'],
  ['天津普林', '002134'],
  ['TCL科技', '000100'],
  ['多氟多', '002407'],
  ['源杰科技', '688498'],
  ['沃尔核材', '002130'],
  ['立讯精密', '002475'],
  ['兆龙互连', '300913'],
  ['胜宏科技', '300476'],
  ['长飞光纤', '601869'],
  ['扬杰科技', '300373'],
  ['捷捷微电', '300623'],
  ['太极实业', '600667'],
  ['华丰科技', '688629'],
  ['杰华特', '688141'],
  ['锐捷网络', '301165'],
  ['申菱环境', '301018'],
  ['大元泵业', '603757'],
];

const FALLBACK_SECTOR_GROUPS = [
  { code: 'FB001', name: '科技核心', keywords: ['科技', '通信', '光', '电子', '半导体', '芯'] },
  { code: 'FB002', name: 'AI硬件', keywords: ['光', '通信', '电子', '工业富联', '华工'] },
  { code: 'FB003', name: '存储芯片', keywords: ['兆易', '存储', '电子', '半导体'] },
  { code: 'FB004', name: '机器人', keywords: ['三花', '双环', '埃斯顿', '机器人'] },
  { code: 'FB005', name: '低空航天', keywords: ['卫星', '航天', '大连', '重工'] },
  { code: 'FB006', name: '材料资源', keywords: ['材料', '中钨', '东磁'] },
  { code: 'FB007', name: '电力能源', keywords: ['电', '煤', '福能'] },
  { code: 'FB008', name: 'PCB电子', keywords: ['东山', '沪电', '电子'] },
  { code: 'FB009', name: '光模块', keywords: ['光', '中际', '新易盛', '天孚'] },
  { code: 'FB010', name: '观察池综合', keywords: [] },
];

function parseCustomStocksArg(value = '') {
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item.includes(':')) {
        const [code, name] = item.split(':', 2).map((part) => part.trim());
        return [name || code, code];
      }
      return [item, item];
    });
}

function mergeTrackedStocks(baseStocks = TRACKED_STOCKS, extraStocks = []) {
  const seenCodes = new Set();
  const rows = [];
  for (const [name, code] of [...baseStocks, ...extraStocks]) {
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    rows.push([name, code]);
  }
  return rows;
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const args = { stocks: [], skipAStockData: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--stocks') {
      args.stocks = parseCustomStocksArg(argv[index + 1] || '');
      index += 1;
    } else if (argv[index] === '--skip-a-stock-data') {
      args.skipAStockData = true;
    }
  }
  return args;
}

function formatShanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatShanghaiTime(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function normalizePrice(value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.abs(number) > 1000 ? number / 100 : number;
}

function normalizePercent(value) {
  const number = toNumber(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.abs(number) > 50 ? number / 100 : number;
}

function parseTencentDate(raw) {
  const value = String(raw || '');
  if (!/^\d{8}/.test(value)) return '';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function marketCode(stockCode) {
  if (stockCode.startsWith('6')) return `sh${stockCode}`;
  return `sz${stockCode}`;
}

async function fetchText(url, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 3;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 600;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchTextOnce(url, options);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isTransientFetchError(error)) break;
      await delay(retryDelayMs * (attempt + 1));
    }
  }

  const detail = lastError && lastError.message ? lastError.message : String(lastError);
  throw new Error(`Fetch failed after ${retries + 1} attempts: ${url} (${detail})`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFetchError(error) {
  const code = error && error.code;
  const message = error && error.message ? error.message : '';
  return ['ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'].includes(code)
    || /socket hang up|timeout|network socket disconnected/i.test(message);
}

async function fetchTextOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        ...(options.headers || {}),
      },
    }, (response) => {
      if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        fetchTextOnce(nextUrl, options).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}: ${url}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve(options.gbk ? GBK_DECODER.decode(buffer) : buffer.toString('utf8'));
      });
    });
    request.setTimeout(15000, () => {
      request.destroy(new Error(`Timeout: ${url}`));
    });
    request.on('error', reject);
  });
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

function parseTencentPayload(text, fallbackCode, fallbackName = '') {
  const match = text.match(/="([^"]*)"/);
  if (!match) return null;
  const data = match[1].split('~');
  if (data.length <= 32) return null;

  const current = toNumber(data[3]);
  const change = toNumber(data[31]);
  const changePct = toNumber(data[32]);
  if (![current, change, changePct].every(Number.isFinite)) return null;

  return {
    code: fallbackCode,
    name: fallbackName || data[1],
    current,
    change_pct: changePct,
    change,
    volume: toNumber(data[36]),
    amount: toNumber(data[37]) / 10000,
    tradingDate: parseTencentDate(data[30]),
  };
}

async function fetchTencentQuote(code, name = '') {
  const url = `http://qt.gtimg.cn/q=${code}`;
  const text = await fetchText(url, { gbk: true });
  return parseTencentPayload(text, code, name);
}

async function fetchIndices() {
  const entries = await Promise.all(
    INDEX_CODES.map(async ({ name, code }) => [name, await fetchTencentQuote(code, name)])
  );
  return Object.fromEntries(entries.filter(([, value]) => value));
}

async function fetchTrackedStocks(stocks = TRACKED_STOCKS) {
  const rows = [];
  for (const [name, code] of stocks) {
    const quote = await fetchTencentQuote(marketCode(code), name);
    if (quote) {
      rows.push({ ...quote, code });
    }
  }
  return rows;
}

function eastmoneyUrl(params, baseUrl = EASTMONEY_BASE_URLS[0]) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchEastmoneyJson(params) {
  const errors = [];
  for (const baseUrl of EASTMONEY_BASE_URLS) {
    const url = eastmoneyUrl(params, baseUrl);
    try {
      return await fetchJson(url, {
        headers: {
          Accept: 'application/json,text/plain,*/*',
          Referer: 'https://quote.eastmoney.com/',
        },
      });
    } catch (error) {
      errors.push(`${new URL(baseUrl).host}: ${error.message}`);
    }
  }
  throw new Error(`Eastmoney fetch failed on all endpoints: ${errors.join(' | ')}`);
}

function shouldContinueEastmoneyPaging({ diffLength, requestedPageSize, rowsLength, total }) {
  if (diffLength === 0) return false;
  if (Number.isFinite(total) && total > 0) return rowsLength < total;
  return diffLength >= requestedPageSize;
}

async function fetchEastmoneyRows(params, pageSize = 500) {
  const rows = [];
  for (let page = 1; page <= 80; page += 1) {
    const json = await fetchEastmoneyJson({ ...params, pn: String(page), pz: String(pageSize) });
    const diff = json?.data?.diff || [];
    const total = Number(json?.data?.total);
    rows.push(...diff);
    if (!shouldContinueEastmoneyPaging({
      diffLength: diff.length,
      requestedPageSize: pageSize,
      rowsLength: rows.length,
      total,
    })) break;
  }
  return rows;
}

function countMarketBreadth(rows) {
  return rows.reduce(
    (acc, row) => {
      const change = Number(row.f3);
      if (!Number.isFinite(change)) return acc;
      acc.total += 1;
      if (change > 0) acc.risers += 1;
      else if (change < 0) acc.fallers += 1;
      else acc.flat += 1;
      return acc;
    },
    { total: 0, risers: 0, fallers: 0, flat: 0 }
  );
}

function stockChange(stock) {
  return Number(stock.change_pct ?? stock.changePercent ?? 0);
}

function stockAmount(stock) {
  return Number(stock.amount || 0);
}

function buildFallbackSectors(stocks) {
  return FALLBACK_SECTOR_GROUPS.map((group) => {
    const members = group.keywords.length === 0
      ? stocks
      : stocks.filter((stock) => group.keywords.some((keyword) => String(stock.name || '').includes(keyword)));
    const rows = members.length > 0 ? members : stocks;
    const changePct = rows.reduce((sum, stock) => sum + stockChange(stock), 0) / Math.max(rows.length, 1);
    const amount = rows.reduce((sum, stock) => sum + stockAmount(stock), 0);
    return {
      code: group.code,
      name: group.name,
      change_pct: Number(changePct.toFixed(2)),
      amount: Number(amount.toFixed(2)),
    };
  }).sort((a, b) => b.change_pct - a.change_pct);
}

function buildTencentFallbackMarketData(data) {
  const stocks = [...(data.tracked_stocks || [])]
    .map(normalizeStock)
    .filter((stock) => stock.code && Number.isFinite(Number(stock.change_pct)))
    .sort((a, b) => stockAmount(b) - stockAmount(a));
  const breadth = stocks.reduce((acc, stock) => {
    const change = stockChange(stock);
    acc.total += 1;
    if (change > 0) acc.risers += 1;
    else if (change < 0) acc.fallers += 1;
    else acc.flat += 1;
    return acc;
  }, { total: 0, risers: 0, fallers: 0, flat: 0 });
  const sectors = buildFallbackSectors(stocks);

  return {
    schema_version: '1.0.0',
    date: data.date,
    fetched_at: `${data.fetched_date || data.date}T${data.time || '00:00:00'}+08:00`,
    source: 'fetch-market-data.js:tencent-fallback',
    market: { breadth },
    indices: (Array.isArray(data.indices) ? data.indices : Object.values(data.indices || {})).map(normalizeIndex),
    sectors: {
      all: sectors,
      top: sectors.slice(0, 5),
      falling: sectors.filter((sector) => Number(sector.change_pct) < 0).slice(0, 5),
    },
    hot_stocks: stocks.slice(0, Math.max(10, Math.min(stocks.length, 15))),
    tracked_stocks: stocks,
  };
}

async function fetchMarketBreadth() {
  const rows = await fetchEastmoneyRows({
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: 'm:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048',
    fields: 'f3',
  }, getMarketBreadthPageSize());
  return countMarketBreadth(rows);
}

function getMarketBreadthPageSize() {
  return MARKET_BREADTH_PAGE_SIZE;
}

function mapSector(row) {
  return {
    code: row.f12 || '',
    name: row.f14 || '',
    changePercent: normalizePercent(row.f3).toFixed(2),
    price: normalizePrice(row.f2),
    amount: Number.isFinite(toNumber(row.f6)) ? (toNumber(row.f6) / 100000000).toFixed(2) : '',
  };
}

function selectFallingSectors(sectors, limit = 5) {
  return sectors
    .filter((sector) => Number(sector.changePercent) < 0)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent))
    .slice(0, limit);
}

function mergeSectorRows(...rowGroups) {
  const seen = new Set();
  const rows = [];

  for (const row of rowGroups.flat()) {
    const code = row?.f12 || '';
    if (!code || seen.has(code)) continue;
    seen.add(code);
    rows.push(mapSector(row));
  }

  const all = rows.sort((a, b) => Number(b.changePercent) - Number(a.changePercent));
  return {
    all,
    top: all.slice(0, 10),
    falling: selectFallingSectors(all),
    lagging: all.slice(-5).reverse(),
  };
}

async function fetchSectorData() {
  const baseParams = {
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs: 'm:90 t:3',
    fields: 'f12,f14,f3,f2,f4,f5,f6',
  };
  const risingRows = await fetchEastmoneyRows({ ...baseParams, po: '1' }, 200);
  const fallingRows = await fetchEastmoneyRows({ ...baseParams, po: '0' }, 200);
  return mergeSectorRows(risingRows, fallingRows);
}

async function fetchHotStocks(limit = 15) {
  const rows = await fetchEastmoneyRows({
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f6',
    fs: 'm:0 t:6,m:0 t:80,m:1 t:2,m:1 t:23,m:0 t:81 s:2048',
    fields: 'f12,f14,f2,f3,f6',
  }, limit);
  return rows.slice(0, limit).map((row) => ({
    code: row.f12 || '',
    name: row.f14 || '',
    price: normalizePrice(row.f2).toFixed(2),
    changePercent: normalizePercent(row.f3).toFixed(2),
    amount: Number.isFinite(toNumber(row.f6)) ? (toNumber(row.f6) / 100000000).toFixed(2) : '',
  }));
}

function getLatestTradingDate(indices, localDate = new Date()) {
  const rows = Array.isArray(indices) ? indices : Object.values(indices || {});
  const dates = rows.map((row) => row.tradingDate).filter(Boolean).sort();
  return dates.at(-1) || formatShanghaiDate(localDate);
}

function validateMarketData(data) {
  const indices = Array.isArray(data.indices) ? data.indices : Object.values(data.indices || {});
  if (indices.length < 4) {
    throw new Error('指数数据不足');
  }
  for (const index of indices) {
    const value = index.changePercent ?? index.change_pct;
    if (!Number.isFinite(Number(String(value).replace('%', '')))) {
      throw new Error(`指数${index.name || ''}涨跌幅无效`);
    }
  }

  const sectorRows = Array.isArray(data.sectors) ? data.sectors : (data.sectors?.all || []);
  if (sectorRows.length < 10) {
    throw new Error('板块数据不足');
  }
  const sectorChanges = sectorRows.map((sector) => Number(sector.changePercent ?? sector.change_pct));
  if (sectorChanges.some((value) => !Number.isFinite(value))) {
    throw new Error('板块涨跌幅存在无效值');
  }

  const hotStocks = data.hotStocks || data.hot_stocks || [];
  if (hotStocks.length < 10) {
    throw new Error('热门股票数据不足');
  }
  const codes = hotStocks.map((stock) => stock.code).filter(Boolean);
  if (new Set(codes).size !== codes.length) {
    throw new Error('热门股票代码重复');
  }

  const breadth = data.breadth || {};
  if (Number(breadth.total) < 4500) {
    throw new Error('涨跌家数样本不足，可能分页抓取不完整');
  }
  const indexChanges = indices.map((index) => Number(String(index.changePercent ?? index.change_pct).replace('%', '')));
  if (breadth.total >= 4500 && Number(breadth.fallers) === 0 && indexChanges.some((change) => change <= 0.1)) {
    throw new Error('指数方向与涨跌家数同向性异常，物理不可能');
  }
}

function toLegacySector(sector) {
  return {
    code: sector.code,
    name: sector.name,
    change_pct: Number((Number(sector.changePercent) / 100).toFixed(6)),
    price: sector.price,
  };
}

function normalizeIndex(index) {
  return {
    name: index.name,
    code: index.code,
    current: Number(index.current),
    change_pct: Number(String(index.changePercent ?? index.change_pct).replace('%', '')),
    change: Number(index.change),
    volume: Number(index.volume),
    amount: Number(index.amount),
    trading_date: index.tradingDate || index.trading_date || '',
  };
}

function normalizeSector(sector) {
  return {
    code: sector.code || '',
    name: sector.name || '',
    change_pct: Number(sector.changePercent ?? sector.change_pct),
    price: Number(sector.price),
    amount: Number(sector.amount),
  };
}

function normalizeStock(stock) {
  return {
    code: stock.code || '',
    name: stock.name || '',
    price: Number(stock.price ?? stock.current ?? stock.close),
    current: Number(stock.current ?? stock.price ?? stock.close),
    change_pct: Number(stock.changePercent ?? stock.change_pct),
    change: Number(stock.change),
    amount: Number(stock.amount),
  };
}

function normalizeDailyMarketData(data) {
  const indices = (Array.isArray(data.indices) ? data.indices : Object.values(data.indices || {}))
    .map(normalizeIndex);
  const sectors = Array.isArray(data.sectors)
    ? { all: data.sectors, top: data.sectors.slice(0, 10), falling: selectFallingSectors(data.sectors) }
    : data.sectors;
  const fetchedDate = data.fetched_date || data.date;

  return {
    schema_version: '1.0.0',
    date: data.date,
    fetched_at: `${fetchedDate}T${data.time || '00:00:00'}+08:00`,
    source: 'fetch-market-data.js',
    market: {
      breadth: data.breadth,
    },
    indices,
    sectors: {
      all: (sectors?.all || []).map(normalizeSector),
      top: (sectors?.top || []).map(normalizeSector),
      falling: (sectors?.falling || []).map(normalizeSector),
    },
    hot_stocks: (data.hot_stocks || data.hotStocks || []).map(normalizeStock),
    tracked_stocks: (data.tracked_stocks || []).map(normalizeStock),
  };
}

async function attachAStockDataEnrichment(data, options = {}) {
  if (options.skipAStockData) return data;
  const fetcher = options.fetcher || fetchAStockDataEnrichment;
  const enrichment = await fetcher(data, options.aStockDataOptions || {});
  return {
    ...data,
    a_stock_data: enrichment,
  };
}

async function fetchMarketData(now = new Date(), options = {}) {
  const trackedStockList = mergeTrackedStocks(TRACKED_STOCKS, options.extraStocks || []);
  const indices = await fetchIndices();
  const trackedStocks = await fetchTrackedStocks(trackedStockList);
  const localDate = formatShanghaiDate(now);
  const baseData = {
    date: getLatestTradingDate(indices, now) || localDate,
    fetched_date: localDate,
    time: formatShanghaiTime(now),
    indices,
    tracked_stocks: trackedStocks,
  };

  let sectors;
  let hotStocks;
  let breadth;
  try {
    sectors = await fetchSectorData();
    hotStocks = await fetchHotStocks();
    breadth = await fetchMarketBreadth();
  } catch (error) {
    if (options.disableTencentFallback) throw error;
    const fallback = buildTencentFallbackMarketData(baseData);
    fallback.fallback_reason = error.message;
    return fallback;
  }

  return {
    ...baseData,
    indices,
    breadth,
    sectors,
    hot_stocks: hotStocks,
    tracked_stocks: trackedStocks,
    legacy_sectors: sectors.top.map(toLegacySector),
  };
}

async function main() {
  const args = parseCliArgs();
  const data = await fetchMarketData(new Date(), { extraStocks: args.stocks });
  const normalized = data.schema_version ? data : normalizeDailyMarketData(data);
  if (!normalized.source.endsWith(':tencent-fallback')) {
    validateMarketData(data);
  }
  const enriched = await attachAStockDataEnrichment(normalized, {
    skipAStockData: args.skipAStockData,
  });
  validateDailyMarketData(enriched);

  const outputDate = enriched.date;
  const outputDir = path.join(__dirname, '..', 'data', 'daily');
  const outputFile = path.join(outputDir, `${outputDate}.json`);
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(enriched, null, 2)}\n`, 'utf8');

  console.log(`数据已保存到: ${outputFile}`);
  console.log(`指数: ${normalized.indices.length}个 | 板块: ${normalized.sectors.all.length}个 | 涨跌家数: ${normalized.market.breadth.risers}/${normalized.market.breadth.fallers}/${normalized.market.breadth.flat} | 个股: ${normalized.tracked_stocks.length}个`);
  if (args.stocks.length > 0) {
    console.log(`补抓标的: ${args.stocks.map(([name, code]) => `${name}(${code})`).join(', ')}`);
  }
}

module.exports = {
  attachAStockDataEnrichment,
  buildTencentFallbackMarketData,
  countMarketBreadth,
  eastmoneyUrl,
  fetchMarketData,
  fetchText,
  formatShanghaiDate,
  getMarketBreadthPageSize,
  getLatestTradingDate,
  mergeSectorRows,
  mergeTrackedStocks,
  normalizeDailyMarketData,
  parseCliArgs,
  parseCustomStocksArg,
  selectFallingSectors,
  shouldContinueEastmoneyPaging,
  validateMarketData,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
