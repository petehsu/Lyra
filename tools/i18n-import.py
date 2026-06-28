#!/usr/bin/env python3
"""
i18n-import.py — 从翻译好的 CSV/JSON 合并回 locale .ts 字典文件

用法:
  python3 tools/i18n-import.py                           # 默认读 tools/i18n-translations.csv → zh-CN.ts
  python3 tools/i18n-import.py -i translations.json --format json
  python3 tools/i18n-import.py --target zh-CN

规则:
  - 只更新 target locale（默认 zh-CN），源语言 en-US 不动
  - 空翻译值跳过（保留原值），不覆盖
  - 新增 key 追加到字典末尾
  - 保留原 .ts 文件的结构：header 注释、import、变量声明、as const
  - 合并后自动验证 key parity（与 source locale 对比）
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / "apps/desktop/src/modules/workbench/i18n/locales"

ENTRY_RE = re.compile(r'^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')


def parse_ts_file(path: Path) -> tuple[list[str], dict[str, str], list[str]]:
    """
    解析 .ts 字典文件，返回:
      - header_lines: const 声明之前的所有行（注释、import 等）
      - entries: key→value 映射（保持插入顺序）
      - footer: 闭合 }; 行
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    header_lines: list[str] = []
    entries: dict[str, str] = {}
    footer_lines: list[str] = []
    in_body = False

    for line in lines:
        if not in_body:
            # ponytail: 检测字典体开始 — export const XXX = { 行
            if re.match(r'^\s*export\s+const\s+\w+.*=\s*\{', line):
                in_body = True
                header_lines.append(line)
                continue
            header_lines.append(line)
        else:
            m = ENTRY_RE.match(line)
            if m:
                entries[m.group(1)] = m.group(2)
            elif re.match(r'^\s*\}\s*;?\s*$', line):
                footer_lines.append(line)
                in_body = False
            # ponytail: 跳过空行和非 entry 行（注释等）

    return header_lines, entries, footer_lines


def escape_ts_string(value: str) -> str:
    """转义 TS 字符串字面量中的特殊字符"""
    return value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t")


def read_translations_csv(path: Path) -> dict[str, str]:
    """读取 CSV，返回 key→zh-CN 翻译映射（跳过空翻译）"""
    translations: dict[str, str] = {}
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row["key"]
            zh_val = row.get("zh-CN", "").strip()
            if zh_val:
                translations[key] = zh_val
    return translations


def read_translations_json(path: Path) -> dict[str, str]:
    """读取 JSON，返回 key→zh-CN 翻译映射（跳过空翻译）"""
    data = json.loads(path.read_text(encoding="utf-8"))
    translations: dict[str, str] = {}
    for item in data:
        key = item["key"]
        zh_val = item.get("zh-CN", "").strip()
        if zh_val:
            translations[key] = zh_val
    return translations


def write_ts_file(
    path: Path, header_lines: list[str], entries: dict[str, str], footer_lines: list[str]
) -> None:
    """将字典写回 .ts 文件，保留 header/footer 结构"""
    out_lines = list(header_lines)
    for key, value in entries.items():
        out_lines.append(f'  "{key}": "{escape_ts_string(value)}",')
    out_lines.extend(footer_lines)
    # ponytail: 确保文件以换行结尾
    path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Import translations into locale .ts file")
    parser.add_argument(
        "-i", "--input", default=None, help="Input CSV/JSON file (default: tools/i18n-translations.csv)"
    )
    parser.add_argument("--format", choices=["csv", "json"], default=None, help="Force format (auto-detected by extension)")
    parser.add_argument("--source", default="en-US", help="Source locale for parity check")
    parser.add_argument("--target", default="zh-CN", help="Target locale to update")
    args = parser.parse_args()

    # ponytail: 自动检测格式
    input_path = Path(args.input) if args.input else ROOT / "tools" / "i18n-translations.csv"
    fmt = args.format
    if fmt is None:
        fmt = "json" if input_path.suffix == ".json" else "csv"

    if not input_path.exists():
        print(f"[error] input file not found: {input_path}", file=sys.stderr)
        return 1

    # 读取翻译
    if fmt == "csv":
        translations = read_translations_csv(input_path)
    else:
        translations = read_translations_json(input_path)
    print(f"[import] loaded {len(translations)} translated keys from {input_path}")

    # 解析目标 .ts 文件
    target_path = LOCALES_DIR / f"{args.target}.ts"
    if not target_path.exists():
        print(f"[error] target file not found: {target_path}", file=sys.stderr)
        return 1

    header_lines, existing_entries, footer_lines = parse_ts_file(target_path)
    print(f"[import] target {args.target}.ts: {len(existing_entries)} existing keys")

    # 合并：更新已有 key，追加新 key
    updated = 0
    added = 0
    for key, value in translations.items():
        if key in existing_entries:
            existing_entries[key] = escape_ts_string(value)
            updated += 1
        else:
            existing_entries[key] = escape_ts_string(value)
            added += 1

    write_ts_file(target_path, header_lines, existing_entries, footer_lines)
    print(f"[import] {updated} updated, {added} added → {target_path}")

    # ponytail: key parity 校验 — 与 source locale 对比
    source_path = LOCALES_DIR / f"{args.source}.ts"
    if source_path.exists():
        _, source_entries, _ = parse_ts_file(source_path)
        source_keys = set(source_entries.keys())
        target_keys = set(existing_entries.keys())
        only_source = source_keys - target_keys
        only_target = target_keys - source_keys
        if only_source:
            print(f"[warn] {len(only_source)} keys in {args.source} but missing in {args.target}:")
            for k in sorted(only_source):
                print(f"  {k}")
        if only_target:
            print(f"[warn] {len(only_target)} keys in {args.target} but missing in {args.source}:")
            for k in sorted(only_target):
                print(f"  {k}")
        if not only_source and not only_target:
            print(f"[import] key parity OK: {len(target_keys)} keys match {args.source}")

    return 0


if __name__ == "__main__":
    sys.exit(main())