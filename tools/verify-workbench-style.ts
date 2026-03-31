import fs from "node:fs";
import path from "node:path";

type SelectorRule = {
  readonly selector: string;
  readonly required: readonly RegExp[];
  readonly forbidden?: readonly RegExp[];
};

const ROOT = process.cwd();
const STYLES_DIR = path.join(ROOT, "apps/desktop/src/renderer/styles");
const SPLIT_STYLES_DIR = path.join(STYLES_DIR, "workbench");
const LEGACY_CSS_PATH = path.join(STYLES_DIR, "workbench.css");

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
    required: [/width:\s*2px\s*;/, /border-radius:\s*999px\s*;/, /background:\s*color-mix\(/]
  },
  {
    selector: ".lyra-settings-choice",
    required: [/border:\s*0\s*;/, /background:\s*transparent\s*;/, /position:\s*relative\s*;/],
    forbidden: [/box-shadow\s*:/]
  },
  {
    selector: ".lyra-settings-choice::before",
    required: [/width:\s*2px\s*;/, /border-radius:\s*999px\s*;/]
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
    pattern: /\.lyra-settings-choice\s*\{[^}]*border:\s*0\.5px/gs,
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

const violations: string[] = [];

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSelectorBlock(css: string, selector: string): string | null {
  const escaped = escapeRegex(selector);
  const blockRegex = new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m");
  const match = css.match(blockRegex);
  if (!match || match[1] === undefined) return null;
  return match[1];
}

function validateSelectorRules(css: string): void {
  for (const rule of selectorRules) {
    const block = findSelectorBlock(css, rule.selector);
    if (block === null) {
      violations.push(`Missing selector block: ${rule.selector}`);
      continue;
    }

    for (const requiredPattern of rule.required) {
      if (requiredPattern.test(block) === false) {
        violations.push(`${rule.selector} missing required style: ${requiredPattern}`);
      }
    }

    for (const forbiddenPattern of rule.forbidden ?? []) {
      if (forbiddenPattern.test(block)) {
        violations.push(`${rule.selector} contains forbidden style: ${forbiddenPattern}`);
      }
    }
  }
}

function validateGlobalPatterns(css: string): void {
  for (const rule of globalForbiddenPatterns) {
    if (rule.pattern.test(css)) {
      violations.push(rule.message);
    }
  }
}

function collectWorkbenchCssText(): string {
  const cssPaths: string[] = [];

  if (fs.existsSync(SPLIT_STYLES_DIR)) {
    const splitCssFiles = fs.readdirSync(SPLIT_STYLES_DIR)
      .filter((name) => name.endsWith(".css"))
      .sort()
      .map((name) => path.join(SPLIT_STYLES_DIR, name));
    cssPaths.push(...splitCssFiles);
  }

  if (fs.existsSync(LEGACY_CSS_PATH)) {
    cssPaths.push(LEGACY_CSS_PATH);
  }

  if (cssPaths.length === 0) {
    throw new Error(
      `No workbench style files found under ${STYLES_DIR}`
    );
  }

  return cssPaths.map((cssPath) => fs.readFileSync(cssPath, "utf8")).join("\n\n");
}

function main(): void {
  let css = "";
  try {
    css = collectWorkbenchCssText();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Lyra UI Guard] ${message}`);
    process.exit(1);
  }
  validateSelectorRules(css);
  validateGlobalPatterns(css);

  if (violations.length > 0) {
    console.error("\n[Lyra UI Guard] Violations found:\n");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log("[Lyra UI Guard] OK");
}

main();
