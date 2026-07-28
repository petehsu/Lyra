#!/usr/bin/env python3
"""
i18n-export.py — 从 locale surface 目录导出 CSV/JSON 供翻译人员填写

用法:
  python3 tools/i18n-export.py                    # 默认输出 CSV 到 tools/i18n-translations.csv
  python3 tools/i18n-export.py --format json      # 输出 JSON
  python3 tools/i18n-export.py -o translations.csv
  python3 tools/i18n-export.py --source en-US --target zh-CN

CSV 列: key, en-US, zh-CN, surface, context
  - en-US 为源语言值（必填）
  - zh-CN 为现有翻译（空 = 未翻译，翻译人员需填写）
  - surface 标注 key 所属的 surface 文件（如 "shared", "shell"）
  - context 为翻译上下文注释（来自 tools/i18n-comments.json，可选）
  - 仅导出 en-US 中存在的 key（以源语言为准）
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "apps/desktop/src/modules/workbench/i18n/locales"
EN_US_DIR = ROOT / "apps/desktop/src/shared/i18n/en-US"

# ponytail: surface 文件列表 — 与 verify-i18n.ts 的 SURFACE_FILES 保持一致
SURFACE_FILES = [
    "shared", "shell", "file-manager", "file-editor", "image-viewer",
    "agent-project-tree", "agent-plan-board", "agent-git", "agent-session-history",
    "login-manager", "software-store", "notifications", "ai-panel", "location",
]

# ponytail: 正则匹配 "key": "value" 行 — 与 verify-i18n.ts 的 SURFACE_KEY_RE 保持一致
ENTRY_RE = re.compile(r'^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')

COMMENTS_PATH = ROOT / "tools" / "i18n-comments.json"


def load_comments() -> dict[str, str]:
    """从 tools/i18n-comments.json 读取 key→context 映射，文件不存在时返回空 dict"""
    if not COMMENTS_PATH.exists():
        return {}
    try:
        return json.loads(COMMENTS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        print(f"[warn] failed to load {COMMENTS_PATH}: {e}", file=sys.stderr)
        return {}


def parse_locale_dir(locale: str) -> dict[str, tuple[str, str]]:
    """
    解析 locale surface 目录下所有 .ts 文件，返回 key→(value, surface) 映射。
    surface 标注 key 来源，供翻译人员定位上下文。
    """
    entries: dict[str, tuple[str, str]] = {}
    locale_dir = EN_US_DIR if locale == "en-US" else LOCALES_DIR / locale
    if not locale_dir.is_dir():
        return entries
    for surface in SURFACE_FILES:
        surface_path = locale_dir / f"{surface}.ts"
        if not surface_path.exists():
            continue
        for line in surface_path.read_text(encoding="utf-8").splitlines():
            m = ENTRY_RE.match(line)
            if m:
                key = m.group(1)
                # ponytail: 保持 TS 转义形式 — 不做 unicode_escape 解码，避免 UTF-8 多字节字符被按 Latin-1 破坏
                value = m.group(2)
                entries[key] = (value, surface)
    return entries


def export_csv(
    entries: list[tuple[str, str, str, str, str]], out_path: Path
) -> None:
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["key", "en-US", "zh-CN", "surface", "context"])
        for key, en_val, zh_val, surface, context in entries:
            writer.writerow([key, en_val, zh_val, surface, context])
    print(f"[export] CSV → {out_path} ({len(entries)} keys)")


def export_json(
    entries: list[tuple[str, str, str, str, str]], out_path: Path
) -> None:
    data = [
        {"key": key, "en-US": en_val, "zh-CN": zh_val, "surface": surface, "context": context}
        for key, en_val, zh_val, surface, context in entries
    ]
    out_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[export] JSON → {out_path} ({len(data)} keys)")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export i18n dictionary for translation"
    )
    parser.add_argument("--format", choices=["csv", "json"], default="csv")
    parser.add_argument("-o", "--output", default=None, help="Output file path")
    parser.add_argument(
        "--source", default="en-US", help="Source locale (default: en-US)"
    )
    parser.add_argument(
        "--target", default="zh-CN", help="Target locale (default: zh-CN)"
    )
    args = parser.parse_args()

    source_entries = parse_locale_dir(args.source)
    target_entries = parse_locale_dir(args.target)

    if not source_entries:
        print(
            f"[error] no surface files found for source locale: {args.source}",
            file=sys.stderr,
        )
        return 1

    # ponytail: 以源语言 key 为准，target 中多出的 key 不导出（会被 verify-i18n 标记）
    comments = load_comments()
    rows: list[tuple[str, str, str, str, str]] = []
    untranslated = 0
    with_context = 0
    for key in sorted(source_entries.keys()):
        en_val, surface = source_entries[key]
        zh_val = target_entries.get(key, ("", ""))[0]
        if not zh_val:
            untranslated += 1
        context = comments.get(key, "")
        if context:
            with_context += 1
        rows.append((key, en_val, zh_val, surface, context))

    ext = ".csv" if args.format == "csv" else ".json"
    out_path = (
        Path(args.output)
        if args.output
        else ROOT / "tools" / f"i18n-translations{ext}"
    )

    if args.format == "csv":
        export_csv(rows, out_path)
    else:
        export_json(rows, out_path)

    print(f"[export] {len(rows)} keys, {untranslated} untranslated, {with_context} with context")
    return 0


if __name__ == "__main__":
    sys.exit(main())
