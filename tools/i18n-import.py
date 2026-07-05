#!/usr/bin/env python3
"""
i18n-import.py — 从翻译好的 CSV/JSON 合并回 locale surface 目录的 .ts 文件

用法:
  python3 tools/i18n-import.py                           # 默认读 tools/i18n-translations.csv → zh-CN
  python3 tools/i18n-import.py -i translations.json --format json
  python3 tools/i18n-import.py --target zh-CN

规则:
  - 只更新 target locale（默认 zh-CN），源语言 en-US 不动
  - 空翻译值跳过（保留原值），不覆盖
  - 新增 key 追加到对应 surface 文件末尾（key→surface 映射从 en-US 目录建立）
  - 保留原 .ts 文件的结构：header 注释、export const 声明、as const
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

# ponytail: surface 文件列表 — 与 verify-i18n.ts 的 SURFACE_FILES 保持一致
SURFACE_FILES = [
    "shared", "shell", "file-manager", "file-editor", "image-viewer",
    "agent-project-tree", "agent-plan-board", "agent-git", "agent-session-history",
    "login-manager", "software-store", "notifications", "ai-panel", "location",
]

ENTRY_RE = re.compile(r'^\s*"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')
EXPORT_CONST_RE = re.compile(r'^\s*export\s+const\s+(\w+)\s*=\s*\{')
CLOSE_RE = re.compile(r'^\s*\}\s*(?:as\s+const)?\s*;?\s*$')


def parse_ts_file(path: Path) -> tuple[list[str], dict[str, str], list[str]]:
    """
    解析单个 surface .ts 文件，返回:
      - header_lines: const 声明之前的所有行（注释等）
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
            if EXPORT_CONST_RE.match(line):
                in_body = True
                header_lines.append(line)
                continue
            header_lines.append(line)
        else:
            m = ENTRY_RE.match(line)
            if m:
                entries[m.group(1)] = m.group(2)
            elif CLOSE_RE.match(line):
                footer_lines.append(line)
                in_body = False
    return header_lines, entries, footer_lines


def build_key_surface_map(locale: str) -> dict[str, str]:
    """
    从指定 locale 的 surface 目录建立 key→surface 映射。
    用于把导入的翻译写到正确的 surface 文件。
    """
    key_to_surface: dict[str, str] = {}
    locale_dir = LOCALES_DIR / locale
    if not locale_dir.is_dir():
        return key_to_surface
    for surface in SURFACE_FILES:
        surface_path = locale_dir / f"{surface}.ts"
        if not surface_path.exists():
            continue
        for line in surface_path.read_text(encoding="utf-8").splitlines():
            m = ENTRY_RE.match(line)
            if m:
                key_to_surface[m.group(1)] = surface
    return key_to_surface


def write_ts_file(
    path: Path,
    header_lines: list[str],
    entries: dict[str, str],
    footer_lines: list[str],
) -> None:
    """将字典写回 .ts 文件，保留 header/footer 结构"""
    out_lines = list(header_lines)
    # ponytail: value 全程保持 TS 转义形式 — 不做 escape，避免双重转义
    for key, value in entries.items():
        out_lines.append(f'  "{key}": "{value}",')
    out_lines.extend(footer_lines)
    path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")


def read_translations_csv(
    path: Path, target_col: str
) -> dict[str, str]:
    """读取 CSV，返回 key→target 翻译映射（跳过空翻译）"""
    translations: dict[str, str] = {}
    with open(path, encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row["key"]
            val = row.get(target_col, "")
            if val:
                translations[key] = val
    return translations


def read_translations_json(
    path: Path, target_col: str
) -> dict[str, str]:
    """读取 JSON，返回 key→target 翻译映射（跳过空翻译）"""
    data = json.loads(path.read_text(encoding="utf-8"))
    translations: dict[str, str] = {}
    for item in data:
        key = item["key"]
        val = item.get(target_col, "")
        if val:
            translations[key] = val
    return translations


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import translations into locale .ts surface files"
    )
    parser.add_argument(
        "-i",
        "--input",
        default=None,
        help="Input CSV/JSON file (default: tools/i18n-translations.csv)",
    )
    parser.add_argument(
        "--format",
        choices=["csv", "json"],
        default=None,
        help="Force format (auto-detected by extension)",
    )
    parser.add_argument(
        "--source", default="en-US", help="Source locale for key→surface mapping"
    )
    parser.add_argument(
        "--target", default="zh-CN", help="Target locale to update"
    )
    args = parser.parse_args()

    # ponytail: 自动检测格式
    input_path = (
        Path(args.input)
        if args.input
        else ROOT / "tools" / "i18n-translations.csv"
    )
    fmt = args.format
    if fmt is None:
        fmt = "json" if input_path.suffix == ".json" else "csv"

    if not input_path.exists():
        print(f"[error] input file not found: {input_path}", file=sys.stderr)
        return 1

    target_col = args.target
    if fmt == "csv":
        translations = read_translations_csv(input_path, target_col)
    else:
        translations = read_translations_json(input_path, target_col)
    print(
        f"[import] loaded {len(translations)} translated keys from {input_path}"
    )

    # ponytail: 从 en-US 目录建立 key→surface 映射，决定翻译写到哪个文件
    key_to_surface = build_key_surface_map(args.source)
    if not key_to_surface:
        print(
            f"[error] no surface files found for source locale: {LOCALES_DIR / args.source}",
            file=sys.stderr,
        )
        return 1

    # ponytail: 按 surface 分组翻译，每个 surface 文件独立读写
    target_locale_dir = LOCALES_DIR / args.target
    surface_translations: dict[str, dict[str, str]] = {}
    for key, value in translations.items():
        surface = key_to_surface.get(key)
        if not surface:
            print(
                f"[warn] key '{key}' not found in source {args.source}, skipping"
            )
            continue
        surface_translations.setdefault(surface, {})[key] = value

    updated_total = 0
    added_total = 0
    for surface, surface_updates in surface_translations.items():
        target_path = target_locale_dir / f"{surface}.ts"
        if not target_path.exists():
            print(f"[warn] target surface file missing: {target_path}")
            continue

        header_lines, existing_entries, footer_lines = parse_ts_file(target_path)
        updated = 0
        added = 0
        for key, value in surface_updates.items():
            if key in existing_entries:
                existing_entries[key] = value
                updated += 1
            else:
                existing_entries[key] = value
                added += 1

        write_ts_file(target_path, header_lines, existing_entries, footer_lines)
        print(
            f"[import] {surface}.ts: {updated} updated, {added} added → {target_path}"
        )
        updated_total += updated
        added_total += added

    print(
        f"[import] total: {updated_total} updated, {added_total} added across {len(surface_translations)} surface files"
    )

    # ponytail: key parity 校验 — 与 source locale 全量对比
    source_key_surface = build_key_surface_map(args.source)
    target_key_surface = build_key_surface_map(args.target)
    source_keys = set(source_key_surface.keys())
    target_keys = set(target_key_surface.keys())
    only_source = source_keys - target_keys
    only_target = target_keys - source_keys
    if only_source:
        print(
            f"[warn] {len(only_source)} keys in {args.source} but missing in {args.target}:"
        )
        for k in sorted(only_source):
            print(f"  {k}")
    if only_target:
        print(
            f"[warn] {len(only_target)} keys in {args.target} but missing in {args.source}:"
        )
        for k in sorted(only_target):
            print(f"  {k}")
    if not only_source and not only_target:
        print(
            f"[import] key parity OK: {len(target_keys)} keys match {args.source}"
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())