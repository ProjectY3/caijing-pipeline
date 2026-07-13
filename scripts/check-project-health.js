const fs = require('node:fs');
const path = require('node:path');
const { formatIssues } = require('./lint-articles');

const REQUIRED_FILES = [
  'AGENTS.md', 'package.json', 'rules/forbidden_words.json', 'rules/stock_name_abbreviations.json', 'rules/terminology_map.json',
  'scripts/fetch-market-data.js', 'scripts/write-card.py', 'scripts/prelint-check.py', 'scripts/lint-articles.js', 'scripts/run-daily-workflow.js', 'scripts/market-schema.js',
];
const REQUIRED_DIRECTORIES = ['data/daily', 'outputs/final', 'tests'];
const REQUIRED_SCRIPTS = ['test', 'data:fetch', 'write-card', 'prelint', 'check:wechat', 'check:xhs', 'daily', 'daily:check', 'health'];

function issue(rule, message, file, term = '') {
  return { rule, message, file, line: 1, column: 1, term, replacement: '' };
}

function runProjectHealthCheck(options = {}) {
  const rootDir = options.rootDir || path.join(__dirname, '..');
  const issues = [];
  for (const relativePath of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(rootDir, relativePath))) issues.push(issue('missing-required-file', `missing required file: ${relativePath}`, path.join(rootDir, relativePath), relativePath));
  }
  for (const relativePath of REQUIRED_DIRECTORIES) {
    const target = path.join(rootDir, relativePath);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) issues.push(issue('missing-required-directory', `missing required directory: ${relativePath}`, target, relativePath));
  }
  const packagePath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      for (const name of REQUIRED_SCRIPTS) if (!packageJson.scripts?.[name]) issues.push(issue('missing-package-script', `package.json missing script: ${name}`, packagePath, name));
    } catch (error) { issues.push(issue('invalid-json', error.message, packagePath)); }
  }
  for (const relativePath of ['rules/forbidden_words.json', 'rules/stock_name_abbreviations.json', 'rules/terminology_map.json']) {
    const target = path.join(rootDir, relativePath);
    if (!fs.existsSync(target)) continue;
    try { JSON.parse(fs.readFileSync(target, 'utf8')); } catch (error) { issues.push(issue('invalid-json', error.message, target)); }
  }
  return { ok: issues.length === 0, issues };
}

function main() {
  const result = runProjectHealthCheck();
  if (!result.ok) { console.error(formatIssues(result.issues)); process.exitCode = 1; return; }
  console.log('Project health check passed');
}

module.exports = { runProjectHealthCheck };
if (require.main === module) main();
