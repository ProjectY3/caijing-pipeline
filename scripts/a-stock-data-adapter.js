const { randomUUID } = require('node:crypto');

const SOURCE = 'a-stock-data';
const EASTMONEY_MIN_INTERVAL_MS = 1100;
const EASTMONEY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

let lastEastmoneyCallAt = 0;

function stripHtml(value = '') {
  return String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function compactText(value = '', limit = 200) {
  const text = stripHtml(value);
  return [...text].slice(0, limit).join('');
}

function normalizeGlobalNews(rows = []) {
  return rows
    .map((item) => ({
      title: stripHtml(item.title || item.Title || ''),
      summary: compactText(item.summary || item.Summary || item.content || '', 200),
      time: String(item.showTime || item.time || item.Time || '').trim(),
    }))
    .filter((item) => item.title);
}

function normalizeStockNews(code, rows = []) {
  return rows
    .map((item) => ({
      code,
      title: stripHtml(item.title || ''),
      content: compactText(item.content || '', 200),
      time: String(item.date || item.time || '').trim(),
      source: String(item.mediaName || item.source || '').trim(),
      url: String(item.url || '').trim(),
    }))
    .filter((item) => item.title);
}

function normalizeConceptBlocks(code, data = {}) {
  const tags = Array.isArray(data.concept_tags) ? data.concept_tags : [];
  const boards = Array.isArray(data.boards) ? data.boards : [];
  const concepts = tags.length > 0 ? tags : boards.map((board) => board.name).filter(Boolean);
  return {
    code,
    industry: data.industry || '',
    concepts,
    regions: Array.isArray(data.region_tags) ? data.region_tags : [],
  };
}

function buildAStockDataEnrichment({
  fetchedAt,
  globalNews = [],
  stockNews = {},
  conceptBlocks = [],
  errors = [],
} = {}) {
  return {
    source: SOURCE,
    fetched_at: fetchedAt || new Date().toISOString(),
    news: {
      global: globalNews,
      stocks: Object.entries(stockNews)
        .map(([code, items]) => ({ code, items }))
        .filter((row) => row.items.length > 0),
    },
    signals: {
      concept_blocks: conceptBlocks.filter((row) => row.concepts.length > 0 || row.industry),
    },
    errors,
  };
}

async function waitForEastmoneySlot() {
  const elapsed = Date.now() - lastEastmoneyCallAt;
  if (elapsed < EASTMONEY_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, EASTMONEY_MIN_INTERVAL_MS - elapsed));
  }
  lastEastmoneyCallAt = Date.now();
}

async function fetchEastmoneyJson(url, params = {}, headers = {}) {
  await waitForEastmoneySlot();
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  const response = await fetch(target, {
    headers: {
      ...EASTMONEY_HEADERS,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${target}`);
  }
  return response.json();
}

async function fetchEastmoneyJsonp(url, params = {}, headers = {}) {
  await waitForEastmoneySlot();
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  const response = await fetch(target, {
    headers: {
      ...EASTMONEY_HEADERS,
      ...headers,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${target}`);
  }
  const text = await response.text();
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) {
    throw new Error('Invalid JSONP response');
  }
  return JSON.parse(text.slice(start + 1, end));
}

async function fetchGlobalNews(pageSize = 10) {
  const json = await fetchEastmoneyJson(
    'https://np-weblist.eastmoney.com/comm/web/getFastNewsList',
    {
      client: 'web',
      biz: 'web_724',
      fastColumn: '102',
      sortEnd: '',
      pageSize: String(pageSize),
      req_trace: randomUUID(),
    },
    { Referer: 'https://kuaixun.eastmoney.com/' }
  );
  return normalizeGlobalNews(json?.data?.fastNewsList || []);
}

async function fetchStockNews(code, pageSize = 5) {
  const param = JSON.stringify({
    uid: '',
    keyword: code,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize,
        preTag: '',
        postTag: '',
      },
    },
  });
  const json = await fetchEastmoneyJsonp(
    'https://search-api-web.eastmoney.com/search/jsonp',
    { cb: 'jQuery_news', param },
    { Referer: 'https://so.eastmoney.com/' }
  );
  return normalizeStockNews(code, json?.result?.cmsArticleWebOld || []);
}

async function fetchConceptBlocks(code) {
  const marketCode = String(code).startsWith('6') ? '1' : '0';
  const json = await fetchEastmoneyJson(
    'https://push2.eastmoney.com/api/qt/slist/get',
    {
      fltt: '2',
      invt: '2',
      secid: `${marketCode}.${code}`,
      spt: '3',
      pi: '0',
      pz: '200',
      po: '1',
      fields: 'f12,f14,f3,f128',
    },
    { Referer: 'https://quote.eastmoney.com/' }
  );
  const diff = json?.data?.diff || [];
  const items = Array.isArray(diff) ? diff : Object.values(diff);
  const boards = items.map((item) => ({
    name: item.f14 || '',
    code: item.f12 || '',
    change_pct: item.f3 ?? '',
    lead_stock: item.f128 || '',
  }));
  return normalizeConceptBlocks(code, {
    boards,
    concept_tags: boards.map((board) => board.name).filter(Boolean),
  });
}

function selectEnrichmentStocks(data, limit) {
  const rows = Array.isArray(data?.tracked_stocks) ? data.tracked_stocks : [];
  const codes = rows
    .map((stock) => String(stock.code || '').trim())
    .filter(Boolean);
  if (limit === undefined) return codes;
  return codes.slice(0, limit);
}

async function fetchAStockDataEnrichment(data, options = {}) {
  const codes = options.stockCodes || selectEnrichmentStocks(data, options.stockLimit);
  const errors = [];
  let globalNews = [];
  const stockNews = {};
  const conceptBlocks = [];

  try {
    globalNews = await fetchGlobalNews(options.globalNewsLimit || 10);
  } catch (error) {
    errors.push(`global news: ${error.message}`);
  }

  for (const code of codes) {
    try {
      stockNews[code] = await fetchStockNews(code, options.stockNewsLimit || 5);
    } catch (error) {
      errors.push(`stock news ${code}: ${error.message}`);
    }

    try {
      conceptBlocks.push(await fetchConceptBlocks(code));
    } catch (error) {
      errors.push(`concept blocks ${code}: ${error.message}`);
    }
  }

  return buildAStockDataEnrichment({
    fetchedAt: data?.fetched_at,
    globalNews,
    stockNews,
    conceptBlocks,
    errors,
  });
}

module.exports = {
  buildAStockDataEnrichment,
  fetchAStockDataEnrichment,
  fetchConceptBlocks,
  fetchGlobalNews,
  fetchStockNews,
  normalizeConceptBlocks,
  normalizeGlobalNews,
  normalizeStockNews,
  selectEnrichmentStocks,
};
