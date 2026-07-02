// verify-i18n.ts — 翻译完整性校验
// 检查: 1) locale 间 key 一致性  2) 代码中使用的 key 是否在字典中定义  3) 字典中的 key 是否被使用
// 运行: node --import tsx tools/verify-i18n.ts [--report-unused]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EN_US_DICTIONARY } from "../apps/desktop/src/modules/workbench/i18n/locales/en-US";
import { ZH_CN_DICTIONARY } from "../apps/desktop/src/modules/workbench/i18n/locales/zh-CN";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKBENCH_SRC = path.join(ROOT, "apps/desktop/src/modules/workbench");
const REPORT_UNUSED = process.argv.includes("--report-unused");

// --- Key set extraction ---

const enKeys = new Set(Object.keys(EN_US_DICTIONARY));
const zhKeys = new Set(Object.keys(ZH_CN_DICTIONARY));
const allDefinedKeys = new Set([...enKeys, ...zhKeys]);

// --- Source scanning ---

function scanDir(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // ponytail: 跳过 node_modules 和测试目录，测试中的 key 不算生产使用
      if (entry.name === "node_modules" || entry.name === "tests") continue;
      out.push(...scanDir(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

// ponytail: 正则匹配 t("key") / formatMessage("key", ...) / t('key') — 不匹配动态变量 key
const KEY_CALL_RE = /\b(?:t|formatMessage)\s*\(\s*["'`]([^"'`]+)["'`]/g;

function extractUsedKeys(files: string[]): Set<string> {
  const used = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, "utf-8");
    // ponytail: 按行处理 — 跳过 // 注释行（含文档示例 t("key")）和含 ${} 的动态模板 key
    for (const line of src.split("\n")) {
      if (line.trim().startsWith("//")) continue;
      let match: RegExpExecArray | null;
      KEY_CALL_RE.lastIndex = 0;
      while ((match = KEY_CALL_RE.exec(line)) !== null) {
        if (!match[1].includes("${")) used.add(match[1]);
      }
    }
  }
  return used;
}

// --- Reporting ---

type IssueKind = "missing-in-en" | "missing-in-zh" | "undefined-key" | "unused-key";
const issues: { kind: IssueKind; key: string }[] = [];

// 1. Main namespace parity
for (const k of zhKeys) if (!enKeys.has(k)) issues.push({ kind: "missing-in-en", key: k });
for (const k of enKeys) if (!zhKeys.has(k)) issues.push({ kind: "missing-in-zh", key: k });

// 2. Undefined keys in code
const srcFiles = scanDir(WORKBENCH_SRC, [".ts", ".tsx"]);
const usedKeys = extractUsedKeys(srcFiles);
for (const k of usedKeys) {
  if (!allDefinedKeys.has(k)) issues.push({ kind: "undefined-key", key: k });
}

// 3. Unused keys (opt-in)
if (REPORT_UNUSED) {
  for (const k of allDefinedKeys) {
    if (!usedKeys.has(k)) issues.push({ kind: "unused-key", key: k });
  }
}

// --- Output ---

if (issues.length === 0) {
  console.log("[i18n] OK — all keys consistent across locales, no undefined keys in code.");
  process.exit(0);
}

const grouped = new Map<IssueKind, string[]>();
for (const { kind, key } of issues) {
  const arr = grouped.get(kind) ?? [];
  arr.push(key);
  grouped.set(kind, arr);
}

const LABELS: Record<IssueKind, string> = {
  "missing-in-en": "Main: key in zh-CN but missing in en-US",
  "missing-in-zh": "Main: key in en-US but missing in zh-CN",
  "undefined-key": "Code uses key not defined in any dictionary",
  "unused-key": "Dictionary key not used in code",
};

for (const [kind, keys] of grouped) {
  console.error(`\n[${LABELS[kind]}] (${keys.length})`);
  for (const k of keys.sort()) console.error(`  ${k}`);
}

console.error(`\n[i18n] ${issues.length} issue(s) found.`);
process.exit(1);
