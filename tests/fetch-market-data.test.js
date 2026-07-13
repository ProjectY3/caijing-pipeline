const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  attachAStockDataEnrichment,
  countMarketBreadth,
  eastmoneyUrl,
  fetchText,
  buildTencentFallbackMarketData,
  getMarketBreadthPageSize,
  formatShanghaiDate,
  getLatestTradingDate,
  mergeSectorRows,
  mergeTrackedStocks,
  normalizeDailyMarketData,
  parseCliArgs,
  parseCustomStocksArg,
  selectFallingSectors,
  shouldContinueEastmoneyPaging,
  validateMarketData,
} = require('../scripts/fetch-market-data');
const { validateDailyMarketData } = require('../scripts/market-schema');

const MIN_TOTAL = 4500;

function buildSectors(overrides = []) {
  const base = [];
  for (let i = 0; i < 60; i++) {
    base.push({ name: `板块${i + 1}`, changePercent: (3 - i * 0.1).toFixed(2), risers: 5, fallers: 3, amount: '10.00' });
  }
  return overrides.length ? overrides : { all: base, top: base.slice(0, 10), falling: base.filter(s => Number(s.changePercent) < 0).slice(0, 5), lagging: base.slice(-5) };
}

function buildBreadth(risers = 2500, fallers = 2200, flat = 100) {
  return { total: risers + fallers + flat, risers, fallers, flat };
}

function buildIndices(shChange = '0.50') {
  return [
    { name: '上证指数', code: 'sh000001', changePercent: `${shChange}%`, price: '4000', current: 4000, amount: 1000, amountYi: 1000 },
    { name: '深证成指', code: 'sz399001', changePercent: '0.30%', price: '15000', current: 15000, amount: 1000, amountYi: 1000 },
    { name: '创业板指', code: 'sz399006', changePercent: '0.20%', price: '4000', current: 4000, amount: 1000, amountYi: 1000 },
    { name: '科创50', code: 'sh000688', changePercent: '0.10%', price: '1700', current: 1700, amount: 1000, amountYi: 1000 },
  ];
}

function buildHotStocks(count = 15) {
  return Array.from({ length: count }, (_, i) => ({
    code: `60000${i.toString().padStart(2, '0')}`,
    name: `股票${i + 1}`,
    price: '10.00',
    changePercent: '1.50',
    amount: '5.00',
  }));
}

test('counts market breadth from all returned rows instead of stopping early', () => {
  const rows = [
    { f3: 120 },
    { f3: 0 },
    { f3: -10 },
    { f3: 25 },
    { f3: -1 },
  ];

  assert.deepEqual(countMarketBreadth(rows), {
    total: 5,
    risers: 2,
    fallers: 2,
    flat: 1,
  });
});

test('continues Eastmoney paging when API caps returned rows below requested page size', () => {
  assert.equal(shouldContinueEastmoneyPaging({
    diffLength: 100,
    requestedPageSize: 1000,
    rowsLength: 100,
    total: 5200,
  }), true);
  assert.equal(shouldContinueEastmoneyPaging({
    diffLength: 100,
    requestedPageSize: 1000,
    rowsLength: 5200,
    total: 5200,
  }), false);
  assert.equal(shouldContinueEastmoneyPaging({
    diffLength: 0,
    requestedPageSize: 1000,
    rowsLength: 100,
    total: 5200,
  }), false);
});

test('fetchText retries transient socket hang ups', async () => {
  let attempts = 0;
  const server = http.createServer((request, response) => {
    attempts += 1;
    if (attempts === 1) {
      request.socket.destroy();
      return;
    }
    response.end('ok');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    const text = await fetchText(`http://127.0.0.1:${port}/`, { retries: 1, retryDelayMs: 1 });
    assert.equal(text, 'ok');
    assert.equal(attempts, 2);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('uses conservative page size for market breadth fetches', () => {
  assert.equal(getMarketBreadthPageSize(), 200);
});

test('uses https Eastmoney endpoint by default', () => {
  const url = eastmoneyUrl({ pn: '1', pz: '15' });

  assert.equal(url.startsWith('https://'), true);
  assert.equal(new URL(url).hostname.includes('eastmoney.com'), true);
});

test('uses Asia/Shanghai date instead of UTC date', () => {
  const earlyMorningShanghai = new Date('2026-05-29T17:30:00.000Z');

  assert.equal(formatShanghaiDate(earlyMorningShanghai), '2026-05-30');
});

test('uses latest trading date from index payloads when current day is not a trading day', () => {
  const localDate = new Date('2026-05-29T17:30:00.000Z');
  const indices = [
    { name: '上证指数', tradingDate: '2026-05-29' },
    { name: '深证成指', tradingDate: '2026-05-29' },
  ];

  assert.equal(getLatestTradingDate(indices, localDate), '2026-05-29');
});

test('selects only negative sectors for falling sector list', () => {
  const sectors = [
    { name: 'A', changePercent: '1.20' },
    { name: 'B', changePercent: '-0.20' },
    { name: 'C', changePercent: '-1.10' },
    { name: 'D', changePercent: '0.00' },
  ];

  assert.deepEqual(selectFallingSectors(sectors), [
    { name: 'C', changePercent: '-1.10' },
    { name: 'B', changePercent: '-0.20' },
  ]);
});

test('merges rising and falling sector pages before selecting summaries', () => {
  const result = mergeSectorRows([
    { f12: 'BK001', f14: '上涨板块A', f3: 2.5, f2: 1000, f6: 100000000 },
    { f12: 'BK002', f14: '上涨板块B', f3: 1.8, f2: 1000, f6: 90000000 },
  ], [
    { f12: 'BK003', f14: '下跌板块A', f3: -1.2, f2: 1000, f6: 80000000 },
    { f12: 'BK001', f14: '上涨板块A', f3: 2.5, f2: 1000, f6: 100000000 },
    { f12: 'BK004', f14: '下跌板块B', f3: -0.6, f2: 1000, f6: 70000000 },
  ]);

  assert.deepEqual(result.all.map((sector) => sector.code), ['BK001', 'BK002', 'BK004', 'BK003']);
  assert.deepEqual(result.falling.map((sector) => sector.code), ['BK003', 'BK004']);
});

test('validateMarketData passes on healthy data', () => {
  assert.doesNotThrow(() => validateMarketData({
    indices: buildIndices('0.50'),
    sectors: buildSectors(),
    hotStocks: buildHotStocks(),
    breadth: buildBreadth(),
  }));
});

test('validateMarketData throws when breadth total is suspiciously low (truncation)', () => {
  assert.throws(() => validateMarketData({
    indices: buildIndices('-0.27'),
    sectors: buildSectors(),
    hotStocks: buildHotStocks(),
    breadth: { total: 1200, risers: 1200, fallers: 0, flat: 0 },
  }), /涨跌家数样本不足|分页/);
});

test('validateMarketData throws when indices fall but no stocks fell (the 2026-06-01 bug)', () => {
  assert.throws(() => validateMarketData({
    indices: buildIndices('-0.27'),
    sectors: buildSectors(),
    hotStocks: buildHotStocks(),
    breadth: { total: 5000, risers: 5000, fallers: 0, flat: 0 },
  }), /同向|方向不一致|物理不可能/);
});

test('validateMarketData allows all-positive sector days when the sample is complete', () => {
  const allPositive = [];
  for (let i = 0; i < 60; i++) {
    allPositive.push({ name: `板块${i + 1}`, changePercent: (5 - i * 0.05).toFixed(2), risers: 5, fallers: 0, amount: '10.00' });
  }
  const sectors = { all: allPositive, top: allPositive.slice(0, 10), falling: [], lagging: allPositive.slice(-5) };
  assert.doesNotThrow(() => validateMarketData({
    indices: buildIndices('0.30'),
    sectors,
    hotStocks: buildHotStocks(),
    breadth: buildBreadth(),
  }));
});

test('validateMarketData throws when whole market shows zero fallers despite enough samples (truncation signal)', () => {
  assert.throws(() => validateMarketData({
    indices: buildIndices('0.10'),
    sectors: buildSectors(),
    hotStocks: buildHotStocks(),
    breadth: { total: 5000, risers: 5000, fallers: 0, flat: 0 },
  }), /同向|物理不可能/);
});

test('validateMarketData throws when an index has NaN change percent', () => {
  const indices = buildIndices('0.30');
  indices[1].changePercent = '-%';
  assert.throws(() => validateMarketData({
    indices,
    sectors: buildSectors(),
    hotStocks: buildHotStocks(),
    breadth: buildBreadth(),
  }), /指数.*无效|涨跌幅/);
});

test('validateMarketData throws when hot stocks have duplicate codes', () => {
  const hotStocks = buildHotStocks();
  hotStocks[1].code = hotStocks[0].code;
  assert.throws(() => validateMarketData({
    indices: buildIndices('0.30'),
    sectors: buildSectors(),
    hotStocks,
    breadth: buildBreadth(),
  }), /热门股.*重复|代码重复/);
});

test('normalizes fetched data to the standard daily market schema', () => {
  const sectors = buildSectors();
  const result = normalizeDailyMarketData({
    date: '2026-06-11',
    fetched_date: '2026-06-11',
    time: '17:10:25',
    indices: {
      上证指数: { name: '上证指数', code: 'sh000001', current: 3987.01, change_pct: -0.16, amount: 118555461 },
      深证成指: { name: '深证成指', code: 'sz399001', current: 14851.98, change_pct: -0.68, amount: 136646694 },
      创业板指: { name: '创业板指', code: 'sz399006', current: 3811.25, change_pct: -1.13, amount: 64992867 },
      科创50: { name: '科创50', code: 'sh000688', current: 1662.44, change_pct: 0.62, amount: 11715558 },
    },
    breadth: buildBreadth(),
    sectors,
    hot_stocks: buildHotStocks(),
    tracked_stocks: [
      { code: '000636', name: '风华高科', current: 64.3, change_pct: 7.51, amount: 116.94 },
    ],
  });

  assert.equal(result.schema_version, '1.0.0');
  assert.equal(result.source, 'fetch-market-data.js');
  assert.deepEqual(Object.keys(result), [
    'schema_version',
    'date',
    'fetched_at',
    'source',
    'market',
    'indices',
    'sectors',
    'hot_stocks',
    'tracked_stocks',
  ]);
  assert.equal(result.market.breadth.total, 4800);
  assert.equal(result.indices.length, 4);
  assert.equal(result.sectors.all.length, 60);
  assert.equal(result.hot_stocks.length, 15);
});

test('attaches a-stock-data enrichment without changing standard daily fields', async () => {
  const normalized = normalizeDailyMarketData({
    date: '2026-06-16',
    fetched_date: '2026-06-16',
    time: '17:10:25',
    indices: buildIndices('0.30'),
    breadth: buildBreadth(),
    sectors: {
      all: buildSectors().all.map((sector, index) => ({ ...sector, code: `BK${String(index).padStart(3, '0')}` })),
      top: buildSectors().top.map((sector, index) => ({ ...sector, code: `BK${String(index).padStart(3, '0')}` })),
      falling: buildSectors().falling.map((sector, index) => ({ ...sector, code: `BF${String(index).padStart(3, '0')}` })),
    },
    hot_stocks: buildHotStocks(),
    tracked_stocks: [
      { code: '000636', name: '风华高科', current: 64.3, change_pct: 7.51, amount: 116.94 },
    ],
  });

  const enriched = await attachAStockDataEnrichment(normalized, {
    fetcher: async (data) => ({
      source: 'a-stock-data',
      fetched_at: data.fetched_at,
      news: { global: [{ title: '快讯', summary: '', time: '2026-06-16 17:00:00' }], stocks: [] },
      signals: { concept_blocks: [{ code: '000636', industry: '', concepts: ['MLCC'], regions: [] }] },
      errors: [],
    }),
  });

  assert.deepEqual(Object.keys(enriched).slice(0, 8), [
    'schema_version',
    'date',
    'fetched_at',
    'source',
    'market',
    'indices',
    'sectors',
    'hot_stocks',
  ]);
  assert.equal(enriched.tracked_stocks.length, 1);
  assert.equal(enriched.a_stock_data.source, 'a-stock-data');
  assert.equal(enriched.a_stock_data.news.global[0].title, '快讯');
  assert.equal(enriched.a_stock_data.signals.concept_blocks[0].concepts[0], 'MLCC');
  assert.doesNotThrow(() => validateDailyMarketData(enriched));
});

test('parses custom stock arguments for supplemental fetches', () => {
  assert.deepEqual(parseCustomStocksArg('600522:中天科技,300750:宁德时代,002594'), [
    ['中天科技', '600522'],
    ['宁德时代', '300750'],
    ['002594', '002594'],
  ]);
});

test('parses a-stock-data skip flag for fallback fetches', () => {
  assert.deepEqual(parseCliArgs(['--skip-a-stock-data', '--stocks', '000636:风华高科']), {
    stocks: [['风华高科', '000636']],
    skipAStockData: true,
  });
});

test('merges custom stocks without duplicating default tracked codes', () => {
  const merged = mergeTrackedStocks([
    ['风华高科', '000636'],
    ['快克智能', '603203'],
  ], [
    ['风华高科', '000636'],
  ]);

  assert.deepEqual(merged, [
    ['风华高科', '000636'],
    ['快克智能', '603203'],
  ]);
});

test('builds tencent fallback market data when Eastmoney is unavailable', () => {
  const trackedStocks = buildHotStocks(12).map((stock, index) => ({
    ...stock,
    name: `跟踪${index + 1}`,
    current: Number(stock.price),
    change_pct: index % 2 === 0 ? 1 + index / 10 : -1 - index / 10,
    amount: 20 + index,
  }));
  const result = buildTencentFallbackMarketData({
    date: '2026-06-15',
    fetched_date: '2026-06-15',
    time: '12:10:00',
    indices: buildIndices('0.50'),
    tracked_stocks: trackedStocks,
  });

  assert.equal(result.source, 'fetch-market-data.js:tencent-fallback');
  assert.equal(result.sectors.all.length >= 10, true);
  assert.equal(result.sectors.top.length >= 1, true);
  assert.equal(result.hot_stocks.length >= 10, true);
  assert.equal(result.market.breadth.total, trackedStocks.length);
  assert.doesNotThrow(() => validateDailyMarketData(result));
});
