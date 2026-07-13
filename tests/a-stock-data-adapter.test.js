const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildAStockDataEnrichment,
  normalizeConceptBlocks,
  normalizeGlobalNews,
  normalizeStockNews,
} = require('../scripts/a-stock-data-adapter');

test('normalizes a-stock-data global news into compact daily rows', () => {
  const rows = normalizeGlobalNews([
    { title: '  全市场快讯  ', summary: '  摘要内容  ', showTime: '2026-06-16 23:17:02' },
    { title: '', summary: 'missing title', showTime: '2026-06-16 23:10:00' },
  ]);

  assert.deepEqual(rows, [
    {
      title: '全市场快讯',
      summary: '摘要内容',
      time: '2026-06-16 23:17:02',
    },
  ]);
});

test('normalizes a-stock-data stock news and strips html tags', () => {
  const rows = normalizeStockNews('600519', [
    {
      title: '<em>贵州茅台</em>公告',
      content: '<p>正文内容</p>',
      date: '2026-06-12 10:27:00',
      mediaName: '南方财经网',
      url: 'https://example.test/a',
    },
  ]);

  assert.deepEqual(rows, [
    {
      code: '600519',
      title: '贵州茅台公告',
      content: '正文内容',
      time: '2026-06-12 10:27:00',
      source: '南方财经网',
      url: 'https://example.test/a',
    },
  ]);
});

test('normalizes concept blocks for downstream review logic', () => {
  const row = normalizeConceptBlocks('000636', {
    industry: '电子元件',
    concept_tags: ['MLCC', '新能源汽车', '国产替代'],
    region_tags: ['广东板块'],
  });

  assert.deepEqual(row, {
    code: '000636',
    industry: '电子元件',
    concepts: ['MLCC', '新能源汽车', '国产替代'],
    regions: ['广东板块'],
  });
});

test('builds optional a-stock-data enrichment without changing core schema', () => {
  const enrichment = buildAStockDataEnrichment({
    fetchedAt: '2026-06-16T23:30:00+08:00',
    globalNews: [{ title: '全市场快讯', summary: '摘要', time: '2026-06-16 23:17:02' }],
    stockNews: {
      '600519': [{ code: '600519', title: '个股新闻', content: '', time: '2026-06-12 10:27:00', source: '东财', url: '' }],
    },
    conceptBlocks: [
      { code: '000636', industry: '电子元件', concepts: ['MLCC'], regions: ['广东板块'] },
    ],
    errors: ['stock news 000001 failed'],
  });

  assert.deepEqual(Object.keys(enrichment), ['source', 'fetched_at', 'news', 'signals', 'errors']);
  assert.equal(enrichment.source, 'a-stock-data');
  assert.equal(enrichment.news.global.length, 1);
  assert.equal(enrichment.news.stocks[0].code, '600519');
  assert.equal(enrichment.signals.concept_blocks[0].code, '000636');
  assert.deepEqual(enrichment.errors, ['stock news 000001 failed']);
});
