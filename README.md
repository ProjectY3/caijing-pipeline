# 财经IP — AI-Driven Content Production Pipeline

> An autonomous, rule-engineered content pipeline that turns daily market data into publishing-ready articles for WeChat Official Account & Xiaohongshu/Douyin — with deterministic fact generation and human-in-the-loop expression.

一个 AI 驱动的财经内容生产管线：从每日市场数据到公众号 / 小红书 / 抖音成品，全流程六步自动化。**程序负责事实（Deterministic），人负责表达（Human-in-the-loop）。**

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATA LAYER (数据层)                            │
│   fetch-market-data.js  东方财富 → 腾讯 fallback  结构化 JSON          │
│   a-stock-data-adapter.js  多源 schema 归一化                         │
│   market-schema.js       数据契约 / Schema Validation                │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPUTATION LAYER (计算层)                         │
│   write-card.py   写前数据卡 — 主线排序 / 板块归因 / 新票识别 / 最早提及日 │
│   trading-calendar.js  交易日历                                        │
│   verify-history-claims.js  历史声明跨日验证                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      GENERATION LAYER (生成层)                        │
│   Step 3 口述（不看卡，先保留人的视角）                                  │
│   Step 4 写作（对照 Data Card + 口述稿 → 公众号 HTML / 小红书 Markdown）│
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VALIDATION LAYER (校验层)                         │
│   lint-articles.js     文章结构 / 数字 / 事实校验                      │
│   prelint-check.py     写前预检                                        │
│   lint-humanizer.js    语气风格 / 禁词合规                             │
│   check-xhs-overlap.py 跨平台内容查重                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RELEASE LAYER (发布层)                           │
│   run-daily-workflow.js  流程编排 (Orchestration)                     │
│   check-project-health.js  系统健康巡检                                │
│   Step 6 定稿（人工审阅 → 差异反哺规则）                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Pipeline

```
data:fetch → write-card → 口述 → 写作 → lint → 定稿
```

```bash
npm install
npm run data:fetch                        # 抓取每日行情
npm run write-card -- YYYY-MM-DD          # 生成写前数据卡
# 口述 & 写作（LLM Agent 执行）
npm run prelint -- outputs/final/YYYY-MM-DD-公众号.html
node scripts/lint-articles.js outputs/final/YYYY-MM-DD-小红书抖音.md
```

## Project Structure

```
scripts/
  write-card.py            # Data Card 生成 — 主线排序、板块归因、最早提及日
  fetch-market-data.js     # 市场数据抓取（多源 fallback）
  a-stock-data-adapter.js  # A股数据适配
  market-schema.js         # 数据契约 / Schema
  trading-calendar.js      # 交易日历
  verify-history-claims.js # 历史声明跨日验证
  lint-articles.js         # 文章校验（结构 / 数字 / 事实）
  prelint-check.py         # 写前预检
  lint-humanizer.js        # 语气风格 / 禁词合规
  check-xhs-overlap.py     # 跨平台内容查重
  run-daily-workflow.js    # 每日工作流编排
  check-project-health.js  # 项目健康巡检
rules/
  forbidden_words.json     # 禁词表（合规 Guardrail）
  stock_name_abbreviations.json  # 个股简称映射
  terminology_map.json     # 术语 / 风格映射
data/daily/                # 每日市场数据（结构化行情）
tests/                     # 单元测试
```

## Design Philosophy

**程序负责事实，人负责表达。**

一切能被程序确定算准的事，绝不交给 LLM 去「猜」：主线排序、板块归属、涨跌连续性、最早提及日、历史声明真伪，全部由脚本确定性生成，写作时只能「对照」不能「参考」。LLM 只负责它擅长的部分——把冷数据翻译成有温度、有观点的财经文字。这样既杜绝模型编造数字，也保留内容的「人味」。

六个环节各司其职：

1. **fetch** 抓行情（多源 fallback）
2. **write-card** 算数据卡（确定性事实）
3. **口述** 先不看卡说感受（保留人的视角）
4. **写作** 对照卡写文章（Human-in-the-loop）
5. **lint** 机械校验（Compliance Guardrail）
6. **定稿** 人工审阅（差异反哺规则，越用越准）

## Tech Stack

- **Node.js** — 数据抓取、schema、lint、编排
- **Python** — 数据卡生成、预检

## License

MIT
