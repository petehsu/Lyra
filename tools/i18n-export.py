#!/usr/bin/env python3
"""
i18n-export.py — 从 locale .ts 字典导出 CSV/JSON 供翻译人员填写

用法:
  python3 tools/i18n-export.py                    # 默认输出 CSV 到 tools/i18n-translations.csv
  python3 tools/i18n-export.py --format json      # 输出 JSON
  python3 tools/i18n-export.py -o translations.csv
  python3 tools/i18n-export.py --source en-US --target zh-CN

CSV 列: key, en-US, zh-CN
  - en-US 为源语言值（必填）
  - zh-CN 为现有翻译（空 = 未翻译，翻译人员需填写）
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

# ponytail: 正则匹配 "key": "value" 行 — key 和 value 均为双引号字符串
# 支持 value 中含转义双引号 \" 和反斜杠 \\
ENTRY_RE = re.compile(r'^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')


def parse_locale_file(path: Path) -> dict[str, str]:
    """解析 .ts 字典文件，返回 key→value 映射"""
    entries: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = ENTRY_RE.match(line)
        if m:
            key = m.group(1)
            # ponytail: 反转义 TS 字符串字面量中的 \" \\ \n \t 等
            value = m.group(2).encode().decode("unicode_escape")
            entries[key] = value
    return entries


def export_csv(entries: list[tuple[str, str, str]], out_path: Path) -> None:
    with open(out_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["key", "en-US", "zh-CN"])
        for key, en_val, zh_val in entries:
            writer.writerow([key, en_val, zh_val])
    print(f"[export] CSV → {out_path} ({len(entries)} keys)")


def export_json(entries: list[tuple[str, str, str]], out_path: Path) -> None:
    data = [
        {"key": key, "en-US": en_val, "zh-CN": zh_val}
        for key, en_val, zh_val in entries
    ]
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[export] JSON → {out_path} ({len(data)} keys)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Export i18n dictionary for translation")
    parser.add_argument("--format", choices=["csv", "json"], default="csv")
    parser.add_argument("-o", "--output", default=None, help="Output file path")
    parser.add_argument(
        "--source", default="en-US", help="Source locale (default: en-US)"
    )
    parser.add_argument(
        "--target", default="zh-CN", help="Target locale (default: zh-CN)"
    )
    args = parser.parse_args()

    source_path = LOCALES_DIR / f"{args.source}.ts"
    target_path = LOCALES_DIR / f"{args.target}.ts"

    if not source_path.exists():
        print(f"[error] source file not found: {source_path}", file=sys.stderr)
        return 1
    if not target_path.exists():
        print(f"[error] target file not found: {target_path}", file=sys.stderr)
        return 1

    source_dict = parse_locale_file(source_path)
    target_dict = parse_locale_file(target_path)

    # ponytail: 以源语言 key 为准，target 中多出的 key 不导出（会被 verify-i18n 标记）
    entries: list[tuple[str, str, str]] = []
    untranslated = 0
    for key in sorted(source_dict.keys()):
        en_val = source_dict[key]
        zh_val = target_dict.get(key, "")
        if not zh_val:
            untranslated += 1
        entries.append((key, en_val, zh_val))

    ext = ".csv" if args.format == "csv" else ".json"
    out_path = Path(args.output) if args.output else ROOT / "tools" / f"i18n-translations{ext}"

    if args.format == "csv":
        export_csv(entries, out_path)
    else:
        export_json(entries, out_path)

    print(f"[export] {len(entries)} keys, {untranslated} untranslated")
    return 0


if __name__ == "__main__":
    sys.exit(main())