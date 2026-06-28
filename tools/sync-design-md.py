#!/usr/bin/env python3
"""
sync-design-md.py — 同步 VoltAgent/awesome-design-md，只保留 DESIGN.md 文件

用法:
  python3 tools/sync-design-md.py              # 拉取更新，清理非 DESIGN.md 文件
  python3 tools/sync-design-md.py --status      # 只查看状态，不修改
  python3 tools/sync-design-md.py --force       # 强制重置到上游最新

工作流程:
  1. git fetch + pull 上游 VoltAgent/awesome-design-md
  2. 遍历 design-md/ 目录，删除所有非 DESIGN.md 文件（README.md 等）
  3. 报告：新增/删除/更新的 DESIGN.md 数量

Agent 只需要 DESIGN.md — 其他文件（README.md 重定向到 getdesign.md 等）无用。
"""
import argparse
import subprocess
import sys
from pathlib import Path

REPO_DIR = Path(__file__).resolve().parent.parent / "参考" / "设计" / "awesome-design-md"
DESIGN_DIR = REPO_DIR / "design-md"
UPSTREAM = "https://github.com/VoltAgent/awesome-design-md.git"


def run_git(args: list[str], cwd: Path = REPO_DIR, fatal: bool = True) -> str:
    result = subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        msg = f"git {' '.join(args)} failed: {result.stderr.strip()}"
        if fatal:
            print(msg, file=sys.stderr)
            sys.exit(1)
        print(f"warn: {msg}", file=sys.stderr)
        return ""
    return result.stdout.strip()


def fetch_updates() -> tuple[int, str]:
    """Fetch + merge upstream. Returns (files_changed, merge_summary)."""
    run_git(["fetch", "origin"])
    before = run_git(["rev-parse", "HEAD"])
    run_git(["merge", "origin/main", "--no-edit"])
    after = run_git(["rev-parse", "HEAD"])
    if before == after:
        return 0, "Already up to date"
    diff = run_git(["diff", "--stat", before, after])
    return len(diff.splitlines()) if diff else 0, diff


def strip_non_design_files() -> tuple[int, int]:
    """Remove all non-DESIGN.md files from design-md/. Returns (removed_count, design_md_count)."""
    removed = 0
    design_count = 0
    if not DESIGN_DIR.exists():
        return 0, 0
    for path in DESIGN_DIR.rglob("*"):
        if path.is_dir():
            continue
        if path.name == "DESIGN.md":
            design_count += 1
            continue
        path.unlink()
        removed += 1
    return removed, design_count


def count_design_md() -> int:
    """Count DESIGN.md files currently present."""
    if not DESIGN_DIR.exists():
        return 0
    return sum(1 for p in DESIGN_DIR.rglob("DESIGN.md") if p.is_file())


def main():
    parser = argparse.ArgumentParser(description="Sync awesome-design-md, keep only DESIGN.md")
    parser.add_argument("--status", action="store_true", help="Show status only, no changes")
    parser.add_argument("--force", action="store_true", help="Force reset to upstream latest")
    args = parser.parse_args()

    if not REPO_DIR.exists():
        print(f"Repo not found at {REPO_DIR}", file=sys.stderr)
        print(f"Clone first: git clone {UPSTREAM} \"{REPO_DIR}\"", file=sys.stderr)
        sys.exit(1)

    if args.status:
        current = count_design_md()
        head = run_git(["log", "-1", "--format=%h %s"])
        print(f"DESIGN.md count: {current}")
        print(f"HEAD: {head}")
        return

    if args.force:
        run_git(["fetch", "origin"])
        run_git(["reset", "--hard", "origin/main"])

    # 1. Pull upstream
    changed, summary = fetch_updates()
    print(f"Upstream: {summary[:200] if summary else 'up to date'}")

    # 2. Strip non-DESIGN.md files
    removed, design_count = strip_non_design_files()
    print(f"Stripped {removed} non-DESIGN.md files")
    print(f"DESIGN.md files: {design_count}")

    if removed > 0:
        run_git(["add", "-A"])
        # ponytail: commit is non-fatal — git user config may not be set in this repo
        run_git(["commit", "-m", f"chore: strip non-DESIGN.md files ({removed} removed)"], fatal=False)

    print("Done.")


if __name__ == "__main__":
    main()