#!/usr/bin/env python3
"""
write-card.py — 写前数据卡
在Agent写文章之前运行，输出结构化上下文，消除Agent的"自觉型"错误。
用法: python write-card.py <YYYY-MM-DD>
输出: JSON到 stdout，Agent必须对照此卡写文章。
"""

import sys
import json
import re
from pathlib import Path
from datetime import datetime, timedelta

PROJECT = Path(__file__).resolve().parent.parent

def load_abbrevs():
    p = PROJECT / "rules" / "stock_name_abbreviations.json"
    if p.exists():
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    return {"mappings": {}, "shortToFull": {}}

def load_sector_map():
    """Single source of truth for stock sector assignments."""
    return {
        "兆易创新": "存储芯片", "佰维存储": "存储芯片",
        "江波龙": "存储芯片", "德明利": "存储芯片",
        "雅克科技": "半导体材料", "多氟多": "半导体材料",
        "士兰微": "功率半导体", "新洁能": "功率半导体",
        "扬杰科技": "功率半导体", "捷捷微电": "功率半导体",
        "通富微电": "先进封装", "华天科技": "先进封装",
        "长电科技": "先进封装", "太极实业": "先进封装",
        "光迅科技": "光通信", "东山精密": "光通信",
        "华工科技": "光通信", "天孚通信": "光通信",
        "中际旭创": "光通信", "新易盛": "光通信",
        "亨通光电": "光通信", "源杰科技": "光通信",
        "生益科技": "PCB", "沪电股份": "PCB",
        "深南电路": "PCB", "胜宏科技": "PCB", "天津普林": "PCB",
        "宏和科技": "电子布", "中国巨石": "电子布", "金安国纪": "电子布",
        "风华高科": "MLCC", "三环集团": "电子元件",
        "京东方A": "面板", "TCL科技": "面板",
        "信维通信": "射频天线", "北方华创": "半导体设备",
        "绿的谐波": "机器人", "双环传动": "机器人",
        "埃斯顿": "机器人", "索辰科技": "机器人",
        "汇川技术": "机器人", "鸣志电器": "机器人",
        "三花智控": "机器人", "宇环数控": "机器人",
        "远东股份": "电力能源", "福能股份": "电力能源",
        "中钨高新": "材料资源", "横店东磁": "材料资源",
        "西部材料": "材料资源", "江南新材": "材料资源",
        "中国卫星": "低空航天", "大连重工": "低空航天",
        "立讯精密": "连接器", "沃尔核材": "铜连接",
        "兆龙互连": "铜连接", "工业富联": "AI服务器",
        "长飞光纤": "光纤", "春秋电子": "消费电子",
        "晋控煤业": "电力能源", "钧达股份": "光伏",
        "顺灏股份": "烟草", "北部湾港": "港口",
        "泰坦股份": "纺织", "百合花": "化工",
        "友邦吊顶": "建材", "光华科技": "电子化学品",
    }


# ═══════════════════════════════════════════════════════════════════
# Phase 1 优化：新增三个函数
# ═══════════════════════════════════════════════════════════════════

def calculate_sector_strength(sectors_data, stock_cards):
    """
    🔥 优化1：板块强度计算器（程序计算，不让LLM猜）

    计算每个板块的强度得分，判断主线
    强度 = 平均涨幅 × 0.4 + 上涨家数比例 × 0.3 + 成交额占比 × 0.3

    Returns:
        list: 按强度排序的板块列表，每个板块包含 strength_score, is_mainline, rank
    """
    # 按板块统计
    sector_stats = {}
    for sc in stock_cards:
        sector = sc['sector']
        if sector not in sector_stats:
            sector_stats[sector] = {
                'name': sector,
                'stocks': [],
                'total_count': 0,
                'up_count': 0,
                'avg_change': 0,
                'total_amount': 0
            }
        sector_stats[sector]['stocks'].append(sc)
        sector_stats[sector]['total_count'] += 1
        if sc['change_pct'] > 0:
            sector_stats[sector]['up_count'] += 1

    # 计算总市场成交额
    total_market_amount = sum(s.get('amount', 0) for s in sectors_data.get('all', []))
    if total_market_amount == 0:
        total_market_amount = 1  # 避免除零

    # 计算每个板块的强度
    sector_list = []
    for sector, stats in sector_stats.items():
        if stats['total_count'] == 0:
            continue

        # 平均涨幅
        avg_change = sum(s['change_pct'] for s in stats['stocks']) / stats['total_count']

        # 上涨家数比例
        up_ratio = stats['up_count'] / stats['total_count']

        # 成交额占比（从sectors_data中找）
        sector_amount = 0
        for sec_data in sectors_data.get('all', []):
            if sec_data.get('name') == sector:
                sector_amount = sec_data.get('amount', 0)
                break
        volume_ratio = sector_amount / total_market_amount

        # 强度得分
        strength_score = avg_change * 0.4 + up_ratio * 30 + volume_ratio * 30

        is_mainline = (
            sector != "其他"
            and stats['total_count'] >= 2
            and avg_change > 0
            and strength_score > 8.0
        )

        sector_list.append({
            'name': sector,
            'strength_score': round(strength_score, 1),
            'avg_change': round(avg_change, 2),
            'up_ratio': round(up_ratio, 2),
            'up_count': stats['up_count'],
            'total_count': stats['total_count'],
            'amount': sector_amount,
            'is_mainline': is_mainline,
            'strength_level': '强势主线' if is_mainline else ('活跃' if strength_score > 6 else '弱势')
        })

    # 排序并标注排名
    sector_list.sort(key=lambda x: x['strength_score'], reverse=True)
    for i, sector in enumerate(sector_list):
        sector['rank'] = i + 1

    return sector_list


def verify_yesterday_claims(yesterday_file, today_stock_cards, today_sectors):
    """
    🔥 优化2：昨日预测验证器（程序验证，告诉LLM可以提什么、要避免什么）

    提取昨日预测，用今日数据验证，生成写作指导

    Returns:
        dict: {
            'verified_claims': [...],  # 验证通过的预测
            'failed_claims': [...],    # 验证失败的预测
            'writing_guidance': {      # 写作指导
                'can_acknowledge': [...],  # 可以提及
                'must_avoid': [...]        # 必须避免
            }
        }
    """
    if not yesterday_file.exists():
        return {
            'verified_claims': [],
            'failed_claims': [],
            'writing_guidance': {
                'can_acknowledge': [],
                'must_avoid': []
            }
        }

    y_content = yesterday_file.read_text(encoding="utf-8", errors="ignore")
    y_text = re.sub(r'<[^>]+>', '', y_content)

    # 简单规则提取预测
    claims = []

    # 规则1：提取"XX有望延续"
    for sector in today_sectors:
        sector_name = sector['name']
        if f"{sector_name}有望延续" in y_text or f"{sector_name}继续" in y_text:
            claims.append({
                'sector': sector_name,
                'prediction': '延续',
                'actual_change': sector['avg_change'],
                'verified': sector['avg_change'] > 1.0  # 涨超1%算延续
            })

    # 规则2：提取"XX短期调整"
    for sector in today_sectors:
        sector_name = sector['name']
        if f"{sector_name}短期调整" in y_text or f"{sector_name}回调" in y_text:
            claims.append({
                'sector': sector_name,
                'prediction': '调整',
                'actual_change': sector['avg_change'],
                'verified': sector['avg_change'] < -1.0  # 跌超1%算调整
            })

    # 分类
    verified_claims = [c for c in claims if c['verified']]
    failed_claims = [c for c in claims if not c['verified']]

    # 生成写作指导
    can_acknowledge = []
    must_avoid = []

    for c in verified_claims:
        can_acknowledge.append(f"{c['sector']}{c['prediction']}预测准确（今日{c['actual_change']:+.1f}%）")

    for c in failed_claims:
        must_avoid.append(f"不要重复{c['sector']}{c['prediction']}预测（今日{c['actual_change']:+.1f}%，预测失败）")

    return {
        'verified_claims': verified_claims,
        'failed_claims': failed_claims,
        'writing_guidance': {
            'can_acknowledge': can_acknowledge,
            'must_avoid': must_avoid
        }
    }


def annotate_stock_primary_sectors(stock_cards, sector_map):
    """
    🔥 优化3：板块归属前置（数据层标注，LLM物理上无法写错）

    给每只股票标注primary_sector和allowed_sectors
    LLM只能使用这些板块，无法自行判断

    Modifies stock_cards in place, adds:
        - primary_sector: 主板块
        - allowed_sectors: 允许归入的板块列表
    """
    for sc in stock_cards:
        name = sc['name']
        primary = sector_map.get(name, sc.get('sector', '其他'))
        sc['primary_sector'] = primary
        sc['allowed_sectors'] = [primary]  # 只允许这一个板块

    return stock_cards

def find_earliest_mention(stock_name, short, outputs_dir):
    """Scan all past articles for earliest mention date."""
    earliest = None
    earliest_file = None
    for html_file in sorted(outputs_dir.glob("*公众号*.html")):
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', html_file.name)
        if not date_match:
            continue
        date = date_match.group(1)
        content = html_file.read_text(encoding="utf-8", errors="ignore")
        # Check for 简称+同学 or 全名
        if (short and (short + "同学") in content) or stock_name in content:
            if earliest is None or date < earliest:
                earliest = date
                earliest_file = html_file.name
    return earliest, earliest_file

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "用法: python write-card.py YYYY-MM-DD"}, ensure_ascii=False))
        sys.exit(1)

    date_str = sys.argv[1]
    data_file = PROJECT / "data" / "daily" / f"{date_str}.json"
    if not data_file.exists():
        print(json.dumps({"error": f"数据文件不存在: {data_file}"}, ensure_ascii=False))
        sys.exit(1)

    with open(data_file, encoding='utf-8') as f:
        data = json.load(f)

    abbrevs = load_abbrevs()
    short_to_full = abbrevs.get("shortToFull", {})
    full_to_short = abbrevs.get("mappings", {})
    sector_map = load_sector_map()

    # --- 1. 今日行情概览 ---
    indices = [{"name": i["name"], "chg": i.get("change_pct", 0)}
               for i in data.get("indices", [])]

    stocks = data.get("tracked_stocks", [])
    sorted_up = sorted([s for s in stocks if s.get("change_pct", 0) > 0],
                       key=lambda x: x.get("change_pct", 0), reverse=True)
    sorted_down = sorted([s for s in stocks if s.get("change_pct", 0) < 0],
                         key=lambda x: x.get("change_pct", 0))

    # --- 2. 昨天文章中的标的 ---
    yesterday = (datetime.strptime(date_str, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    yesterday_file = PROJECT / "outputs" / "final" / f"{yesterday}-公众号.html"
    yesterday_stocks = []
    if yesterday_file.exists():
        y_content = yesterday_file.read_text(encoding="utf-8", errors="ignore")
        for short, full in short_to_full.items():
            if (short + "同学") in y_content:
                yesterday_stocks.append(full)

    # --- 3. 每只票的完整信息 ---
    outputs_dir = PROJECT / "outputs" / "final"
    stock_cards = []
    seen = set()
    for s in sorted_up + sorted_down:
        name = s["name"]
        if name in seen:
            continue
        seen.add(name)
        cp = s.get("change_pct", 0)
        short = full_to_short.get(name, name)
        sector = sector_map.get(name, "其他")

        # Find earliest mention
        earliest, earliest_file = find_earliest_mention(name, short, outputs_dir)

        # A new stock is a first-ever mention. Stocks absent yesterday but mentioned
        # before are reintroductions and must retain their verification history.
        is_new = earliest is None
        is_absent_yesterday = name not in yesterday_stocks

        # Build verification chain
        chain = []
        if earliest:
            # Find all intermediate verifications
            for html_file in sorted(outputs_dir.glob("*公众号*.html")):
                dm = re.search(r'(\d{4}-\d{2}-\d{2})', html_file.name)
                if not dm:
                    continue
                d = dm.group(1)
                if d < earliest or d >= date_str:
                    continue
                content = html_file.read_text(encoding="utf-8", errors="ignore")
                if (short + "同学") in content:
                    # Check if this day had a notable move
                    chain.append(d)

        stock_cards.append({
            "name": name,
            "short": short,
            "sector": sector,
            "change_pct": round(cp, 2),
            "close": s.get("current", 0),
            "is_new": is_new,
            "is_absent_yesterday": is_absent_yesterday,
            "earliest_mention": earliest,
            "earliest_file": earliest_file,
            "verification_chain": chain[-5:],  # last 5 verifications
        })

    # --- 4. 板块分组 ---
    sector_groups = {}
    for sc in stock_cards:
        sec = sc["sector"]
        if sec not in sector_groups:
            sector_groups[sec] = []
        sector_groups[sec].append(sc)

    # ═══════════════════════════════════════════════════════════════════
    # Phase 1 优化：调用三个新函数
    # ═══════════════════════════════════════════════════════════════════

    # 优化3：板块归属前置（修改stock_cards，添加primary_sector）
    stock_cards = annotate_stock_primary_sectors(stock_cards, sector_map)

    # 优化1：板块强度计算器（计算主线）
    sectors_data = data.get("sectors", {})
    sector_strength_list = calculate_sector_strength(sectors_data, stock_cards)

    # 优化2：昨日预测验证器（验证昨日预测）
    yesterday_verification = verify_yesterday_claims(
        yesterday_file,
        stock_cards,
        sector_strength_list
    )

    # ═══════════════════════════════════════════════════════════════════

    # --- 5. 昨天文章的关键主张（用于今天对账） ---
    yesterday_claims = []
    if yesterday_file.exists():
        y_text = yesterday_file.read_text(encoding="utf-8", errors="ignore")
        y_text_clean = re.sub(r'<[^>]+>', '', y_text)
        # Extract "明天怎么看" section
        tomorrow_match = re.search(r'明天怎么看(.+?)(?:省流|$)', y_text_clean, re.DOTALL)
        if tomorrow_match:
            tomorrow_text = tomorrow_match.group(1)
            # Split into items
            items = re.split(r'第[一二三四五]件事', tomorrow_text)
            for item in items:
                item = item.strip().rstrip('。')
                if len(item) > 10:
                    yesterday_claims.append(item[:120])

    # --- OUTPUT ---
    result = {
        "date": date_str,
        "yesterday": yesterday,
        "indices": indices,
        "source": data.get("source", ""),
        "breadth": data.get("market", {}).get("breadth", {}),
        "breadth_scope": "tracked_sample" if str(data.get("source", "")).endswith(":tencent-fallback") else "market_wide",
        "yesterday_stocks": yesterday_stocks,
        "yesterday_claims": yesterday_claims,

        # ═══════════════════════════════════════════════════════════════════
        # Phase 1 新增字段
        # ═══════════════════════════════════════════════════════════════════

        # 优化1：板块强度（程序计算的主线）
        "sector_strength": sector_strength_list,
        "mainlines": [s for s in sector_strength_list if s['is_mainline']],

        # 优化2：昨日预测验证
        "yesterday_verification": yesterday_verification,

        # ═══════════════════════════════════════════════════════════════════

        # 优化3：XHS术语映射（程序算，LLM不用猜）
        "xhs_sector_aliases": {
            "光通信": "光的方向", "半导体材料": "材料方向",
            "存储芯片": "硬科技权重方向", "功率半导体": "芯片方向",
            "PCB": "硬件方向", "先进封装": "封装方向",
            "机器人": "机器人方向", "MLCC": "电容方向",
            "电子布": "材料方向", "面板": "面板方向",
            "AI服务器": "算力方向", "连接器": "连接方向",
            "光纤": "光纤方向", "半导体设备": "设备方向",
            "其他": "其他方向"
        },

        "sector_groups": {k: [
            {"short": sc["short"], "name": sc["name"],
             "chg": sc["change_pct"], "is_new": sc["is_new"],
             "earliest": sc["earliest_mention"],
             "chain": sc["verification_chain"],
             "primary_sector": sc.get("primary_sector", sc["sector"]),  # 新增
             "allowed_sectors": sc.get("allowed_sectors", [sc["sector"]])}  # 新增
            for sc in v
        ] for k, v in sector_groups.items()},
        "new_stocks": [sc["short"] for sc in stock_cards if sc["is_new"]],
        "reintroduced_stocks": [
            sc["short"] for sc in stock_cards
            if sc["is_absent_yesterday"] and sc["earliest_mention"]
        ],
        "top_gainers": [{"short": sc["short"], "name": sc["name"],
                         "chg": sc["change_pct"], "sector": sc["sector"],
                         "primary_sector": sc.get("primary_sector", sc["sector"])}  # 新增
                        for sc in sorted(stock_cards, key=lambda x: x["change_pct"], reverse=True)[:15]],
        "top_losers": [{"short": sc["short"], "name": sc["name"],
                        "chg": sc["change_pct"]} for sc in sorted(stock_cards, key=lambda x: x["change_pct"])[:5]],
        # Instructions for Agent
        "_rules": {
            "new_stocks": "🚫 以上 'new_stocks' 是历史首次提及，禁止说「一直在验证」「之前就说了」，只能说「今天新关注」",
            "reintroduced_stocks": "⚠️ 以上 'reintroduced_stocks' 今天未在昨天文章出现，但有历史提及；引用时必须以 earliest_mention 和 verification_chain 为准",
            "prices": "🚫 禁止在文章中写 ¥数字 或裸露的3-4位目标价（如1886、1900、256.94），只用模糊表达",
            "opening": "🚫 开篇只讲方向和逻辑，不堆任何一只票的涨幅数字，涨幅留给正文",
            "sector": "⚠️ 每只票的板块归属严格按 primary_sector，LLM不得自行判断归属",
            "verification": "⚠️ earliest_mention 为空=无历史验证，禁止说「之前说过」；有 earliest 的才可引用验证链",
            "yesterday_claims": "📋 昨天文章的「明天怎么看」主张在上面，今天对账时逐一验证",

            # Phase 1 新增规则
            "mainlines": "⭐ mainlines 是程序计算的主线（不是LLM判断），开篇必须提及 mainlines[0]",
            "sector_strength": "⭐ 所有板块强度已由程序计算，LLM不得自行判断哪个板块更强",
            "yesterday_verification": "⭐ 昨日预测验证结果：can_acknowledge 可以提及，must_avoid 必须避免",
        }
    }

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    # 设置stdout为UTF-8编码
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    main()
