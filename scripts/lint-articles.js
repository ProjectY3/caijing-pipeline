const fs = require('node:fs');
const path = require('node:path');

const forbiddenConfig = require('../rules/forbidden_words.json');
const terminologyConfig = require('../rules/terminology_map.json');
const stockNameAbbreviations = require('../rules/stock_name_abbreviations.json');
const { validateDailyMarketData } = require('./market-schema');

const HTML_LIST_TAG_PATTERN = /<\/?(ul|ol|li)(\s|>)/i;
const SECTOR_CLAIM_PATTERN = /((?:小金属|能源金属|电子化学品|半导体材料|工业气体|光刻胶|特气|板块\d+|[\u4e00-\u9fa5A-Za-z0-9]{2,16}(?:板块|方向))).{0,20}(\+?\d+(?:\.\d+)?%|涨了\d+(?:\.\d+)?%?)/g;
const STOCK_PERFORMANCE_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9]{2,16})同学.{0,12}[+-]?\d+(?:\.\d+)?%/g;
const STOCK_MENTION_PATTERN = /(?:^|[\s，。、“”（）【】—\-_*：:>!！])([\u4e00-\u9fa5A-Za-z0-9]{2,16})同学/g;
const PRECISE_STOCK_PERCENT_PATTERN = /([\u4e00-\u9fa5A-Za-z0-9]{2,16})同学[^。！？\n]{0,60}[+-]?\d+(?:\.\d+)?%|(?:当日)?收益\d+(?:\.\d+)?%/g;
const STOCK_CODE_PATTERN = /(?<!\d)(?:00|30|60|68)\d{4}(?!\d)/g;
const DISCLAIMER_PATTERN = /不构成任何(?:投资)?建议/;
const XHS_MARKET_INDEX_TERMS = ['上证', '深成指', '创业板', '科创50', '沪指', '指数'];
const XHS_EXPLICIT_SECTOR_TERMS = [
  '黄金', '航天航空', '通用航空', '券商', '证券', '银行',
  'MLCC', 'PCB', 'CPO', '储能', '存储', '光通信', '通信设备',
  '自动化设备', '光伏设备', '电池', '元件', '中报方向',
];
const XHS_PERCENT_PATTERN = /[+-]?\d+(?:\.\d+)?%/g;
const XHS_BREADTH_COUNT_PATTERN = /\d{3,5}家/g;
const XHS_AMOUNT_PATTERN = /\d+(?:\.\d+)?多?亿/g;
const XHS_ACTION_GUIDANCE_TERMS = ['提前炒', '低位确定性', '小仓打野', '重心转移', '高位硬撑', '接力', '端午后可能'];
const XHS_REQUIRED_SECTIONS = ['# 封面标题', '# 正文', '# 置顶评论'];
const XHS_REQUIRED_SOFT_TERMS = [
  '股票',
  '股市',
  'A股',
  '资金',
  '市场',
  '关注',
  '上涨',
  '下跌',
  '新高',
  '仓位',
  '加仓',
  '减仓',
  '赚钱',
  '做空',
  '空仓',
];

function lineNumberForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function isAllowedContext(line, term) {
  if (term === '建议' && /不构成任何投资建议/.test(line)) return true;
  if (term === '建议' && /不构成任何建议/.test(line)) return true;
  if (term === '推荐' && /不代表推荐/.test(line)) return true;
  return false;
}

function issue(rule, message, options = {}) {
  return {
    rule,
    message,
    file: options.filePath || '',
    line: options.line || 1,
    column: options.column || 1,
    term: options.term || '',
    replacement: options.replacement || '',
  };
}

function sectionBody(text, section) {
  const start = text.indexOf(section);
  if (start === -1) return '';
  const contentStart = start + section.length;
  const nextStarts = XHS_REQUIRED_SECTIONS
    .filter((candidate) => candidate !== section)
    .map((candidate) => text.indexOf(candidate, contentStart))
    .filter((index) => index !== -1);
  const contentEnd = nextStarts.length > 0 ? Math.min(...nextStarts) : text.length;
  return text.slice(contentStart, contentEnd).trim();
}

function findChoppyBodyRun(text) {
  const lines = sectionBody(text, '# 正文')
    .split(/\r?\n/)
    .map((line) => line.trim());
  let runStart = -1;
  let runLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isShortContent = line && !line.startsWith('#') && [...line].length <= 6 && !DISCLAIMER_PATTERN.test(line);
    if (isShortContent) {
      if (runLength === 0) runStart = index;
      runLength += 1;
      if (runLength >= 4) return { lineOffset: runStart + 1, runLength };
      continue;
    }
    runStart = -1;
    runLength = 0;
  }

  return null;
}

function effectiveXhsBodyParagraphs(text) {
  return sectionBody(text, '# 正文')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !DISCLAIMER_PATTERN.test(paragraph));
}

function lintArticleText(text, options = {}) {
  const filePath = options.filePath || '';
  const platform = options.platform || (filePath.includes('小红书') ? 'xhs' : 'wechat');
  const issues = [];
  const lines = text.split(/\r?\n/);

  for (const entry of forbiddenConfig.terms) {
    if (Array.isArray(entry.platforms) && !entry.platforms.includes(platform)) continue;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line.includes(entry.term)) continue;
      if (isAllowedContext(line, entry.term)) continue;

      issues.push(issue('forbidden-word', `命中禁词: ${entry.term}`, {
        filePath,
        line: lineIndex + 1,
        column: line.indexOf(entry.term) + 1,
        term: entry.term,
        replacement: entry.replacement,
      }));
    }
  }

  const htmlMatch = HTML_LIST_TAG_PATTERN.exec(text);
  if (htmlMatch) {
    issues.push(issue('html-list-tag', 'HTML 禁止使用 ul/ol/li 列表结构', {
      filePath,
      line: lineNumberForIndex(text, htmlMatch.index),
      column: 1,
      term: htmlMatch[0],
      replacement: '<p>段落 + 手动编号</p>',
    }));
  }

  if (!DISCLAIMER_PATTERN.test(text)) {
    issues.push(issue('missing-disclaimer', '缺少免责声明', {
      filePath,
      line: Math.max(lines.length, 1),
      column: 1,
      replacement: '以上仅为个人复盘记录，不构成任何投资建议。',
    }));
  }

  // 检查个股是否使用全名（应该使用简称）
  if (platform === 'wechat') {
    PRECISE_STOCK_PERCENT_PATTERN.lastIndex = 0;
    let precisePercentMatch = PRECISE_STOCK_PERCENT_PATTERN.exec(text);
    while (precisePercentMatch) {
      const matchText = precisePercentMatch[0];
      const matchIndex = precisePercentMatch.index;

      // 查找匹配文本所在的段落标题
      const textBefore = text.slice(0, matchIndex);
      const lastTitleMatch = /<p style="[^"]*font-size:20px[^"]*">([^<]+)<\/p>/g;
      let currentTitle = '';
      let titleMatch;
      while ((titleMatch = lastTitleMatch.exec(textBefore)) !== null) {
        currentTitle = titleMatch[1];
      }

      // 如果在”昨天说的票”板块内，允许精确百分比（用于详细对账验证）
      const isInVerificationSection = /昨天说的票|今天表现如何/.test(currentTitle);

      if (!isInVerificationSection) {
        issues.push(issue('precise-stock-percent', '公众号个股表现不要写精确百分比，改成接近/超过/前排/明显走强等表达', {
          filePath,
          line: lineNumberForIndex(text, matchIndex),
          column: 1,
          term: matchText,
          replacement: '改成”涨幅接近X个点””涨幅超过X个点””在前排””明显走强”等模糊表达',
        }));
      }
      precisePercentMatch = PRECISE_STOCK_PERCENT_PATTERN.exec(text);
    }

    for (const [fullName, shortName] of Object.entries(stockNameAbbreviations.mappings)) {
      const fullPattern = new RegExp(`${fullName}同学`, 'g');
      let match = fullPattern.exec(text);
      while (match) {
        issues.push(issue('stock-full-name', `个股应使用简称: ${fullName}同学 → ${shortName}同学`, {
          filePath,
          line: lineNumberForIndex(text, match.index),
          column: 1,
          term: `${fullName}同学`,
          replacement: `${shortName}同学`,
        }));
        match = fullPattern.exec(text);
      }
    }

    // === NEW: 重复检测 — 同一个个股简称+同学出现超过阈值 ===
    const REPETITION_MAX_STOCK = 4;  // 明星票可到4次，普通票触发
    for (const shortName of [...new Set(Object.values(stockNameAbbreviations.mappings))]) {
      const pattern = new RegExp(`${shortName}同学`, 'g');
      const count = (text.match(pattern) || []).length;
      if (count > REPETITION_MAX_STOCK) {
        issues.push(issue('stock-repetition', `个股 ${shortName}同学 全文出现 ${count} 次（阈值 ${REPETITION_MAX_STOCK}），请合并冗余提及`, {
          filePath,
          line: 1,
          column: 1,
          term: `${shortName}同学`,
          replacement: '全文中每个票的核心数据只写一次，不同段落从不同角度提及',
        }));
      }
    }

    // === NEW: AI句式检测 — 常见模板化表达 ===
    const AI_PATTERNS = [
      {
        name: 'ai-section-header',
        pattern: /后花园今天怎么走的|今天盘面表现如何|让我们来看看今天的数据/g,
        message: 'AI模板段落标题，改成更自然的过渡',
        replacement: '改成“后花园这边——”“今天呢？”等口语化表达',
      },
      {
        name: 'ai-deep-insight',
        pattern: /真正的问题是|核心在于|本质上说|说到底|这里面藏着更大的/g,
        message: 'AI“假装看透本质”句式',
        replacement: '直接说事实，不加“真正的问题是”这类包装',
      },
      {
        name: 'ai-generic-positive',
        pattern: /方向对了.{0,10}该来的都会来|前途一片光明|未来可期|值得期待/g,
        message: 'AI通用积极结尾，放哪篇文章都能用',
        replacement: '换成具体战绩或具体CTA',
      },
      {
        name: 'ai-triple-emphasis',
        pattern: /不[看碰摸追跟].{0,2}不[看碰摸追跟].{0,2}不[看碰摸追跟]/g,
        message: 'AI三连叠加强调（“不看不碰不纠结”式），真人说一次就够了',
        replacement: '砍掉两个，只留一个最强的',
      },
      {
        name: 'ai-preview-tone',
        pattern: /往下看！！|认真看这一段|重点来了！！|下面才是重点/g,
        message: 'AI预告腔，读者自己会往下看',
        replacement: '直接写内容，不喊“往下看”',
      },
      {
        name: 'ai-judgment',
        pattern: /没人看|全市场都在等|资金全在盯|所有人都在/g,
        message: '替市场做判断，假装知道全市场在想什么',
        replacement: '诚实说“我们没覆盖这个方向”或不评价',
      },
    ];

    for (const aiCheck of AI_PATTERNS) {
      aiCheck.pattern.lastIndex = 0;
      let match = aiCheck.pattern.exec(text);
      while (match) {
        issues.push(issue(aiCheck.name, aiCheck.message, {
          filePath,
          line: lineNumberForIndex(text, match.index),
          column: 1,
          term: match[0],
          replacement: aiCheck.replacement,
        }));
        match = aiCheck.pattern.exec(text);
      }
    }
  }

  if (platform === 'xhs') {
    for (const section of XHS_REQUIRED_SECTIONS) {
      if (text.includes(section)) continue;
      issues.push(issue('xhs-missing-section', `小红书/抖音缺少固定发布段落: ${section}`, {
        filePath,
        line: 1,
        column: 1,
        term: section,
        replacement: `补齐 ${section} 段落`,
      }));
    }

    for (const section of XHS_REQUIRED_SECTIONS) {
      if (!text.includes(section)) continue;
      if (sectionBody(text, section)) continue;
      issues.push(issue('xhs-empty-section', `小红书/抖音固定段落不能为空: ${section}`, {
        filePath,
        line: lineNumberForIndex(text, text.indexOf(section)),
        column: 1,
        term: section,
        replacement: `补齐 ${section} 段落内容`,
      }));
    }

    const sectionIndexes = XHS_REQUIRED_SECTIONS.map((section) => text.indexOf(section));
    if (sectionIndexes.every((index) => index !== -1)) {
      for (let index = 1; index < sectionIndexes.length; index += 1) {
        if (sectionIndexes[index] > sectionIndexes[index - 1]) continue;
        issues.push(issue('xhs-section-order', '小红书/抖音固定段落顺序错误', {
          filePath,
          line: lineNumberForIndex(text, sectionIndexes[index]),
          column: 1,
          term: XHS_REQUIRED_SECTIONS[index],
          replacement: '按 # 封面标题 → # 发布标题 → # 正文 → # 置顶评论 → # 可选图片页 排列',
        }));
        break;
      }
    }

    if (text.includes('# 正文') && !DISCLAIMER_PATTERN.test(sectionBody(text, '# 正文'))) {
      issues.push(issue('xhs-disclaimer-outside-body', '小红书/抖音免责声明必须放在正文段落内', {
        filePath,
        line: lineNumberForIndex(text, text.indexOf('# 正文')),
        column: 1,
        term: '# 正文',
        replacement: '把“以上仅为个人柿场观察与复盘记录，不构成任何建议。”放进 # 正文 段落末尾',
      }));
    }

    const bodyParagraphs = effectiveXhsBodyParagraphs(text);
    if (text.includes('# 正文') && bodyParagraphs.length < 2) {
      issues.push(issue('xhs-body-too-thin', '小红书/抖音正文至少需要两段有效复盘内容', {
        filePath,
        line: lineNumberForIndex(text, text.indexOf('# 正文')),
        column: 1,
        term: '# 正文',
        replacement: '正文至少两段：一段写盘面现象/对账，一段写结构逻辑/观察信号，最后再放免责声明',
      }));
    }

    const choppyBodyRun = findChoppyBodyRun(text);
    if (choppyBodyRun) {
      issues.push(issue('xhs-choppy-body-lines', '小红书/抖音正文不能写成连续碎短行', {
        filePath,
        line: lineNumberForIndex(text, text.indexOf('# 正文')) + choppyBodyRun.lineOffset,
        column: 1,
        term: '# 正文',
        replacement: '把连续短句合并成 2-4 个自然段',
      }));
    }

    for (const term of XHS_MARKET_INDEX_TERMS) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.includes(term)) continue;
        issues.push(issue('xhs-objective-market-data', `小红书/抖音不写具体指数或客观行情数据: ${term}`, {
          filePath,
          line: lineIndex + 1,
          column: line.indexOf(term) + 1,
          term,
          replacement: '改成“盘面/结构/权重/情绪”等模糊复盘表达',
        }));
      }
    }

    for (const pattern of [XHS_PERCENT_PATTERN, XHS_BREADTH_COUNT_PATTERN, XHS_AMOUNT_PATTERN]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(text);
      while (match) {
        issues.push(issue('xhs-objective-market-data', '小红书/抖音不写具体涨跌幅、家数、金额等客观行情数字', {
          filePath,
          line: lineNumberForIndex(text, match.index),
          column: 1,
          term: match[0],
          replacement: '改成“正反馈明显 / 扩散不错 / 分化还在”等模糊表达',
        }));
        match = pattern.exec(text);
      }
    }

    for (const term of XHS_EXPLICIT_SECTOR_TERMS) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.includes(term)) continue;
        issues.push(issue('xhs-explicit-sector-list', `小红书/抖音不直接列具体板块数据: ${term}`, {
          filePath,
          line: lineIndex + 1,
          column: line.indexOf(term) + 1,
          term,
          replacement: '改成“权重方向 / 资源线 / 防御线 / 低空叙事 / 金融线索”等泛化表达',
        }));
      }
    }

    const xhsConcreteStockTerms = new Set([
      ...Object.keys(stockNameAbbreviations.mappings || {}),
      ...Object.values(stockNameAbbreviations.mappings || {}),
    ].filter((name) => typeof name === 'string' && [...name].length >= 2));
    for (const term of xhsConcreteStockTerms) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.includes(term)) continue;
        issues.push(issue('xhs-concrete-stock-name', `小红书/抖音禁止出现具体标的名称或简称: ${term}`, {
          filePath,
          line: lineIndex + 1,
          column: line.indexOf(term) + 1,
          term,
          replacement: '改成“某条线 / 老朋友 / 前排方向 / 低位分支”等泛化表达',
        }));
      }
    }

    for (const term of XHS_ACTION_GUIDANCE_TERMS) {
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.includes(term)) continue;
        issues.push(issue('xhs-action-guidance', `小红书/抖音不写强操作或炒作预期表达: ${term}`, {
          filePath,
          line: lineIndex + 1,
          column: line.indexOf(term) + 1,
          term,
          replacement: '改成“后续只记录承接变化 / 结构还要继续观察”等复盘口径',
        }));
      }
    }

    for (const term of XHS_REQUIRED_SOFT_TERMS) {
      const replacement = terminologyConfig.replacements?.[term] || '';
      if (!replacement) continue;

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.includes(term)) continue;
        issues.push(issue('xhs-terminology-source', `小红书/抖音需要使用软化表达: ${term}`, {
          filePath,
          line: lineIndex + 1,
          column: line.indexOf(term) + 1,
          term,
          replacement,
        }));
      }
    }

    for (const mention of findStockMentions(text)) {
      issues.push(issue('xhs-concrete-stock-name', '小红书/抖音禁止出现具体标的名称', {
        filePath,
        line: lineNumberForIndex(text, mention.index),
        term: mention.name,
        replacement: '改成板块/方向表达',
      }));
    }

    let codeMatch = STOCK_CODE_PATTERN.exec(text);
    while (codeMatch) {
      issues.push(issue('stock-code', '小红书/抖音禁止出现股票代码', {
        filePath,
        line: lineNumberForIndex(text, codeMatch.index),
        term: codeMatch[0],
        replacement: '删除代码，改用板块/方向表达',
      }));
      codeMatch = STOCK_CODE_PATTERN.exec(text);
    }
  }

  issues.sort((a, b) => (a.line - b.line) || (a.column - b.column) || a.rule.localeCompare(b.rule));

  return {
    ok: issues.length === 0,
    issues,
  };
}

function hasSectorRows(marketData) {
  return Array.isArray(marketData?.sectors?.all) && marketData.sectors.all.length > 0;
}

function allowedSectorNames(marketData) {
  const rows = [
    ...(marketData?.sectors?.all || []),
    ...(marketData?.sectors?.top || []),
    ...(marketData?.sectors?.falling || []),
  ];
  return new Set(rows.map((sector) => sector.name).filter(Boolean));
}

function allowedStockNames(marketData) {
  const rows = [
    ...(marketData?.hot_stocks || []),
    ...(marketData?.tracked_stocks || []),
  ];
  const fullNames = new Set(rows.map((stock) => stock.name).filter(Boolean));

  // 添加简称映射：如果全名在数据中，简称也是允许的
  const allowedNames = new Set(fullNames);
  for (const fullName of fullNames) {
    const shortName = Object.entries(stockNameAbbreviations.mappings)
      .find(([full]) => full === fullName)?.[1];
    if (shortName) {
      allowedNames.add(shortName);
    }
  }

  return allowedNames;
}

function findStockPerformanceClaims(text) {
  const claims = [];
  STOCK_PERFORMANCE_PATTERN.lastIndex = 0;
  let match = STOCK_PERFORMANCE_PATTERN.exec(text);
  while (match) {
    claims.push({
      name: match[1],
      text: match[0],
      index: match.index,
    });
    match = STOCK_PERFORMANCE_PATTERN.exec(text);
  }
  return claims;
}

function findStockMentions(text) {
  const mentions = [];
  STOCK_MENTION_PATTERN.lastIndex = 0;
  let match = STOCK_MENTION_PATTERN.exec(text);
  while (match) {
    mentions.push({
      name: match[1],
      text: match[0],
      index: match.index,
    });
    match = STOCK_MENTION_PATTERN.exec(text);
  }
  return mentions;
}

function findSectorClaims(text) {
  const claims = [];
  SECTOR_CLAIM_PATTERN.lastIndex = 0;
  let match = SECTOR_CLAIM_PATTERN.exec(text);
  while (match) {
    claims.push({
      name: match[1],
      text: match[0],
      index: match.index,
    });
    match = SECTOR_CLAIM_PATTERN.exec(text);
  }
  return claims;
}

function resolveAllowedStockName(rawName, stockNames) {
  if (stockNames.has(rawName)) return rawName;
  const matches = [...stockNames].filter((name) => rawName.endsWith(name));
  if (matches.length === 0) return '';
  return matches.sort((a, b) => b.length - a.length)[0];
}

function lintArticleWithMarketData(text, marketData, options = {}) {
  const result = lintArticleText(text, options);
  try {
    validateDailyMarketData(marketData);
  } catch (error) {
    result.issues.push(issue('market-data-validation', `标准市场数据校验失败: ${error.message}`, {
      filePath: options.dataPath || '',
      line: 1,
    }));
    result.ok = false;
    return result;
  }

  const sectorClaims = findSectorClaims(text);
  const sectorNames = allowedSectorNames(marketData);
  const stockNames = allowedStockNames(marketData);

  if (String(marketData.source || '').endsWith(':tencent-fallback')) {
    for (const term of ['全市场', '全A股', '涨跌家数', '普涨', '普跌']) {
      const index = text.indexOf(term);
      if (index === -1) continue;
      result.issues.push(issue('fallback-market-breadth-claim', '腾讯 fallback 仅覆盖跟踪样本，不能写成全市场涨跌或涨跌家数判断', {
        filePath: options.filePath || '',
        line: lineNumberForIndex(text, index),
        column: index - text.lastIndexOf('\n', index),
        term,
        replacement: '改为“跟踪样本偏弱/偏强”，或删除全市场表述',
      }));
    }
  }

  for (const sectorClaim of sectorClaims) {
    if (!hasSectorRows(marketData)) {
      result.issues.push(issue('market-data-missing-sectors', '文章引用了板块涨跌，但市场数据 sectors 为空', {
        filePath: options.filePath || '',
        line: lineNumberForIndex(text, sectorClaim.index),
        term: sectorClaim.text,
        replacement: '先重新抓取标准市场数据，或删除板块涨跌表述',
      }));
      continue;
    }

    if (!sectorNames.has(sectorClaim.name)) {
      result.issues.push(issue('sector-not-in-market-data', '文章引用了板块表现，但当日标准数据中找不到该板块', {
        filePath: options.filePath || '',
        line: lineNumberForIndex(text, sectorClaim.index),
        term: sectorClaim.name,
        replacement: '改成标准数据里的板块名称，或删除具体涨跌幅表述',
      }));
    }
  }

  const reportedUnknownStocks = new Set();
  for (const claim of findStockPerformanceClaims(text)) {
    if (resolveAllowedStockName(claim.name, stockNames)) continue;
    reportedUnknownStocks.add(claim.name);
    result.issues.push(issue('stock-not-in-market-data', '文章引用了具体标的表现，但当天标准数据中找不到该标的', {
      filePath: options.filePath || '',
      line: lineNumberForIndex(text, claim.index),
      term: claim.name,
      replacement: '先单独补抓该标的数据，或删除具体涨跌幅表述',
    }));
  }

  for (const mention of findStockMentions(text)) {
    if (resolveAllowedStockName(mention.name, stockNames)) continue;
    if (reportedUnknownStocks.has(mention.name)) continue;
    reportedUnknownStocks.add(mention.name);
    result.issues.push(issue('stock-not-in-market-data', '文章提到了具体标的，但当天标准数据中找不到该标的', {
      filePath: options.filePath || '',
      line: lineNumberForIndex(text, mention.index),
      term: mention.name,
      replacement: '先单独补抓该标的数据，或改成板块/方向表达',
    }));
  }

  result.ok = result.issues.length === 0;
  return result;
}

function formatIssues(issues) {
  return issues.map((item) => {
    const location = `${item.file}:${item.line}:${item.column || 1}`;
    const replacement = item.replacement ? ` | 建议: ${item.replacement}` : '';
    return `${location} [${item.rule}] ${item.message}${item.term ? ` (${item.term})` : ''}${replacement}`;
  }).join('\n');
}

function inferPlatformFromFilePath(filePath) {
  return /小红书抖音|xhs/i.test(path.basename(filePath || '')) ? 'xhs' : 'wechat';
}

function parseArgs(argv) {
  const args = { filePath: '', dataPath: '', platform: '' };
  const rest = [...argv];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--data') {
      args.dataPath = rest[index + 1] || '';
      index += 1;
    } else if (rest[index] === '--platform') {
      args.platform = rest[index + 1] || '';
      index += 1;
    } else if (!args.filePath) {
      args.filePath = rest[index];
    }
  }
  args.platform = args.platform || inferPlatformFromFilePath(args.filePath);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.filePath) {
    console.error('Usage: node scripts/lint-articles.js <article-file> [--data data/daily/YYYY-MM-DD.json] [--platform wechat|xhs]');
    process.exitCode = 2;
    return;
  }

  const text = fs.readFileSync(args.filePath, 'utf8');
  const marketData = args.dataPath ? JSON.parse(fs.readFileSync(args.dataPath, 'utf8')) : null;
  const result = marketData
    ? lintArticleWithMarketData(text, marketData, { platform: args.platform, filePath: args.filePath, dataPath: args.dataPath })
    : lintArticleText(text, { platform: args.platform, filePath: args.filePath });

  if (!result.ok) {
    console.error(formatIssues(result.issues));
    process.exitCode = 1;
    return;
  }

  console.log(`Article lint passed: ${path.basename(args.filePath)}`);
}

module.exports = {
  inferPlatformFromFilePath,
  lintArticleText,
  lintArticleWithMarketData,
  formatIssues,
  parseArgs,
};

if (require.main === module) {
  main();
}
