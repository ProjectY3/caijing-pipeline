const fs = require('node:fs');
const path = require('node:path');
const { validateDataFile } = require('./validate-data');
const { validateAnalysisResult } = require('./generate-analysis');
const { lintArticleWithMarketData, formatIssues } = require('./lint-articles');
const { verifyHistoryClaims } = require('./verify-history-claims');
const { formatShanghaiDate } = require('./generate-platform');
const { formatTradingContext, getTradingContext } = require('./trading-calendar');

const REQUIRED_ARTICLES = [
  { suffix: '\u516c\u4f17\u53f7.html', platform: 'wechat' },
  { suffix: '\u5c0f\u7ea2\u4e66\u6296\u97f3.md', maxChars: 1000, platform: 'xhs' },
];

function issue(rule, message, file, options = {}) {
  return {
    rule,
    message,
    file,
    line: 1,
    column: 1,
    term: options.term || '',
    replacement: options.replacement || '',
  };
}

function parseArgs(argv) {
  const args = { date: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--date') {
      args.date = argv[index + 1] || '';
      index += 1;
    }
  }
  return args;
}

function validateAnalysisFile(rootDir, issues) {
  const analysisPath = path.join(rootDir, 'outputs', 'final', 'analysis_result.json');
  if (!fs.existsSync(analysisPath)) {
    issues.push(issue('missing-analysis-result', 'missing outputs/final/analysis_result.json', analysisPath));
    return;
  }

  try {
    validateAnalysisResult(JSON.parse(fs.readFileSync(analysisPath, 'utf8')));
  } catch (error) {
    issues.push(issue('analysis-validation', error.message, analysisPath));
  }
}

function validateNoLegacyWechatMarkdown(rootDir, date, issues) {
  const markdownPath = path.join(rootDir, 'outputs', 'final', `${date}-\u516c\u4f17\u53f7.md`);
  if (!fs.existsSync(markdownPath)) return;
  issues.push(issue('legacy-wechat-markdown-output', `outputs/final must not keep legacy wechat markdown: ${date}-\u516c\u4f17\u53f7.md`, markdownPath, {
    term: `${date}-\u516c\u4f17\u53f7.md`,
    replacement: `${date}-\u516c\u4f17\u53f7.html`,
  }));
}

function runDailyStatus(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const date = options.date || formatShanghaiDate();
  const trading = getTradingContext(options.now || new Date());
  const issues = [];
  const checked = [];
  const dataPath = path.join(rootDir, 'data', 'daily', `${date}.json`);
  let marketData = null;

  if (!fs.existsSync(dataPath)) {
    issues.push(issue('missing-market-data', `missing standard data file: data/daily/${date}.json`, dataPath));
    return { ok: false, date, rootDir, checked, issues, trading };
  }

  const dataResult = validateDataFile(dataPath);
  checked.push(`data/daily/${date}.json`);
  if (!dataResult.ok) {
    issues.push(...dataResult.errors.map((message) => issue('data-validation', message, dataPath)));
    return { ok: false, date, rootDir, checked, issues, trading };
  }

  marketData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  if (marketData.date !== date) {
    issues.push(issue('data-date-mismatch', `data file date ${marketData.date} does not match requested date ${date}`, dataPath));
    return { ok: false, date, rootDir, checked, issues, trading };
  }

  validateAnalysisFile(rootDir, issues);
  checked.push('outputs/final/analysis_result.json');
  validateNoLegacyWechatMarkdown(rootDir, date, issues);

  for (const article of REQUIRED_ARTICLES) {
    const fileName = `${date}-${article.suffix}`;
    const filePath = path.join(rootDir, 'outputs', 'final', fileName);
    if (!fs.existsSync(filePath)) {
      issues.push(issue('missing-required-article', `missing required article: ${fileName}`, filePath));
      continue;
    }

    const text = fs.readFileSync(filePath, 'utf8');
    checked.push(`outputs/final/${fileName}`);
    const charCount = text.trim().length;
    if (Number.isFinite(article.minChars) && charCount < article.minChars) {
      issues.push(issue('article-too-short', `${fileName} content is too short, needs at least ${article.minChars} characters`, filePath, {
        replacement: `补足核心复盘段落，至少 ${article.minChars} 字符`,
      }));
      continue;
    }
    if (Number.isFinite(article.maxChars) && charCount > article.maxChars) {
      issues.push(issue('article-too-long', `${fileName} content is too long, must be at most ${article.maxChars} characters`, filePath, {
        replacement: `压缩到 ${article.maxChars} 字符以内，保留盘面结论、主线分化、免责声明`,
      }));
      continue;
    }

    const lintResult = lintArticleWithMarketData(text, marketData, {
      platform: article.platform,
      filePath,
      dataPath,
    });
    issues.push(...lintResult.issues);
    issues.push(...verifyHistoryClaims(text, marketData, { rootDir, filePath }));
  }

  return { ok: issues.length === 0, date, rootDir, checked, issues, trading };
}

function commandPrefix(rootDir) {
  if (!rootDir) return 'npm.cmd run';
  return `npm.cmd --prefix "${String(rootDir).replace(/"/g, '\\"')}" run`;
}

function nextCommandsForIssues(result) {
  const rules = new Set(result.issues.map((item) => item.rule));
  const commands = [];
  const date = result.date;
  const npm = commandPrefix(result.rootDir);

  if (rules.has('missing-market-data') || rules.has('data-validation') || rules.has('data-date-mismatch')) {
    commands.push(`${npm} data:fetch`);
    commands.push(`${npm} data:validate -- data/daily/${date}.json`);
    return commands;
  }

  if (rules.has('missing-analysis-result') || rules.has('analysis-validation')) {
    commands.push(`${npm} analysis:generate -- data/daily/${date}.json`);
  }

  if (rules.has('missing-required-article') || rules.has('article-too-short') || rules.has('article-too-long')) {
    commands.push(`${npm} articles:init -- --date ${date}`);
  }

  commands.push(`${npm} generate-wechat -- --date ${date}`);
  commands.push(`${npm} generate-xhs -- --date ${date}`);
  commands.push(`${npm} daily:check -- --date ${date}`);

  return [...new Set(commands)];
}

function formatStatusFailure(result) {
  const commands = nextCommandsForIssues(result);
  const sections = [
    `Daily status failed: ${result.date}`,
    `Issues: ${result.issues.length}`,
    formatIssues(result.issues),
  ];

  if (commands.length > 0) {
    sections.push('Next commands:');
    sections.push(commands.map((command) => `- ${command}`).join('\n'));
  }

  return sections.filter(Boolean).join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runDailyStatus({ date: args.date || undefined });

  console.log(`Daily status: ${result.date}`);
  console.log(formatTradingContext(result.trading));
  for (const item of result.checked) {
    console.log(`Checked: ${item}`);
  }

  if (!result.ok) {
    console.error(formatStatusFailure(result));
    process.exitCode = 1;
    return;
  }

  console.log('Daily status passed');
}

module.exports = {
  REQUIRED_ARTICLES,
  commandPrefix,
  formatStatusFailure,
  nextCommandsForIssues,
  runDailyStatus,
};

if (require.main === module) {
  main();
}
