const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { runProjectHealthCheck } = require('../scripts/check-project-health');
const { lintArticleWithMarketData, parseArgs } = require('../scripts/lint-articles');

test('package test script targets every test file', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.test, 'node --test tests/*.test.js');
});

test('project health check matches the current six-step workflow', () => {
  const result = runProjectHealthCheck({ rootDir: process.cwd() });

  assert.equal(result.ok, true, result.issues.map((item) => `${item.rule}: ${item.message}`).join('\n'));
});

test('article linter infers xhs rules from an xhs filename', () => {
  const args = parseArgs(['outputs/final/2026-07-10-小红书抖音.md']);

  assert.equal(args.platform, 'xhs');
});

test('wechat prelint reads the UTF-8 stock abbreviation map on Windows', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'financial-ip-prelint-'));
  const articlePath = path.join(rootDir, 'article.html');
  fs.writeFileSync(articlePath, '<p>复盘记录。</p>', 'utf8');

  const result = spawnSync('python', ['scripts/prelint-check.py', articlePath], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('write card never promotes the catch-all sector and labels fallback breadth as a sample', () => {
  const result = spawnSync('python', ['scripts/write-card.py', '2026-07-10'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const card = JSON.parse(result.stdout);

  assert.equal(card.mainlines.some((sector) => sector.name === '其他'), false);
  assert.equal(card.breadth_scope, 'tracked_sample');
});

test('prelint and write card use one stock sector map', () => {
  const code = [
    "import importlib.util, runpy",
    "spec = importlib.util.spec_from_file_location('write_card', 'scripts/write-card.py')",
    "write_card = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(write_card)",
    "prelint = runpy.run_path('scripts/prelint-check.py')",
    "assert prelint['STOCK_SECTOR_MAP'] == write_card.load_sector_map()",
  ].join('; ');
  const result = spawnSync('python', ['-c', code], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('write card distinguishes first mentions from stocks absent yesterday', () => {
  const result = spawnSync('python', ['scripts/write-card.py', '2026-07-10'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const card = JSON.parse(result.stdout);

  assert.equal(card.new_stocks.includes('中国卫星'), false);
  assert.equal(card.reintroduced_stocks.includes('中国卫星'), true);
});

test('fallback market data rejects all-market breadth claims', () => {
  const marketData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'daily', '2026-07-10.json'), 'utf8'));
  const result = lintArticleWithMarketData('全市场普跌，涨跌家数很差。', marketData, { platform: 'wechat' });

  assert.equal(result.issues.some((item) => item.rule === 'fallback-market-breadth-claim'), true);
});

test('daily checker loads without deleted legacy modules', () => {
  assert.doesNotThrow(() => require('../scripts/run-daily-workflow'));
});

test('daily checker requires both manually written final articles and never generates them', () => {
  const { runDailyWorkflow } = require('../scripts/run-daily-workflow');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'financial-ip-daily-'));
  const date = '2026-07-10';
  const dataDir = path.join(rootDir, 'data', 'daily');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'data', 'daily', `${date}.json`), path.join(dataDir, `${date}.json`));
  fs.mkdirSync(path.join(rootDir, 'outputs', 'final'), { recursive: true });

  const result = runDailyWorkflow({ rootDir, date, skipFetch: true });

  assert.equal(result.ok, false);
  assert.equal(result.issues.filter((item) => item.rule === 'missing-required-article').length, 2);
});
