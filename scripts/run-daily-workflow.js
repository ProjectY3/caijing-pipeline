const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lintArticleWithMarketData, formatIssues } = require('./lint-articles');
const { lintHumanizer } = require('./lint-humanizer');
const { validateDailyMarketData } = require('./market-schema');
const { verifyHistoryClaims } = require('./verify-history-claims');

const REQUIRED_ARTICLES = [
  { suffix: '公众号.html', platform: 'wechat' },
  { suffix: '小红书抖音.md', platform: 'xhs', maxChars: 1000 },
];

function formatShanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function validateArticlePackage(rootDir, date) {
  const articleDir = path.join(rootDir, 'outputs', 'final');
  const issues = [];
  const articles = REQUIRED_ARTICLES.map((article) => ({
    ...article,
    filePath: path.join(articleDir, `${date}-${article.suffix}`),
  }));

  for (const article of articles) {
    if (!fs.existsSync(article.filePath)) {
      issues.push({ rule: 'missing-required-article', message: `缺少当天必需文章: ${path.basename(article.filePath)}`, file: article.filePath, line: 1 });
      continue;
    }
    if (Number.isFinite(article.maxChars) && fs.readFileSync(article.filePath, 'utf8').trim().length > article.maxChars) {
      issues.push({ rule: 'article-too-long', message: `文章超过 ${article.maxChars} 字符: ${path.basename(article.filePath)}`, file: article.filePath, line: 1 });
    }
  }
  return { ok: issues.length === 0, articles: articles.filter((article) => fs.existsSync(article.filePath)), issues };
}

function runFetch(rootDir) {
  const result = spawnSync(process.execPath, [path.join(rootDir, 'scripts', 'fetch-market-data.js')], { cwd: rootDir, encoding: 'utf8' });
  return result.status === 0
    ? { ok: true, issues: [] }
    : { ok: false, issues: [{ rule: 'fetch-failed', message: result.stderr || result.stdout || 'fetch-market-data.js failed', file: 'scripts/fetch-market-data.js', line: 1 }] };
}

function runWechatPrelint(rootDir, articlePath) {
  const result = spawnSync('python', [path.join(rootDir, 'scripts', 'prelint-check.py'), articlePath], { cwd: rootDir, encoding: 'utf8' });
  return result.status === 0 ? [] : [{ rule: 'wechat-prelint', message: result.stderr || result.stdout || 'prelint-check.py failed', file: articlePath, line: 1 }];
}

function runDailyWorkflow(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const date = options.date || formatShanghaiDate();
  const validated = [];

  if (!options.skipFetch) {
    const fetchResult = runFetch(rootDir);
    if (!fetchResult.ok) return { ok: false, date, rootDir, validated, issues: fetchResult.issues };
  }

  const dataPath = path.join(rootDir, 'data', 'daily', `${date}.json`);
  if (!fs.existsSync(dataPath)) {
    return { ok: false, date, rootDir, validated, issues: [{ rule: 'missing-market-data', message: `缺少标准数据: data/daily/${date}.json`, file: dataPath, line: 1 }] };
  }

  let marketData;
  try {
    marketData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    validateDailyMarketData(marketData);
    if (marketData.date !== date) throw new Error(`data date ${marketData.date} does not match ${date}`);
  } catch (error) {
    return { ok: false, date, rootDir, validated, issues: [{ rule: 'data-validation', message: error.message, file: dataPath, line: 1 }] };
  }

  const packageResult = validateArticlePackage(rootDir, date);
  const issues = [...packageResult.issues];
  for (const article of packageResult.articles) {
    const text = fs.readFileSync(article.filePath, 'utf8');
    const lintResult = lintArticleWithMarketData(text, marketData, { platform: article.platform, filePath: article.filePath, dataPath });
    issues.push(...lintResult.issues);
    issues.push(...verifyHistoryClaims(text, marketData, { rootDir, filePath: article.filePath }));
    if (article.platform === 'wechat') issues.push(...runWechatPrelint(rootDir, article.filePath));
    for (const item of lintHumanizer(text, { filePath: article.filePath }).filter((item) => item.level === 'error')) {
      issues.push({ ...item, rule: `humanizer:${item.rule}` });
    }
  }

  if (issues.length > 0) return { ok: false, date, rootDir, validated, issues };
  validated.push(...packageResult.articles.map((article) => path.basename(article.filePath)));
  return { ok: true, date, rootDir, validated, issues: [] };
}

function parseArgs(argv) {
  const args = { date: '', skipFetch: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--date') { args.date = argv[index + 1] || ''; index += 1; }
    if (argv[index] === '--skip-fetch') args.skipFetch = true;
  }
  return args;
}

function formatWorkflowFailure(result) {
  const rules = new Set(result.issues.map((item) => item.rule));
  const commands = rules.has('missing-market-data') || rules.has('data-validation') || rules.has('fetch-failed')
    ? ['npm.cmd run data:fetch', `npm.cmd run write-card -- ${result.date}`]
    : [`完成口述与两端文章后，运行 npm.cmd run daily:check -- --date ${result.date}`];
  return [`Daily workflow failed: ${result.date}`, `Issues: ${result.issues.length}`, formatIssues(result.issues), 'Next:', ...commands.map((command) => `- ${command}`)].filter(Boolean).join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runDailyWorkflow({ date: args.date || undefined, skipFetch: args.skipFetch });
  if (!result.ok) { console.error(formatWorkflowFailure(result)); process.exitCode = 1; return; }
  console.log(`Daily workflow passed: ${result.date}`);
  result.validated.forEach((fileName) => console.log(`Validated: outputs/final/${fileName}`));
}

module.exports = { formatWorkflowFailure, runDailyWorkflow, validateArticlePackage };
if (require.main === module) main();
