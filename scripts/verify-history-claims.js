const fs = require('node:fs');
const path = require('node:path');

const HISTORY_QUOTE_PATTERN = /(\d{1,2})\.(\d{1,2}).{0,20}?[说写提到]{1,2}了?.{0,6}[——:：]?[“"]([^”"]{6,120})[”"]/g;

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function normalizeText(text) {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, '')
    .replace(/[，。！？、；：:"“”'‘’（）()【】\[\]—\-_*`#>]/g, '');
}

function claimDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function candidateHistoryFiles(rootDir, date) {
  return [
    path.join(rootDir, 'outputs', 'final', `${date}-公众号.html`),
    path.join(rootDir, 'outputs', 'final', `${date}-公众号.md`),
    path.join(rootDir, 'daily-data', `${date}-公众号.md`),
  ];
}

function findHistoryClaims(text, marketData) {
  const year = String(marketData?.date || '').slice(0, 4);
  if (!year) return [];

  const claims = [];
  let match = HISTORY_QUOTE_PATTERN.exec(text);
  while (match) {
    claims.push({
      date: claimDate(year, match[1], match[2]),
      quote: match[3],
      index: match.index,
    });
    match = HISTORY_QUOTE_PATTERN.exec(text);
  }
  return claims;
}

function verifyHistoryClaims(text, marketData, options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const filePath = options.filePath || '';
  const issues = [];

  for (const claim of findHistoryClaims(text, marketData)) {
    const files = candidateHistoryFiles(rootDir, claim.date);
    const existingFiles = files.filter((candidate) => fs.existsSync(candidate));
    if (existingFiles.length === 0) {
      issues.push({
        rule: 'history-source-missing',
        message: `找不到历史公众号原文: ${claim.date}`,
        file: filePath,
        line: lineNumberForIndex(text, claim.index),
        term: claim.quote,
        replacement: '先补齐历史原文，或删除历史引用',
      });
      continue;
    }

    const normalizedQuote = normalizeText(claim.quote);
    const found = existingFiles.some((candidate) => normalizeText(fs.readFileSync(candidate, 'utf8')).includes(normalizedQuote));
    if (!found) {
      issues.push({
        rule: 'history-quote-not-found',
        message: `历史原文中找不到引用原话: ${claim.date}`,
        file: filePath,
        line: lineNumberForIndex(text, claim.index),
        term: claim.quote,
        replacement: '改成历史原文真实表述，或删除该引用',
      });
    }
  }

  return issues;
}

module.exports = {
  findHistoryClaims,
  verifyHistoryClaims,
};
