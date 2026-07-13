#!/usr/bin/env python3
"""
prelint-check.py — 公众号文章前置检查
在 daily:check 之前运行，拦截最常见的错误。
用法: python prelint-check.py <html_file_path>
"""

import sys
import re
import json
import importlib.util
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ============================================================
# RULE 1: 板块对号表 — 逐票检查归类
# ============================================================
def load_sector_map():
    spec = importlib.util.spec_from_file_location("write_card", PROJECT_ROOT / "scripts" / "write-card.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.load_sector_map()

STOCK_SECTOR_MAP = load_sector_map()

# Load abbreviations to resolve 简称→全名
ABBREV_PATH = PROJECT_ROOT / "rules" / "stock_name_abbreviations.json"
SHORT_TO_FULL = {}
if ABBREV_PATH.exists():
    with open(ABBREV_PATH, encoding="utf-8") as f:
        SHORT_TO_FULL = json.load(f).get("shortToFull", {})

def check_stock_sector(html_text):
    """Extract sector-tagged stock mentions and verify归类."""
    issues = []
    # Allowed neighbors: stocks of B can appear in A's section
    ALLOWED_NEIGHBORS = {
        "PCB": {"电子布"},
        "面板": {"先进封装"},
        "面板/玻璃基板": {"先进封装"},
    }
    sections = re.split(
        r'<span style="[^"]*background:#fff3e0[^"]*">([^<]+)</span>',
        html_text
    )
    for i in range(1, len(sections), 2):
        tag = sections[i].strip()
        content = sections[i + 1] if i + 1 < len(sections) else ""
        for full_name, correct_sector in STOCK_SECTOR_MAP.items():
            short = next((s for s, f in SHORT_TO_FULL.items() if f == full_name), None)
            if short and (short + "同学") in content:
                tag_base = tag.split("：")[0].split(":")[0].strip()
                if correct_sector != tag_base and tag_base not in ("关于中报", "省流", "明天怎么看"):
                    if not (correct_sector.startswith(tag_base) or tag_base.startswith(correct_sector)):
                        # Check allowed neighbors
                        if tag_base in ALLOWED_NEIGHBORS and correct_sector in ALLOWED_NEIGHBORS[tag_base]:
                            continue
                        issues.append(
                            f"  ✗ 归类错误: 「{short}同学」({full_name}) 在「{tag}」段 → 应在「{correct_sector}」"
                        )
    return issues


# ============================================================
# RULE 2: 禁用词「翻牌」
# ============================================================
def check_forbidden_words(html_text):
    issues = []
    for m in re.finditer(r"翻牌", html_text):
        ctx = html_text[max(0, m.start()-20):m.end()+20].replace("\n", " ")
        issues.append(f"  ✗ 禁词「翻牌」出现在: ...{ctx}...")
    return issues


# ============================================================
# RULE 3: 破折号计数（全文≤3个）
# ============================================================
def check_emdash_count(html_text):
    count = html_text.count("——")
    if count > 3:
        return [f"  ✗ 破折号 {count} 个（上限3个），超标 {count-3} 个"]
    return []


# ============================================================
# RULE 4: 独立纪律段检查
# ============================================================
def check_discipline_section(html_text):
    issues = []
    if "守纪律" in html_text or "震荡期守纪律" in html_text:
        issues.append("  ✗ 出现独立纪律段标题（含「守纪律」），应删除整段")
    return issues


# ============================================================
# RULE 5: 后花园独立标题检查
# ============================================================
def check_houhuayuan_title(html_text):
    issues = []
    pattern = r'<p style="[^"]*font-size:20px[^"]*">后花园</p>'
    if re.search(pattern, html_text):
        issues.append("  ✗「后花园」作为独立红底白字标题，应改为融入「板块逐个看」")
    return issues


# ============================================================
# RULE 6: 涨停票话术检查
# ============================================================
def check_limit_up_language(html_text):
    """涨停票不能说'可以看起来了''找机会关注'等暗示上车的话."""
    issues = []
    data_path = None
    for p in PROJECT_ROOT.glob("data/daily/*.json"):
        data_path = p
    if data_path:
        with open(data_path, encoding="utf-8") as f:
            market_data = json.load(f)
        limit_up_stocks = [
            s["name"] for s in market_data.get("tracked_stocks", [])
            if s.get("change_pct", 0) >= 9.9
        ]
        for full_name in limit_up_stocks:
            short = next((s for s, f in SHORT_TO_FULL.items() if f == full_name), full_name)
            patterns = [
                (short + "同学也可以看起来", "涨停了不能说「可以看起来」"),
                (short + "同学也可以关注", "涨停了不能说「关注」"),
                (full_name + "也可以看起来", "涨停了不能说「可以看起来」"),
            ]
            for pat, msg in patterns:
                if pat in html_text:
                    issues.append(f"  ✗ {msg}: {full_name} 今日涨停")
    return issues


# ============================================================
# RULE 7: 价格裸奔检测 — 禁止 ¥数字 和 纯数值目标价
# ============================================================
def check_naked_prices(html_text):
    """Detect ¥1234, 纯数字目标价(如 1886, 256.94)裸露在正文中."""
    issues = []
    # Strip HTML tags for text-only check
    text = re.sub(r'<[^>]+>', '', html_text)
    # ¥ followed by digits
    for m in re.finditer(r'¥\d+', text):
        ctx = text[max(0, m.start()-15):m.end()+15]
        issues.append(f"  ✗ 价格裸奔: ...{ctx}...  (禁止¥+数字，改用模糊表达)")
    # Standalone target prices like "1886" or "256.94" in narrative context
    # Exclude: 200附近(历史参考), 800G(产品规格), 日期(6/24), 百分比(8个多点)
    for m in re.finditer(r'(?<!\d)(\d{3,4})(?!\d|个多点|个点|月|日|/|G|附近)', text):
        num = m.group(1)
        before = text[max(0, m.start()-5):m.start()]
        after = text[m.end():m.end()+8]
        # Skip years, dates, percentages, product specs
        if any(kw in before+after for kw in ['月', '日', '年', '个多点', '个点', '/', 'G', '附近']):
            continue
        ctx = text[max(0, m.start()-8):m.end()+8]
        issues.append(f"  ✗ 疑似价格裸奔: ...{ctx}...  (数字{num}像目标价，改用方向性表达)")
    return issues


# ============================================================
# RULE 8: 开篇涨幅堆砌 — 开篇点名+涨幅不能和正文重复
# ============================================================
def check_opening_repetition(html_text):
    """Detect stocks mentioned in opening (before 板块逐个看) that repeat in body."""
    issues = []
    text = re.sub(r'<[^>]+>', '', html_text)
    # Split at 板块逐个看
    parts = re.split(r'板块逐个看', text)
    if len(parts) < 2:
        return issues
    opening = parts[0]
    body = '板块逐个看'.join(parts[1:])

    # Find 简称+同学 mentions in opening
    for short, full in SHORT_TO_FULL.items():
        pattern = short + "同学"
        opening_count = opening.count(pattern)
        body_count = body.count(pattern)
        # Also check with 涨幅 context: "XX同学 接近X个点" or "XX同学 X个多点"
        has_pct_in_opening = bool(re.search(
            pattern + r'.{0,10}(?:接近|涨停|\d+个多|\d+个点)', opening
        ))
        has_pct_in_body = bool(re.search(
            pattern + r'.{0,10}(?:接近|涨停|\d+个多|\d+个点)', body
        ))
        if has_pct_in_opening and has_pct_in_body and opening_count >= 1 and body_count >= 1:
            issues.append(
                f"  ✗ 涨幅重复: 「{short}同学」在开篇和正文都报了涨幅数据，开篇应只说方向不说具体数字"
            )
    return issues


# ============================================================
# RULE 9: 编造结论检测 — 无数据支撑的断言
# ============================================================
def check_fabricated_claims(html_text):
    """Detect phrases that sound like data-backed claims but likely aren't verifiable."""
    issues = []
    text = re.sub(r'<[^>]+>', '', html_text)
    fabricated_patterns = [
        (r'吞回.{0,5}周.{0,5}回调', '"吞回X周回调"——无数据支撑，删掉'),
        (r'一天.{0,5}干到', '"一天干到XX"——编造的速度感，删掉'),
        (r'一天吞回', '"一天吞回"——无数据支撑'),
    ]
    for pat, msg in fabricated_patterns:
        for m in re.finditer(pat, text):
            ctx = text[max(0, m.start()-10):m.end()+10]
            issues.append(f"  ✗ 编造结论: ...{ctx}...  ({msg})")
    return issues


# ============================================================
# MAIN
# ============================================================
def main():
    if len(sys.argv) < 2:
        print("用法: python prelint-check.py <html_file>")
        sys.exit(1)

    html_path = Path(sys.argv[1])
    if not html_path.exists():
        print(f"文件不存在: {html_path}")
        sys.exit(1)

    html_text = html_path.read_text(encoding="utf-8")

    all_issues = []

    print("═" * 50)
    print("前置检查：9条铁律")
    print("═" * 50)

    checks = [
        ("板块对号表", check_stock_sector),
        ("禁词「翻牌」", check_forbidden_words),
        ("破折号≤3个", check_emdash_count),
        ("无独立纪律段", check_discipline_section),
        ("后花园不单开标题", check_houhuayuan_title),
        ("涨停票话术", check_limit_up_language),
        ("价格裸奔（¥/目标价）", check_naked_prices),
        ("开篇涨幅不重复正文", check_opening_repetition),
        ("无编造结论", check_fabricated_claims),
    ]

    for name, fn in checks:
        issues = fn(html_text)
        if issues:
            print(f"\n[FAIL] {name}:")
            for issue in issues:
                print(issue)
            all_issues.extend(issues)
        else:
            print(f"\n[OK] {name}: OK")

    print("\n" + "═" * 50)
    if all_issues:
        print(f"[FAIL] {len(all_issues)} 个问题需要修复后再跑 daily:check")
        sys.exit(1)
    else:
        print("[OK] 全部通过，可以跑 daily:check")
        sys.exit(0)


if __name__ == "__main__":
    main()
