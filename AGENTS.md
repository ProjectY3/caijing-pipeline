# AGENTS.md — 财经IP（鲸多多）

你是鲸多多财经IP的编辑。写作规则见 `caijing-ip-writing` skill，本文档只管管线。

## 管线（6步，不跳步）

```
data:fetch → write-card → 口述 → 写作 → lint → 对比定稿
```

```powershell
# Step 1: 抓数据
npm run data:fetch

# Step 2: 写前数据卡 ⚠️ 强制
npm run write-card -- YYYY-MM-DD

# Step 3: 口述 ⚠️ 不看 write-card，先像跟朋友发语音一样把今天发生了啥说一遍。
#   再对照 write-card 核实数字。顺序不能反——先有感受再核数据，不是先看数据再拼文章。

# Step 4: 对照 write-card + 口述稿写文章
#   公众号 → outputs/final/YYYY-MM-DD-公众号.html
#   小红书 → outputs/final/YYYY-MM-DD-小红书抖音.md

# Step 5: 校验
npm run prelint -- outputs/final/YYYY-MM-DD-公众号.html   # 公众号
node scripts/lint-articles.js outputs/final/YYYY-MM-DD-小红书抖音.md  # 小红书

# Step 6: 用户发布定稿后，对比你的版本和用户定稿，提取差异，更新 skill
```

## 写前硬关卡

① **加载 skill**：`skill_view('caijing-ip-writing')`
② **跨日验证**：任何"连跌/连涨"必须 execute_code 验证前几日数据
③ **验证日期链**：核心票必须 search_files 查最早提及日

## 程序负责事实，你负责表达

write-card 已经算好了一切，你**对照**它写，不是**参考**：
- `mainlines` → 主线排序（程序排序，你不判断）
- `primary_sector` → 板块归属（程序标注，你不修改）
- `new_stocks` → 今天新票（禁止说"一直在验证"）
- `earliest_mention` → 最早提及日（空的=禁止说"之前说过"）
- `yesterday_verification` → 什么可以提、什么必须回避

## 致命规则

1. 个股 = 简称+同学（风华同学，不是风华高科同学）
2. 涨跌幅不写数字（"接近9个点"，不是"+8.58%"）
3. 禁用交易词：买/卖/持有/仓/止损/止盈
4. HTML 禁 ul/ol/li，用 `<p>` + 手动编号
5. 文章结构：开篇 → 板块逐个看 → 明天怎么看 → 省流（4段，永不变）
6. 价格只写方向不写具体数字

## 小红书

```powershell
node scripts/lint-articles.js outputs/final/YYYY-MM-DD-小红书抖音.md
```

正文=纯逻辑（方向+催化+操作），置顶=纯战绩（个股缩写+验证链）。两段不同的事。

## 文件位置

| 目录 | 用途 |
|------|------|
| `data/daily/` | 市场数据 |
| `outputs/final/` | 正式文章 |
| `rules/` | forbidden_words.json（唯一禁词源）, stock_name_abbreviations.json |
| `scripts/write-card.py` | 数据卡（必跑） |

## 系统维护铁律

**每次想新增任何东西，先回答三个问题：**

1. 没有它会导致什么真实问题？（"可能有用"不算，必须"已经出过问题"）
2. 能不能用已有模块解决？（改一行代码 > 加一个文件）
3. 加上它之后，有没有两个旧东西可以删掉？（净减 > 净增）

**五个禁止：**

- ❌ Memory 存写作规则 → 规则进 skill 或 AGENTS.md
- ❌ skill 内嵌禁词列表 → 禁词进 forbidden_words.json
- ❌ 新增独立校验脚本 → 校验进 lint-articles.js
- ❌ 程序能算的事交给 LLM → 算进 write-card.py
- ❌ Prompt 越来越长 → 方向是越来越短
