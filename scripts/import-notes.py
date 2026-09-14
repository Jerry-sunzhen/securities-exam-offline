#!/usr/bin/env python3
"""把 2026 新大纲「三色笔记」PDF 转成带页标记的 UTF-8 文本。

题库里的每道历年题都要能定位到复习资料的具体页码，这里负责把
用户提供的两本笔记（金融基础知识 / 证券市场基本法律法规）转成
docs/notes-finance.txt 与 docs/notes-law.txt，格式与统编教材一致：

    ===== PDF 第 1 页 =====
    <该页识别文字>

用法：python3 scripts/import-notes.py [资料目录]
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = Path.home() / "Downloads/2026年证券从业（历年真题，押题，三色笔记等）/（2026新大纲）三色笔记+思维导图等资料包/2026证券从业"

# (科目, 文件名关键词, 输出文件)。用关键词匹配而不是完整文件名，
# 避免中文全角标点在不同文件系统下的归一化差异。
SOURCES = [
    ("finance", "金融市场基础知识", "notes-finance.txt"),
    ("law", "证券市场基本法律法规", "notes-law.txt"),
]

# 讲义水印与页脚，进入文本只会污染教材出处片段。
WATERMARKS = [
    re.compile(r"金融类考试更多课件押题资料微信\s*\d*"),
    re.compile(r"绝密押题命中率高.*?微信\s*\d*"),
    re.compile(r"haomingzi\d*", re.I),
    re.compile(r"^\s*\d+\s*/\s*\d+\s*$"),
    re.compile(r"微信\s*\d{6,}"),
]

# 竖排水印在 PDF 里被识别成反向串（“财经营类题押认准微信…”），且夹在正文行中间。
INLINE_WATERMARK = re.compile(r"\d*\s*信微准认题押类经财")
# 水印竖排时每个字单独成行，散落在正文中间。
WATERMARK_CHARS = set("信微准认题押类经财")


def clean_page(raw):
    lines = []
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if any(pattern.search(stripped) for pattern in WATERMARKS):
            continue
        if len(stripped) == 1 and stripped in WATERMARK_CHARS:
            continue
        lines.append(INLINE_WATERMARK.sub("", stripped).strip())
    return "\n".join(lines).strip()


def extract(pdf):
    text = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], check=True, capture_output=True, text=True).stdout
    pages = text.split("\f")
    while pages and not pages[-1].strip():
        pages.pop()
    return pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, nargs="?", default=DEFAULT_SOURCE)
    args = parser.parse_args()
    if not args.source.exists():
        sys.exit(f"资料目录不存在：{args.source}")

    for subject, keyword, output in SOURCES:
        matches = [path for path in args.source.rglob("*三色笔记*.pdf") if keyword in path.name]
        if len(matches) != 1:
            sys.exit(f"三色笔记（{keyword}）匹配到 {len(matches)} 个文件，无法确定唯一来源")
        filename = matches[0].name
        pages = extract(matches[0])
        body = "\n\n".join(f"===== PDF 第 {index} 页 =====\n{clean_page(page)}" for index, page in enumerate(pages, start=1))
        target = ROOT / "docs" / output
        target.write_text(body + "\n", encoding="utf-8")
        print(f"{filename} -> docs/{output}：{len(pages)} 页")


if __name__ == "__main__":
    main()
