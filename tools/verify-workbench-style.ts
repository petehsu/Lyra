import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

type SelectorRule = {
  readonly selector: string;
  readonly required: readonly RegExp[];
  readonly forbidden?: readonly RegExp[];
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const RENDERER_WORKBENCH_STYLES_DIR = path.join(ROOT, "apps/desktop/src/renderer/styles/workbench");
const MODULES_WORKBENCH_DIR = path.join(ROOT, "apps/desktop/src/modules/workbench");
const LEGACY_CSS_PATH = path.join(ROOT, "apps/desktop/src/renderer/styles/workbench.css");
const APPROVED_BREAKPOINTS = new Set(["860px", "980px", "1180px"]);
const VISUAL_STYLE_KEYS = new Set([
  "fontSize",
  "lineHeight",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "top",
  "right",
  "bottom",
  "left",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "gap",
  "columnGap",
  "rowGap",
  "borderRadius"
]);

const COLOR_EXEMPT_FILES = [
  /apps\/desktop\/src\/renderer\/styles\/workbench\/settings\.css$/,
  /apps\/desktop\/src\/renderer\/styles\/workbench\/browser-search\.css$/,
  /apps\/desktop\/src\/renderer\/styles\/workbench\/ai-panel\.css$/,
  /apps\/desktop\/src\/renderer\/styles\/workbench\/notification-center\.css$/,
  /apps\/desktop\/src\/modules\/workbench\/command-approval-bar\/styles\.css$/
];

const TS_INLINE_PX_ALLOWLIST = [
  /apps\/desktop\/src\/modules\/workbench\/shell\/use-panel-layout\.ts$/,
  /apps\/desktop\/src\/modules\/workbench\/global-dialog\/view\.tsx$/,
  /apps\/desktop\/src\/modules\/workbench\/browser-tabs\/tab-strip\.tsx$/
];

const selectorRules: readonly SelectorRule[] = [
  {
    selector: ".lyra-settings-nav-item:hover",
    required: [/background:\s*transparent\s*;/]
  },
  {
    selector: ".lyra-settings-nav-item-active",
    required: [/background:\s*transparent\s*;/]
  },
  {
    selector: ".lyra-settings-nav-item-active::before",
    required: [/width:\s*var\(--lyra-(?:unit|space)-2\)\s*;/, /border-radius:\s*var\(--lyra-(?:unit-999|radius-pill)\)\s*;/, /background:\s*color-mix\(/]
  },
  {
    selector: ".lyra-settings-choice",
    required: [/border:\s*0\s*;/, /background:\s*transparent\s*;/, /position:\s*relative\s*;/],
    forbidden: [/box-shadow\s*:/]
  },
  {
    selector: ".lyra-settings-choice::before",
    required: [/width:\s*var\(--lyra-(?:unit|space)-2\)\s*;/, /border-radius:\s*var\(--lyra-(?:unit-999|radius-pill)\)\s*;/]
  },
  {
    selector: ".lyra-settings-choice:hover",
    required: [/background:\s*transparent\s*;/]
  },
  {
    selector: ".lyra-settings-choice-active",
    required: [/background:\s*transparent\s*;/]
  },
  {
    selector: ".lyra-settings-choice-active::before",
    required: [/background:\s*color-mix\(/]
  },
  {
    selector: ".lyra-context-menu-item",
    required: [/box-shadow:\s*none\s*;/, /border-radius:\s*0\s*;/]
  },
  {
    selector: ".lyra-context-menu-item:hover:enabled",
    required: [/background:\s*transparent\s*;/]
  }
];

const globalForbiddenPatterns: readonly { readonly pattern: RegExp; readonly message: string }[] = [
  {
    pattern: /\.lyra-settings-choice\s*\{[^}]*border:\s*var\(--lyra-(?:unit-0-5|stroke-hairline)\)/gs,
    message: "Settings choice must stay borderless (no boxed card style)."
  },
  {
    pattern: /\.lyra-settings-choice\s*\{[^}]*background:\s*color-mix\(/gs,
    message: "Settings choice base block must stay transparent (no filled card style)."
  },
  {
    pattern: /\.lyra-settings-choice-active\s*\{[^}]*background:\s*color-mix\(/gs,
    message: "Settings choice active block must stay transparent."
  }
];

export const escapeRegex = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findSelectorBlock = (css: string, selector: string): string | null => {
  const escaped = escapeRegex(selector);
  const blockRegex = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = css.match(blockRegex);
  return match?.[1] ?? null;
};

const isColorExemptFile = (filePath: string): boolean =>
  COLOR_EXEMPT_FILES.some((pattern) => pattern.test(filePath));

const isTsInlinePxAllowlisted = (filePath: string): boolean =>
  TS_INLINE_PX_ALLOWLIST.some((pattern) => pattern.test(filePath));

const isBreakpointLine = (line: string, literal: string): boolean =>
  line.includes("@media") && APPROVED_BREAKPOINTS.has(literal);

const lineNumberAt = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

export const collectFiles = (rootDir: string, predicate: (filePath: string) => boolean): string[] => {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results: string[] = [];
  const walk = (current: string): void => {
    const stats = fs.statSync(current);
    if (stats.isDirectory()) {
      for (const name of fs.readdirSync(current)) {
        walk(path.join(current, name));
      }
      return;
    }
    if (predicate(current)) {
      results.push(current);
    }
  };

  walk(rootDir);
  return results.sort();
};

const collectCssPaths = (): string[] => {
  const cssPaths = [
    ...collectFiles(RENDERER_WORKBENCH_STYLES_DIR, (filePath) => filePath.endsWith(".css")),
    ...collectFiles(MODULES_WORKBENCH_DIR, (filePath) => filePath.endsWith(".css"))
  ];

  if (fs.existsSync(LEGACY_CSS_PATH)) {
    cssPaths.push(LEGACY_CSS_PATH);
  }

  if (cssPaths.length === 0) {
    throw new Error("No workbench style files found.");
  }

  return cssPaths;
};

const collectWorkbenchTsPaths = (): string[] =>
  collectFiles(MODULES_WORKBENCH_DIR, (filePath) => filePath.endsWith(".ts") || filePath.endsWith(".tsx"));

export const validateSelectorRules = (css: string): string[] => {
  const violations: string[] = [];
  for (const rule of selectorRules) {
    const block = findSelectorBlock(css, rule.selector);
    if (block === null) {
      violations.push(`Missing selector block: ${rule.selector}`);
      continue;
    }

    for (const requiredPattern of rule.required) {
      if (!requiredPattern.test(block)) {
        violations.push(`${rule.selector} missing required style: ${requiredPattern}`);
      }
    }

    for (const forbiddenPattern of rule.forbidden ?? []) {
      if (forbiddenPattern.test(block)) {
        violations.push(`${rule.selector} contains forbidden style: ${forbiddenPattern}`);
      }
    }
  }
  return violations;
};

export const validateGlobalPatterns = (css: string): string[] => {
  const violations: string[] = [];
  for (const rule of globalForbiddenPatterns) {
    if (rule.pattern.test(css)) {
      violations.push(rule.message);
    }
  }
  return violations;
};

const findVarFallbackRanges = (text: string): Array<[number, number]> =>
  [...text.matchAll(/var\([^)]*,\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\)/g)].map((match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length
  ]);

const isWithinRanges = (index: number, ranges: readonly [number, number][]): boolean =>
  ranges.some(([start, end]) => index >= start && index < end);

export const scanCssText = (filePath: string, text: string): string[] => {
  const violations: string[] = [];
  const fallbackRanges = findVarFallbackRanges(text);

  for (const match of text.matchAll(/-?\d+(?:\.\d+)?px\b/g)) {
    const literal = match[0];
    const index = match.index ?? 0;
    const lineNumber = lineNumberAt(text, index);
    const line = text.split("\n")[lineNumber - 1] ?? "";
    if (isBreakpointLine(line, literal.replace(/^-/, ""))) {
      continue;
    }
    violations.push(`${filePath}:${lineNumber} contains raw length literal ${literal}`);
  }

  if (!isColorExemptFile(filePath)) {
    for (const match of text.matchAll(/#[0-9A-Fa-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g)) {
      const index = match.index ?? 0;
      if (isWithinRanges(index, fallbackRanges)) {
        continue;
      }
      const lineNumber = lineNumberAt(text, index);
      violations.push(`${filePath}:${lineNumber} contains raw color literal ${match[0]}`);
    }
  }

  return violations;
};

const collectStyleViolations = (
  filePath: string,
  initializer: ts.Expression,
  propertyName: string,
  sourceFile: ts.SourceFile
): string[] => {
  const violations: string[] = [];
  if (!VISUAL_STYLE_KEYS.has(propertyName)) {
    return violations;
  }
  if (initializer.kind === ts.SyntaxKind.NumericLiteral) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(initializer.getStart());
    violations.push(`${filePath}:${line + 1} uses raw numeric inline style for ${propertyName}`);
    return violations;
  }
  if (
    initializer.kind === ts.SyntaxKind.PrefixUnaryExpression &&
    (initializer as ts.PrefixUnaryExpression).operand.kind === ts.SyntaxKind.NumericLiteral
  ) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(initializer.getStart());
    violations.push(`${filePath}:${line + 1} uses raw numeric inline style for ${propertyName}`);
    return violations;
  }
  if (
    ts.isStringLiteralLike(initializer) &&
    /-?\d+(?:\.\d+)?px\b/.test(initializer.text)
  ) {
    const { line } = sourceFile.getLineAndCharacterOfPosition(initializer.getStart());
    violations.push(`${filePath}:${line + 1} uses raw px inline style for ${propertyName}`);
    return violations;
  }
  if (ts.isObjectLiteralExpression(initializer) && propertyName === "padding") {
    for (const property of initializer.properties) {
      if (!ts.isPropertyAssignment(property)) {
        continue;
      }
      const nestedName = property.name.getText(sourceFile);
      violations.push(...collectStyleViolations(filePath, property.initializer, nestedName, sourceFile));
    }
  }
  return violations;
};

export const scanInlineStyleLiterals = (filePath: string, text: string): string[] => {
  if (isTsInlinePxAllowlisted(filePath)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const violations: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "style" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer)
    ) {
      const expression = node.initializer.expression;
      if (expression && ts.isObjectLiteralExpression(expression)) {
        for (const property of expression.properties) {
          if (!ts.isPropertyAssignment(property)) {
            continue;
          }
          const propertyName = property.name.getText(sourceFile).replace(/^["']|["']$/g, "");
          violations.push(...collectStyleViolations(filePath, property.initializer, propertyName, sourceFile));
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

export const runUiStyleGuard = (): string[] => {
  const violations: string[] = [];

  const cssPaths = collectCssPaths();
  const cssByPath = new Map(cssPaths.map((cssPath) => [cssPath, fs.readFileSync(cssPath, "utf8")]));
  const combinedCss = [...cssByPath.values()].join("\n\n");
  violations.push(...validateSelectorRules(combinedCss));
  violations.push(...validateGlobalPatterns(combinedCss));

  for (const [cssPath, cssText] of cssByPath) {
    violations.push(...scanCssText(cssPath, cssText));
  }

  for (const filePath of collectWorkbenchTsPaths()) {
    const text = fs.readFileSync(filePath, "utf8");
    violations.push(...scanInlineStyleLiterals(filePath, text));
  }

  return violations;
};

export const main = (): void => {
  try {
    const violations = runUiStyleGuard();
    if (violations.length > 0) {
      console.error("\n[Lyra UI Guard] Violations found:\n");
      for (const violation of violations) {
        console.error(`- ${violation}`);
      }
      process.exit(1);
    }
    console.log("[Lyra UI Guard] OK");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Lyra UI Guard] ${message}`);
    process.exit(1);
  }
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
