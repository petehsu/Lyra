// verify-i18n.ts — 翻译完整性校验
// 检查: 1) locale 间 key 一致性  2) 代码中使用的 key 是否在字典中定义  3) 字典中的 key 是否被使用
//       4) surface 文件间 key 重复  5) 未外化的用户可见字符串（opt-in）
// 运行: node --import tsx tools/verify-i18n.ts [--report-unused] [--check-unexternalized]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { EN_US_DICTIONARY } from "../apps/desktop/src/modules/workbench/i18n/locales/en-US";
import { ZH_CN_DICTIONARY } from "../apps/desktop/src/modules/workbench/i18n/locales/zh-CN";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKBENCH_SRC = path.join(ROOT, "apps/desktop/src/modules/workbench");
const REPORT_UNUSED = process.argv.includes("--report-unused");
const CHECK_UNEXTERNALIZED = process.argv.includes("--check-unexternalized");

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

// ponytail: surface 文件列表 — 与 locales/{locale}/index.ts 中的 import 顺序一致
const SURFACE_FILES = [
  "shared", "shell", "file-manager", "file-editor", "image-viewer",
  "agent-project-tree", "agent-plan-board", "agent-git", "agent-session-history",
  "login-manager", "software-store", "notifications", "ai-panel", "location",
] as const;

const LOCALES_DIR = path.join(ROOT, "apps/desktop/src/modules/workbench/i18n/locales");

// ponytail: 从 surface 文件源码中提取 key — 匹配 "some.key": 模式
const SURFACE_KEY_RE = /^\s*"([^"]+)"\s*:/gm;

function extractSurfaceKeys(locale: string): Map<string, string[]> {
  const surfaceKeys = new Map<string, string[]>();
  for (const surface of SURFACE_FILES) {
    const filePath = path.join(LOCALES_DIR, locale, `${surface}.ts`);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, "utf-8");
    const keys: string[] = [];
    let match: RegExpExecArray | null;
    SURFACE_KEY_RE.lastIndex = 0;
    while ((match = SURFACE_KEY_RE.exec(src)) !== null) {
      keys.push(match[1]);
    }
    surfaceKeys.set(surface, keys);
  }
  return surfaceKeys;
}

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

// --- Unexternalized string detection ---
// ponytail: 正则启发式 — 不做 AST 解析，有已知误报风险（品牌名、SVG title），靠 lint-ignore 行内豁免处理
// 升级路径：换 @typescript-eslint 自定义规则做 AST 级精度

// ponytail: JSX 文本节点 — >text</ 要求闭合标签 </，排除 TS 泛型 >Promise<Param> 误匹配
const JSX_TEXT_RE = />([^<{}]+)<\//g;

// ponytail: 白名单属性字符串字面量 — title/aria-label/placeholder/label/alt = "..."
const PROP_STRING_RE = /\b(?:title|aria-label|placeholder|label|alt)\s*=\s*"([^"]+)"/g;

// ponytail: aria-label kebab-case 单标识符豁免 — 纯标识符无空格，是内部 landmark 标识
const KEBAB_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

// ponytail: HTML 实体 — &nbsp; &amp; 等不需要外化
const HTML_ENTITY_RE = /^&[a-zA-Z]+;$/;

const HAS_ALPHA_RE = /[a-zA-Z]/;

function extractUnexternalizedStrings(files: string[]): { file: string; line: number; kind: "jsx-text" | "prop-string"; text: string }[] {
  const violations: { file: string; line: number; kind: "jsx-text" | "prop-string"; text: string }[] = [];
  for (const file of files) {
    // ponytail: 跳过测试文件 — 测试中的硬编码字符串不算生产违规
    if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
    const src = fs.readFileSync(file, "utf-8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // ponytail: 行内豁免
      if (line.includes("// lint-ignore-unexternalized")) continue;

      JSX_TEXT_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = JSX_TEXT_RE.exec(line)) !== null) {
        const text = m[1].trim();
        if (!text || !HAS_ALPHA_RE.test(text)) continue;
        if (HTML_ENTITY_RE.test(text)) continue;
        violations.push({ file: path.relative(ROOT, file), line: i + 1, kind: "jsx-text", text });
      }

      PROP_STRING_RE.lastIndex = 0;
      while ((m = PROP_STRING_RE.exec(line)) !== null) {
        const text = m[1];
        if (!text || !HAS_ALPHA_RE.test(text)) continue;
        // ponytail: aria-label kebab-case 单标识符豁免 — 无空格的纯标识符是内部 landmark
        if (KEBAB_ID_RE.test(text) && !text.includes(" ")) continue;
        violations.push({ file: path.relative(ROOT, file), line: i + 1, kind: "prop-string", text });
      }
    }
  }
  return violations;
}

// --- Reporting ---

type IssueKind =
  | "missing-in-en"
  | "missing-in-zh"
  | "interpolation-mismatch"
  | "invalid-plural-pair"
  | "undefined-key"
  | "unused-key"
  | "duplicate-key"
  | "unexternalized-string";
const issues: { kind: IssueKind; key: string }[] = [];

// 1. Main namespace parity
for (const k of zhKeys) if (!enKeys.has(k)) issues.push({ kind: "missing-in-en", key: k });
for (const k of enKeys) if (!zhKeys.has(k)) issues.push({ kind: "missing-in-zh", key: k });

const interpolationTokens = (value: string): readonly string[] =>
  Array.from(value.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), (match) => match[1]!)
    .sort();

for (const key of enKeys) {
  if (!zhKeys.has(key)) continue;
  const enTokens = interpolationTokens(EN_US_DICTIONARY[key as keyof typeof EN_US_DICTIONARY]);
  const zhTokens = interpolationTokens(ZH_CN_DICTIONARY[key as keyof typeof ZH_CN_DICTIONARY]);
  if (enTokens.join(",") !== zhTokens.join(",")) {
    issues.push({
      kind: "interpolation-mismatch",
      key: `${key} (en-US: ${enTokens.join(",") || "none"}; zh-CN: ${zhTokens.join(",") || "none"})`
    });
  }
}

for (const key of enKeys) {
  if (!key.endsWith("_one")) continue;
  const baseKey = key.slice(0, -"_one".length);
  if (!enKeys.has(baseKey)) continue;
  const otherKey = `${baseKey}_other`;
  if (!enKeys.has(otherKey) || !zhKeys.has(otherKey)) {
    issues.push({ kind: "invalid-plural-pair", key: `${key} requires ${otherKey}` });
  }
}

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

// 4. Surface file key overlap — spread 合并时后者覆盖前者，应避免
for (const locale of ["en-US", "zh-CN"] as const) {
  const surfaceKeys = extractSurfaceKeys(locale);
  const seen = new Map<string, string>();
  for (const [surface, keys] of surfaceKeys) {
    for (const key of keys) {
      const prev = seen.get(key);
      if (prev) {
        issues.push({ kind: "duplicate-key", key: `[${locale}] ${key} (in ${prev} and ${surface})` });
      } else {
        seen.set(key, surface);
      }
    }
  }
}

// 5. Unexternalized strings (opt-in) — 只扫描 .tsx 文件，检测 JSX 文本节点和白名单属性字面量
if (CHECK_UNEXTERNALIZED) {
  const tsxFiles = srcFiles.filter((f) => f.endsWith(".tsx"));
  const unexternalized = extractUnexternalizedStrings(tsxFiles);
  for (const v of unexternalized) {
    issues.push({ kind: "unexternalized-string", key: `${v.file}:${v.line} [${v.kind}] "${v.text}"` });
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
  "interpolation-mismatch": "Locales use different interpolation variables",
  "invalid-plural-pair": "Plural _one key is missing its _other counterpart",
  "undefined-key": "Code uses key not defined in any dictionary",
  "unused-key": "Dictionary key not used in code",
  "duplicate-key": "Key duplicated across surface files (spread merge silently overwrites)",
  "unexternalized-string": "User-visible string not externalized via t() / formatMessage()",
};

for (const [kind, keys] of grouped) {
  console.error(`\n[${LABELS[kind]}] (${keys.length})`);
  for (const k of keys.sort()) console.error(`  ${k}`);
}

console.error(`\n[i18n] ${issues.length} issue(s) found.`);
process.exit(1);
