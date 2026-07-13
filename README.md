# 财经IP

AI驱动的财经内容生产管线。从每日市场数据到公众号/小红书成品，六步自动化。

## 快速开始

```bash
git clone https://github.com/ProjectY3/caijing-pipeline.git
cd caijing-pipeline
npm install
```

## 每日流程

```bash
npm run data:fetch                    # 1. 抓取行情
npm run write-card -- 2026-01-15      # 2. 生成数据卡
# 3. 口述 + 写作（AI agent 执行，见 WRITING_GUIDE.md）
npm run prelint -- outputs/final/2026-01-15-公众号.html    # 5. 校验
node scripts/lint-articles.js outputs/final/2026-01-15-小红书抖音.md
# 6. 人工定稿
```

## 写作

写作指南见 [WRITING_GUIDE.md](./WRITING_GUIDE.md)。核心原则：数据卡算好一切事实，你负责表达。

配合 Claude Code 等 AI agent 使用，把 WRITING_GUIDE.md 作为 prompt 喂给它，让它对照数据卡写出两端文章。

## 项目结构

```
scripts/
  write-card.py            # 数据卡生成
  fetch-market-data.js     # 行情抓取
  lint-articles.js         # 文章校验
  prelint-check.py         # 写前预检
  run-daily-workflow.js    # 工作流调度
rules/
  forbidden_words.json     # 禁词表
  stock_name_abbreviations.json  # 个股简称
data/daily/                # 每日行情
tests/                     # 测试
```

## License

MIT
