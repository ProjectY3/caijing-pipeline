# 写作指南

AI Agent 根据数据卡写出公众号文章的操作指南。

## 前置

先跑完数据步骤：
```bash
npm run data:fetch
npm run write-card -- YYYY-MM-DD
```

write-card 会输出一份 JSON 数据卡，包含当日所有你需要的事实。

## 文章结构（四段，固定）

1. **开篇**：今天市场整体怎么样（涨跌方向、情绪），1-2段
2. **板块逐个看**：按 write-card 的 mainlines 顺序，逐个板块展开，每个板块1段
3. **明天怎么看**：明天需要关注什么，1-2段
4. **省流**：5条要点总结

## 格式规则

### 公众号 HTML
- 只用 `<p>` 标签，不用 `<ul>/<ol>/<li>`
- 内联样式：`style="font-size:16px; color:#3f3f3f; line-height:1.8; margin:10px 0"`
- 板块标题：红底白字 `<p style="background:#d32f2f; color:#fff; padding:6px 12px; font-size:18px; font-weight:bold">`
- 次标题：浅橙背景 `<p style="background:#fff3e0; padding:4px 10px; font-size:16px; font-weight:bold">`
- 不加 emoji

### 小红书
- 纯文本 markdown
- ≤1000字
- 正文：只写盘面逻辑和方向判断
- 置顶评论：战绩回顾（如有）
- 不加 emoji

## 内容规则

### 个股称呼
简称+同学。例如：风华同学、太极同学。
参考 `rules/stock_name_abbreviations.json`。

### 涨跌幅
不写具体数字（如+8.58%），用口语表达：
- "逼近涨停"、"差不多9个点"
- "小涨"、"微跌"、"跌了快一半"

### 禁用词
参考 `rules/forbidden_words.json`。
- 交易词：买入、卖出、持有、仓位、止损、止盈
- 绝对化：推荐、必涨、稳赚

### 数据使用
write-card 输出什么你就写什么，不要自由发挥：
- `mainlines` → 主线排序，按这个顺序写
- `primary_sector` → 板块标注，不要自己改
- `new_stocks` → 今天新进的票
- `earliest_mention` → 最早提及日期，空的就不要说"之前说过"
- `yesterday_verification` → 昨天的验证结果

### 价格
只说方向，不写具体数字。例如：
- "涨了"、"跌了不少"
- "接近涨停"、"跌停"
- "在当前价位附近震荡"

## 写完后

```bash
# 公众号校验
npm run prelint -- outputs/final/YYYY-MM-DD-公众号.html

# 小红书校验
node scripts/lint-articles.js outputs/final/YYYY-MM-DD-小红书抖音.md
```

全部通过后人工审阅定稿。

## 每日完整流程

```
npm run data:fetch                          # 1. 抓数据
npm run write-card -- YYYY-MM-DD            # 2. 数据卡
# 3. 口述：不看数据卡，先像跟朋友说话一样说一遍今天
# 4. 写作：对照数据卡+口述稿，按本指南写出两端文章
npm run prelint -- outputs/final/YYYY-MM-DD-公众号.html     # 5. 校验
node scripts/lint-articles.js outputs/final/YYYY-MM-DD-小红书抖音.md
# 6. 人工定稿
```
