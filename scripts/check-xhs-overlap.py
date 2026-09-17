"""XHS 正文 vs 置顶评论重叠检测

用法: python scripts/check-xhs-overlap.py outputs/final/YYYY-MM-DD-小红书抖音.md

输出: 列出正文和置顶中重叠的信息点。重叠=同一事实换了措辞也算。
"""
import re
import sys

def extract_section(text, section_name):
    """Extract content between # section_name and next # section"""
    pattern = rf'# {section_name}\n(.*?)(?=\n# |$)'
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else ""

def split_into_points(text):
    """Split text into information points (by sentence/clause boundaries)"""
    # Split by Chinese punctuation
    raw = re.split(r'[。！？\n]', text)
    return [p.strip() for p in raw if len(p.strip()) > 4]

def normalize(s):
    """Normalize for comparison: remove emoji, punctuation, whitespace"""
    s = re.sub(r'[🎫📈📉🌸🐕🐓\s]', '', s)
    return s

def check_overlap(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()
    
    body_text = extract_section(text, '正文')
    zhiding_text = extract_section(text, '置顶评论')
    
    if not body_text or not zhiding_text:
        print("ERROR: 找不到正文或置顶评论段")
        return False
    
    body_points = split_into_points(body_text)
    zhiding_points = split_into_points(zhiding_text)
    
    print(f"正文信息点: {len(body_points)}")
    print(f"置顶信息点: {len(zhiding_points)}")
    print()
    
    # Check for overlapping information
    overlaps = []
    for zp in zhiding_points:
        zp_norm = normalize(zp)
        for bp in body_points:
            bp_norm = normalize(bp)
            # Check if they share significant content
            if len(zp_norm) > 3 and len(bp_norm) > 3:
                # Count shared characters
                shared = sum(1 for c in zp_norm if c in bp_norm)
                ratio = shared / max(len(zp_norm), 1)
                if ratio > 0.5:
                    overlaps.append((bp, zp))
                    break
    
    if overlaps:
        print(f"⚠️  发现 {len(overlaps)} 处重叠：")
        for i, (bp, zp) in enumerate(overlaps, 1):
            print(f"  [{i}] 正文: {bp[:60]}...")
            print(f"      置顶: {zp[:60]}...")
            print()
        print("修复：删除置顶评论中的重叠内容。正文=逻辑，置顶=战绩，不应重叠。")
        return False
    else:
        print("✅ 正文与置顶零重叠")
        return True

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("用法: python scripts/check-xhs-overlap.py <XHS文件路径>")
        sys.exit(1)
    
    ok = check_overlap(sys.argv[1])
    sys.exit(0 if ok else 1)
