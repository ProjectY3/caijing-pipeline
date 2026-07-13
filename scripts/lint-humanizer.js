const fs = require('node:fs');
const path = require('node:path');

// AI pattern rules — matches patterns from humanizer skill's 29 rules,
// adapted for 鲸多多 IP voice (Chinese financial content)
const AI_PATTERNS = [
  // ── Template section headers (骨架标题，润色时必须替换) ──
  {
    rule: 'ai-section-header',
    level: 'error',
    pattern: /<p[^>]*font-size:20px[^>]*>([^<]*)先说盘面([^<]*)<\/p>/gi,
    message: 'AI骨架标题"先说盘面"应替换为IP口吻标题',
    fix: '删除或用"今天盘面"以外的标题替代',
  },
  {
    rule: 'ai-section-header',
    level: 'error',
    pattern: /<p[^>]*font-size:20px[^>]*>([^<]*)主线拆解([^<]*)<\/p>/gi,
    message: 'AI骨架标题"主线拆解"应替换为"板块逐个看"或IP口吻标题',
    fix: '替换为"板块逐个看"',
  },
  {
    rule: 'ai-section-header',
    level: 'error',
    pattern: /<p[^>]*font-size:20px[^>]*>([^<]*)跟踪池对账([^<]*)<\/p>/gi,
    message: 'AI骨架标题"跟踪池对账"应替换为"昨天说的，今天表现如何？"',
    fix: '替换',
  },
  {
    rule: 'ai-section-header',
    level: 'warn',
    pattern: /<p[^>]*font-size:20px[^>]*>([^<]*)后花园这边——([^<]*)<\/p>/gi,
    message: '"后花园这边——"破折号过渡AI味重，改为自然过渡',
    fix: '去掉破折号或改为"板块逐个看"风格',
  },
  {
    rule: 'ai-section-header',
    level: 'warn',
    pattern: /<p[^>]*font-size:20px[^>]*>([^<]*)海外背景([^<]*)<\/p>/gi,
    message: '海外市场不应单独开红底白字版块，融进开篇叙事',
    fix: '去掉独立标题，内容融入开篇或大盘分析',
  },

  // ── Fake depth patterns (假深度句式) ──
  {
    rule: 'ai-deep-insight',
    level: 'error',
    pattern: /不是.{1,8}坏了.{0,5}是.{1,30}/g,
    message: '假深度句式"不是X坏了，是Y"→AI经典"深层分析"腔',
    fix: '去掉"不是X是Y"结构，直接陈述事实。如"不是方向坏了，是系统性杀跌"→"系统性杀跌，不分好坏全砸"',
  },
  {
    rule: 'ai-deep-insight',
    level: 'warn',
    pattern: /真正的问题是|核心在于|本质上|深层次看/g,
    message: '卖弄深度句式→假装有独到见解，实际是AI套话',
    fix: '删掉前缀，直接说事实',
  },

  // ── AI万能金句 ──
  {
    rule: 'ai-generic-positive',
    level: 'error',
    pattern: /方向对了.{0,10}都会来/g,
    message: 'AI万能金句"方向对了该来的都会来"→放哪篇文章都能用',
    fix: '替换为当天具体战绩或具体CTA',
  },
  {
    rule: 'ai-generic-positive',
    level: 'error',
    pattern: /不是碰巧.{0,10}方向走对/g,
    message: 'AI万能金句"不是碰巧，方向走对了"→万能结尾',
    fix: '替换为具体CTA或当天战绩',
  },
  {
    rule: 'ai-generic-positive',
    level: 'error',
    pattern: /一条完整的.{0,10}产业链.{0,10}铺开/g,
    message: 'AI万能金句"完整的XX产业链铺开了"→宏大叙事结尾',
    fix: '砍掉，用具体票+情绪收尾',
  },

  // ── Triple emphasis (叠加强调) ──
  {
    rule: 'ai-triple-emphasis',
    level: 'warn',
    pattern: /(.)不看(.)不碰(.)不/g,
    message: '三连强调"不看不碰不XX"→AI标配叠词',
    fix: '留一个最强的词即可',
  },

  // ── Market judgment (替市场做判断) ──
  {
    rule: 'ai-judgment',
    level: 'error',
    pattern: /没人看|全市场都在等|资金全在盯|全市场都在/g,
    message: '替市场做判断→假装知道全市场在想什么',
    fix: '诚实说"我们没覆盖这个方向"/"我们之前没看"，不要替市场发言',
  },

  // ── Em-dash density (破折号密度) ──
  {
    rule: 'ai-dash-density',
    level: 'warn',
    pattern: null, // checked manually below
    check: (text) => {
      const clean = text.replace(/<[^>]+>/g, '');
      const dashes = (clean.match(/——/g) || []).length;
      if (dashes > 20) return `全文破折号 ${dashes} 个，超过20个阈值。AI常用破折号制造"推理→结论"节奏`;
      return null;
    },
  },

  // ── Boast-ratio check (吹牛密度) ──
  {
    rule: 'ai-boast-ratio',
    level: 'warn',
    pattern: null,
    check: (text) => {
      const clean = text.replace(/<[^>]+>/g, '');
      const boasts = (clean.match(/验证了|全验证|方向全对|又中了|提前判断|先见之明/g) || []).length;
      const losers = (clean.match(/跌停|大跌|被砸|被埋|回调|绿/g) || []).length;
      if (boasts > 3 && boasts > losers) {
        return `吹牛信号 ${boasts} 次 > 下跌信号 ${losers} 次。暴跌日吹牛密度过高，读者一眼看穿`;
      }
      return null;
    },
  },

  // ── Stock repetition (个股重复) ──
  {
    rule: 'stock-repetition',
    level: 'warn',
    pattern: null,
    check: (text) => {
      const clean = text.replace(/<[^>]+>/g, '');
      const stocks = {};
      const matches = clean.matchAll(/([\u4e00-\u9fa5]{1,4})同学/g);
      for (const m of matches) {
        stocks[m[1]] = (stocks[m[1]] || 0) + 1;
      }
      const overLimit = Object.entries(stocks).filter(([, count]) => count > 4);
      if (overLimit.length > 0) {
        return overLimit.map(([name, count]) => `${name}同学出现 ${count} 次>4次`).join('；');
      }
      return null;
    },
  },

  // ── Breadth-as-market (涨跌家数当全市场数据) ──
  {
    rule: 'ai-breadth-claim',
    level: 'error',
    pattern: /(\d+)只红.{0,10}(\d+)只绿/g,
    message: '涨跌家数只是跟踪池统计(44只)，不是全市场5000+只数据。tencent-fallback时绝对不能写入文章',
    fix: '删掉具体数字，用"全线回调""普遍下跌"替代',
  },

  // ── Preview tone (预览口吻泄漏) ──
  {
    rule: 'ai-preview-tone',
    level: 'warn',
    pattern: /往下看|认真看这一段|重点看这里|注意了/g,
    message: 'AI预览口吻"往下看/认真看/重点看"→类似营销文案',
    fix: '直接写内容，不要预告',
  },
];

function stripHtml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function lintHumanizer(text, options = {}) {
  const filePath = options.filePath || 'article';
  const issues = [];

  for (const rule of AI_PATTERNS) {
    if (rule.check) {
      const result = rule.check(text);
      if (result) {
        issues.push({
          rule: rule.rule,
          level: rule.level,
          message: result,
          file: filePath,
          line: 1,
          fix: rule.fix || '',
        });
      }
      continue;
    }

    if (!rule.pattern) continue;

    // Reset lastIndex for global regex
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(text)) !== null) {
      const line = lineNumberForIndex(text, match.index);
      issues.push({
        rule: rule.rule,
        level: rule.level,
        message: rule.message,
        file: filePath,
        line,
        column: match.index - text.lastIndexOf('\n', match.index),
        fix: rule.fix || '',
      });
    }
  }

  return issues;
}

function formatHumanizerIssues(issues) {
  if (issues.length === 0) return '';
  const byLevel = { error: [], warn: [] };
  for (const issue of issues) {
    byLevel[issue.level] = byLevel[issue.level] || [];
    byLevel[issue.level].push(issue);
  }
  const lines = [];
  if (byLevel.error.length > 0) {
    lines.push(`❌ ${byLevel.error.length} 个AI腔错误（必须修复）:`);
    for (const issue of byLevel.error) {
      lines.push(`  [${issue.rule}] ${issue.message}`);
      if (issue.fix) lines.push(`    建议: ${issue.fix}`);
    }
  }
  if (byLevel.warn.length > 0) {
    lines.push(`⚠️ ${byLevel.warn.length} 个AI腔警告:`);
    for (const issue of byLevel.warn) {
      lines.push(`  [${issue.rule}] ${issue.message}`);
    }
  }
  return lines.join('\n');
}

// Export for use in run-daily-workflow.js
module.exports = { lintHumanizer, formatHumanizerIssues, AI_PATTERNS };

// CLI entry: node scripts/lint-humanizer.js --date YYYY-MM-DD
function main() {
  const args = process.argv.slice(2);
  let date = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date') date = args[i + 1] || '';
  }

  const rootDir = path.join(__dirname, '..');
  const articlePath = date
    ? path.join(rootDir, 'outputs', 'final', `${date}-公众号.html`)
    : null;

  if (!articlePath || !fs.existsSync(articlePath)) {
    console.error(`Article not found: ${articlePath}`);
    process.exitCode = 1;
    return;
  }

  const text = fs.readFileSync(articlePath, 'utf8');
  const issues = lintHumanizer(text, { filePath: articlePath });

  if (issues.length > 0) {
    const formatted = formatHumanizerIssues(issues);
    console.error(formatted);

    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length > 0) {
      console.error(`\nHumanizer check FAILED: ${errors.length} errors must be fixed`);
      process.exitCode = 1;
      return;
    }
    console.log('\nHumanizer check PASSED (warnings only)');
    return;
  }

  console.log('Humanizer check PASSED');
}

if (require.main === module) {
  main();
}
