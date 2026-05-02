import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

import { WORKBENCH_FOUNDATION_TOKENS } from "../apps/desktop/src/modules/workbench/theme/foundation";

type SelectorRule = {
  readonly selector: string;
  readonly required: readonly RegExp[];
  readonly forbidden?: readonly RegExp[];
};

type IconOnlyHoverRule = {
  readonly selector: string;
  readonly requireTransparentBackground?: boolean;
};

type CssSelectorBlock = {
  readonly selectors: readonly string[];
  readonly body: string;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const RENDERER_WORKBENCH_STYLES_DIR = path.join(ROOT, "apps/desktop/src/renderer/styles/workbench");
const MODULES_WORKBENCH_DIR = path.join(ROOT, "apps/desktop/src/modules/workbench");
const WORKBENCH_SHELL_ENTRYPOINT = path.join(MODULES_WORKBENCH_DIR, "shell/index.tsx");
const WORKBENCH_SHELL_ENTRYPOINT_RELATIVE = "apps/desktop/src/modules/workbench/shell/index.tsx";
const LEGACY_CSS_PATH = path.join(ROOT, "apps/desktop/src/renderer/styles/workbench.css");
const WORKBENCH_SHELL_ENTRYPOINT_MAX_LINES = 650;
const APPROVED_BREAKPOINTS = new Set(["720px", "860px", "980px", "1180px"]);
const FOUNDATION_TOKEN_NAMES = new Set(Object.keys(WORKBENCH_FOUNDATION_TOKENS));
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

const REACT_STATEFUL_VIEW_IMPORTS = new Set([
  "useCallback",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState"
]);

const STATEFUL_VIEW_HOOK_PATTERN = /\bReact\.use(?:Callback|Effect|LayoutEffect|Memo|Reducer|Ref|State)\b/;
const DISALLOWED_TITLEBAR_CONTEXT_TITLE_CLASS = "lyra-titlebar-context-title";
const DISALLOWED_LOCAL_TITLEBAR_CLASSES = [
  "lyra-file-manager-toolbar",
  "lyra-file-editor-toolbar",
  "lyra-results-topbar",
  "lyra-deep-search-topbar",
  "lyra-deep-search-toolbar",
  "lyra-image-viewer-toolbar",
  "lyra-mcp-center-toolbar",
  "lyra-skills-center-toolbar",
  "lyra-plugins-center-toolbar",
  "lyra-notification-center-header",
  "lyra-resource-monitor-header",
  "lyra-ai-history-topbar",
  "lyra-ai-history-scope-tabs",
  "lyra-ai-plan-review__header",
  "lyra-ai-plan-review__toolbar"
] as const;

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
  },
  {
    selector: ".lyra-ai-panel-project-bind-active",
    required: [/background:\s*transparent\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused)\)/]
  },
  {
    selector: ".lyra-ai-plan-card__action-primary",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-ai-plan-card__action-secondary",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-ai-agent-follow-toggle-active",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/, /background:\s*transparent\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-ai-agent-send-ready",
    required: [
      /color:\s*var\(--lyra-text-primary\)\s*;/,
      /border-color:\s*transparent\s*;/,
      /background:\s*transparent\s*;/,
      /box-shadow:\s*none\s*;/
    ],
    forbidden: [/#ffffff/i, /var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-ai-agent-send-ready .lyra-ai-agent-send-icon",
    required: [/transform:\s*none\s*;/]
  },
  {
    selector: ".lyra-ai-agent-send-sending",
    required: [/border-color:\s*transparent\s*;/, /background:\s*transparent\s*;/],
    forbidden: [/animation\s*:/, /var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-ai-history-row-project-icon",
    required: [/color:\s*var\(--lyra-text-muted\)\s*;/],
    forbidden: [/var\(--lyra-line-focused\)/]
  },
  {
    selector: ".lyra-ai-history-project-card-icon",
    required: [/color:\s*var\(--lyra-text-muted\)\s*;/],
    forbidden: [/var\(--lyra-line-focused\)/]
  },
  {
    selector: ".lyra-settings-ai-action-icon",
    required: [/border-color:\s*transparent\s*;/, /background:\s*transparent\s*;/]
  },
  {
    selector: ".lyra-settings-ai-action-primary.lyra-settings-ai-action-icon",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/, /border-color:\s*transparent\s*;/, /background:\s*transparent\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|warning-500)\)/]
  },
  {
    selector: ".lyra-command-approval-bar__icon-action--allow",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-terminal-green/]
  },
  {
    selector: ".lyra-command-approval-bar__icon-action--allow-once",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-terminal-green/]
  },
  {
    selector: ".lyra-logo-toggle-active",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/],
    forbidden: [/#f8c55d/i, /var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/, /radial-gradient\(/, /box-shadow\s*:/]
  },
  {
    selector: ".lyra-browser-mode-chip",
    required: [/background:\s*color-mix\(/],
    forbidden: [/#f8c55d/i, /rgba\(248/i, /linear-gradient\(/, /var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-deep-search-filter-chip-active",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/],
    forbidden: [/#f8c55d/i, /rgba\(109/i, /linear-gradient\(/, /var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-deep-search-node-selected",
    required: [/border-color:\s*color-mix\(/],
    forbidden: [/#f8c55d/i, /var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-engine-marker",
    required: [/background:\s*color-mix\(in srgb,\s*var\(--lyra-text-muted\)/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-notification-topbar-preview",
    required: [/background:\s*color-mix\(/, /backdrop-filter:\s*none\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/, /linear-gradient\(/]
  },
  {
    selector: ".lyra-notification-topbar-preview-marquee",
    required: [/animation:\s*none\s*;/]
  },
  {
    selector: ".lyra-file-manager-disk-kind-system",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-terminal-green/]
  },
  {
    selector: ".lyra-file-manager-disk-meter-fill-healthy",
    required: [/background:\s*color-mix\(in srgb,\s*var\(--lyra-text-secondary\)/],
    forbidden: [/var\(--lyra-terminal-green/]
  },
  {
    selector: ".lyra-file-manager-disk-vector-system",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-terminal-green/]
  },
  {
    selector: ".lyra-file-manager-chooser-confirm",
    required: [/background:\s*transparent\s*;/, /color:\s*var\(--lyra-text-secondary\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-ai-plan-bar__progress-step",
    required: [/width:\s*var\(--lyra-unit-18\)\s*;/, /height:\s*var\(--lyra-unit-2\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-ai-plan-review__approve",
    required: [/background:\s*transparent\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-ai-agent-runtime-feed-target-running",
    required: [/color:\s*var\(--lyra-text-secondary\)\s*;/, /animation:\s*none\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/, /linear-gradient\(/]
  },
  {
    selector: ".lyra-ai-thread-tab-item[data-status=\"running\"] .lyra-ai-thread-tab-icon",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-mcp-center-side-button-active::before",
    required: [/background:\s*color-mix\(in srgb,\s*var\(--lyra-text-primary\)/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-mcp-center-server-row-active::before",
    required: [/background:\s*color-mix\(in srgb,\s*var\(--lyra-text-primary\)/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-global-dialog-action-primary",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/],
    forbidden: [/var\(--lyra-(?:text-accent|line-focused|accent-primary)\)/]
  },
  {
    selector: ".lyra-workspace",
    required: [/grid-template-rows:\s*minmax\(0,\s*1fr\)\s*var\(--lyra-size-browser-tab-h\)\s*;/]
  },
  {
    selector: ".lyra-workspace > .lyra-browser-tabs",
    required: [/grid-row:\s*2\s*;/]
  },
  {
    selector: ".lyra-workspace-surface-single",
    required: [/grid-row:\s*1\s*;/]
  },
  {
    selector: ".lyra-workspace-surface-split",
    required: [/grid-row:\s*1\s*;/]
  },
  {
    selector: ".lyra-browser-tabs::before",
    required: [/top:\s*0\s*;/],
    forbidden: [/bottom:\s*0\s*;/]
  },
  {
    selector: ".lyra-browser-tab-item",
    required: [/margin-top:\s*var\(--lyra-unit-3\)\s*;/, /margin-bottom:\s*0\s*;/]
  },
  {
    selector: ".lyra-browser-tabs .lyra-browser-tab-item",
    required: [/margin-bottom:\s*var\(--lyra-unit-3\)\s*;/],
    forbidden: [/margin-top:\s*var\(--lyra-unit-3\)\s*;/]
  },
  {
    selector: ".lyra-browser-tabs .lyra-chrome-tab-background-svg",
    required: [/transform:\s*scaleY\(-1\)\s*;/]
  },
  {
    selector: ".lyra-browser-tabs .lyra-browser-tab-item-active::before",
    required: [/top:\s*calc\(var\(--lyra-unit-0-5\)\s*\*\s*-1\)\s*;/, /bottom:\s*auto\s*;/]
  },
  {
    selector: ".lyra-browser-tabs .lyra-browser-tab-item-split-group-active::before",
    required: [/top:\s*calc\(var\(--lyra-unit-0-5\)\s*\*\s*-1\)\s*;/, /bottom:\s*auto\s*;/]
  },
  {
    selector: ".lyra-browser-tab-item:hover .lyra-browser-tab-title",
    required: [/color:\s*var\(--lyra-text-primary\)\s*;/]
  }
];

const iconOnlyHoverRules: readonly IconOnlyHoverRule[] = [
  { selector: ".lyra-titlebar-navigation-action:hover" },
  { selector: ".lyra-titlebar-context-icon-button:hover:enabled" },
  { selector: ".lyra-titlebar-context-text-button:hover:enabled" },
  { selector: ".lyra-window-button:hover" },
  { selector: ".lyra-window-button-close:hover" },
  { selector: ".lyra-browser-nav-button:hover" },
  { selector: ".lyra-browser-tab-close:hover" },
  { selector: ".lyra-browser-tab-add:hover" },
  { selector: ".lyra-ai-panel-topbar-nav:hover" },
  { selector: ".lyra-ai-thread-tab-new:hover" },
  { selector: ".lyra-ai-panel-topbar-action:hover" },
  { selector: ".lyra-ai-panel-topbar-more-item:hover:enabled" },
  { selector: ".lyra-ai-permissions-panel__icon:hover" },
  { selector: ".lyra-ai-review-panel__icon:hover" },
  { selector: ".lyra-ai-proposed-plan__action:hover" },
  { selector: ".lyra-ai-message-action:hover" },
  { selector: ".lyra-ai-message-copy-button:hover" },
  { selector: ".lyra-ai-panel-history-item-delete:hover:enabled" },
  { selector: ".lyra-ai-plan-card__action:hover" },
  { selector: ".lyra-ai-agent-composer-attachment-remove:hover" },
  { selector: ".lyra-ai-agent-composer-menu-item:hover:enabled" },
  { selector: ".lyra-ai-agent-composer-submenu-item:hover" },
  { selector: ".lyra-ai-plan-bar__icon-action:hover:enabled" },
  { selector: ".lyra-ai-interaction-shell__button:hover:enabled" },
  { selector: ".lyra-ai-plan-review__action:hover:enabled" },
  { selector: ".lyra-ai-plan-review__comment-submit:hover:enabled" },
  { selector: ".lyra-ai-plan-review__comment-cancel:hover:enabled" },
  { selector: ".lyra-ai-plan-review__line-comment:hover" },
  { selector: ".lyra-ai-agent-composer-tools-trigger:hover:enabled" },
  { selector: ".lyra-ai-agent-follow-toggle:hover:enabled" },
  { selector: ".lyra-ai-agent-send-idle:hover:enabled" },
  { selector: ".lyra-ai-agent-send-ready:hover:enabled", requireTransparentBackground: false },
  { selector: ".lyra-ai-agent-send-sending:hover:enabled", requireTransparentBackground: false },
  { selector: ".lyra-ai-history-topbar-action:hover:enabled" },
  { selector: ".lyra-ai-history-row-action:hover" },
  { selector: ".lyra-ai-history-row-action-open:hover" },
  { selector: ".lyra-command-approval-bar__icon-action:hover" }
];

const transparentMenuSelectionSelectors = [
  ".lyra-ai-agent-composer-menu-item-active",
  ".lyra-ai-agent-composer-submenu-item-active"
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
  },
  {
    pattern: /\.lyra-browser-tab-item:hover\s+\.lyra-chrome-tab-background\s*\{/gs,
    message: "Tab hover must not reveal or alter the tab shape; only text brightness may change."
  },
  {
    pattern: /\.lyra-browser-tab-item:hover\s+\.lyra-chrome-tab-dividers/gs,
    message: "Tab hover must not alter tab dividers; only text brightness may change."
  },
  {
    pattern: /\.lyra-browser-tab-item:hover\s*\{[^}]*z-index\s*:/gs,
    message: "Tab hover must not change tab stacking style; only text brightness may change."
  }
];

export const escapeRegex = (input: string): string =>
  input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitSelectorList = (selectorText: string): string[] =>
  selectorText
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("@"));

const collectSelectorBlocks = (css: string): CssSelectorBlock[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({
      selectors: splitSelectorList(match[1] ?? ""),
      body: match[2] ?? ""
    }))
    .filter((block) => block.selectors.length > 0);

const findSelectorBlock = (css: string, selector: string): string | null => {
  const blocks = collectSelectorBlocks(css);
  const matchingBlock =
    blocks.find((block) => block.selectors.length === 1 && block.selectors[0] === selector)
    ?? blocks.find((block) => block.selectors.includes(selector));
  return matchingBlock?.body ?? null;
};

const findSelectorBlocks = (css: string, selector: string): CssSelectorBlock[] =>
  collectSelectorBlocks(css).filter((block) => block.selectors.includes(selector));

const isColorExemptFile = (filePath: string): boolean =>
  COLOR_EXEMPT_FILES.some((pattern) => pattern.test(filePath));

const isTsInlinePxAllowlisted = (filePath: string): boolean =>
  TS_INLINE_PX_ALLOWLIST.some((pattern) => pattern.test(filePath));

const isBreakpointLine = (line: string, literal: string): boolean =>
  line.includes("@media") && APPROVED_BREAKPOINTS.has(literal);

const lineNumberAt = (text: string, index: number): number =>
  text.slice(0, index).split("\n").length;

const normalizePath = (filePath: string): string => filePath.split(path.sep).join("/");

const relativeToRoot = (filePath: string): string => normalizePath(path.relative(ROOT, filePath));

const reportPath = (filePath: string): string =>
  path.isAbsolute(filePath) ? relativeToRoot(filePath) : normalizePath(filePath);

const isWorkbenchTestPath = (filePath: string): boolean => /\/tests\//.test(normalizePath(filePath));

const basenameOf = (filePath: string): string => path.basename(filePath);

const isPresentationalViewPath = (filePath: string): boolean => {
  const basename = basenameOf(filePath);
  return basename === "surface-view.tsx"
    || basename.endsWith("-surface-view.tsx")
    || basename === "agent-composer-view.tsx"
    || basename === "settings-surface-view.tsx"
    || basename === "tab-strip-view.tsx"
    || basename === "thread-view.tsx"
    || /^view-panels(?:-[^/]+)?\.tsx$/.test(basename);
};

const isPureUiModelPath = (filePath: string): boolean => {
  const basename = basenameOf(filePath);
  if (basename.startsWith("use-") || basename.endsWith("-view-model.ts")) {
    return false;
  }
  return basename === "model.ts"
    || basename === "render-model.ts"
    || basename === "runtime-model.ts"
    || basename === "split-model.ts"
    || basename === "surface-model.ts"
    || basename.endsWith("-model.ts")
    || basename.endsWith("-render-model.ts")
    || basename.endsWith("-runtime-model.ts")
    || basename.endsWith("-surface-model.ts")
    || basename.endsWith("-task.ts");
};

const isRuntimeHookPath = (filePath: string): boolean => {
  const basename = basenameOf(filePath);
  return basename.startsWith("use-")
    && (basename.endsWith("-runtime.ts") || basename.endsWith("-model.ts"));
};

const moduleBasename = (moduleSpecifier: string): string => {
  const normalized = normalizePath(moduleSpecifier);
  const withoutQuery = normalized.split("?")[0] ?? normalized;
  return withoutQuery.split("/").at(-1) ?? withoutQuery;
};

const isLocalModuleSpecifier = (moduleSpecifier: string): boolean =>
  moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/");

const isViewModuleSpecifier = (moduleSpecifier: string): boolean => {
  const basename = moduleBasename(moduleSpecifier).replace(/\.(?:tsx?|jsx?)$/, "");
  return basename === "view"
    || basename === "surface-view"
    || basename === "thread-view"
    || basename === "settings-surface-view"
    || basename === "tab-strip-view"
    || basename === "agent-composer-view"
    || basename.startsWith("view-panels-")
    || basename === "view-panels"
    || basename.endsWith("-view");
};

const isRuntimeModuleSpecifier = (moduleSpecifier: string): boolean => {
  const basename = moduleBasename(moduleSpecifier).replace(/\.(?:tsx?|jsx?)$/, "");
  return basename === "service"
    || basename.startsWith("use-")
    || basename === "runtime-model"
    || basename.endsWith("-runtime")
    || basename.endsWith("-task");
};

const hasExactClassToken = (text: string, className: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_-])${escapeRegex(className)}(?![A-Za-z0-9_-])`, "u").test(text);

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

const hasDeclaration = (body: string, property: string): boolean =>
  new RegExp(`(?:^|;)\\s*${escapeRegex(property)}\\s*:`, "m").test(body);

const declarationValues = (body: string, propertyPattern: string): string[] =>
  [...body.matchAll(new RegExp(`(?:^|;)\\s*${propertyPattern}\\s*:\\s*([^;]+)\\s*;`, "gm"))]
    .map((match) => match[1]?.trim() ?? "");

const hasTransparentBackgroundDeclaration = (body: string): boolean =>
  declarationValues(body, "background(?:-color)?").some((value) => value === "transparent");

const hasNonTransparentBackgroundDeclaration = (body: string): boolean =>
  declarationValues(body, "background(?:-color)?").some((value) => value !== "transparent");

const hasNonNoneBoxShadowDeclaration = (body: string): boolean =>
  declarationValues(body, "box-shadow").some((value) => value !== "none");

export const validateIconOnlyHoverRules = (css: string): string[] => {
  const violations: string[] = [];
  for (const rule of iconOnlyHoverRules) {
    const blocks = findSelectorBlocks(css, rule.selector);
    if (blocks.length === 0) {
      violations.push(`Missing icon-only hover selector block: ${rule.selector}`);
      continue;
    }

    const requireTransparentBackground = rule.requireTransparentBackground ?? true;
    for (const block of blocks) {
      if (requireTransparentBackground && !hasTransparentBackgroundDeclaration(block.body)) {
        violations.push(`${rule.selector} hover must declare background: transparent.`);
      }
      if (hasNonTransparentBackgroundDeclaration(block.body)) {
        violations.push(`${rule.selector} hover must not add a container background.`);
      }
      for (const property of ["border-color", "box-shadow", "transform"]) {
        if (hasDeclaration(block.body, property)) {
          violations.push(`${rule.selector} hover must not change ${property}.`);
        }
      }
    }
  }
  return violations;
};

export const validateTransparentMenuSelections = (css: string): string[] => {
  const violations: string[] = [];
  for (const selector of transparentMenuSelectionSelectors) {
    const blocks = findSelectorBlocks(css, selector);
    if (blocks.length === 0) {
      violations.push(`Missing transparent menu selection selector block: ${selector}`);
      continue;
    }
    for (const block of blocks) {
      if (hasNonTransparentBackgroundDeclaration(block.body)) {
        violations.push(`${selector} selected state must not use a row background.`);
      }
      if (hasNonNoneBoxShadowDeclaration(block.body)) {
        violations.push(`${selector} selected state must not use a row shadow.`);
      }
      if (hasDeclaration(block.body, "border-color")) {
        violations.push(`${selector} selected state must not use a row border.`);
      }
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

  for (const match of text.matchAll(/var\((--lyra-unit-[A-Za-z0-9-]+)/g)) {
    const tokenName = match[1] ?? "";
    if (FOUNDATION_TOKEN_NAMES.has(tokenName)) {
      continue;
    }
    const index = match.index ?? 0;
    const lineNumber = lineNumberAt(text, index);
    violations.push(`${filePath}:${lineNumber} references unknown foundation token ${tokenName}`);
  }

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

const hasValueImportBinding = (node: ts.ImportDeclaration): boolean => {
  const importClause = node.importClause;
  if (importClause === undefined) {
    return true;
  }
  if (importClause.isTypeOnly) {
    return false;
  }
  if (importClause.name !== undefined) {
    return true;
  }
  const namedBindings = importClause.namedBindings;
  if (namedBindings === undefined) {
    return false;
  }
  if (ts.isNamespaceImport(namedBindings)) {
    return true;
  }
  return namedBindings.elements.some((element) => element.isTypeOnly === false);
};

const valueImportNames = (node: ts.ImportDeclaration): string[] => {
  const importClause = node.importClause;
  if (importClause === undefined || importClause.isTypeOnly || importClause.namedBindings === undefined) {
    return [];
  }
  if (ts.isNamespaceImport(importClause.namedBindings)) {
    return [importClause.namedBindings.name.text];
  }
  return importClause.namedBindings.elements
    .filter((element) => element.isTypeOnly === false)
    .map((element) => element.name.text);
};

const hasValueExportBinding = (node: ts.ExportDeclaration): boolean => {
  if (node.isTypeOnly) {
    return false;
  }
  const exportClause = node.exportClause;
  if (exportClause === undefined || ts.isNamespaceExport(exportClause)) {
    return true;
  }
  return exportClause.elements.some((element) => element.isTypeOnly === false);
};

const moduleSpecifierText = (
  node: ts.ImportDeclaration | ts.ExportDeclaration
): string | null => {
  const moduleSpecifier = node.moduleSpecifier;
  if (moduleSpecifier === undefined || !ts.isStringLiteralLike(moduleSpecifier)) {
    return null;
  }
  return moduleSpecifier.text;
};

export const scanWorkbenchUiComposition = (filePath: string, text: string): string[] => {
  if (isWorkbenchTestPath(filePath) || (!filePath.endsWith(".ts") && !filePath.endsWith(".tsx"))) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const violations: string[] = [];
  const relativePath = reportPath(filePath);
  const isPresentationalView = isPresentationalViewPath(filePath);
  const isPureModel = isPureUiModelPath(filePath);
  const isRuntimeHook = isRuntimeHookPath(filePath);

  const pushViolation = (node: ts.Node, message: string): void => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push(`${relativePath}:${line + 1} ${message}`);
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleSpecifier = moduleSpecifierText(statement);
      if (moduleSpecifier === null) {
        continue;
      }
      const hasValueBinding = hasValueImportBinding(statement);
      if (
        isPresentationalView
        && moduleSpecifier === "react"
        && valueImportNames(statement).some((name) => REACT_STATEFUL_VIEW_IMPORTS.has(name))
      ) {
        pushViolation(statement, "Presentational workbench views must not own React state/effect hooks. Move runtime behavior into a model or runtime hook.");
      }
      if (
        isPresentationalView
        && hasValueBinding
        && isLocalModuleSpecifier(moduleSpecifier)
        && isRuntimeModuleSpecifier(moduleSpecifier)
      ) {
        pushViolation(statement, "Presentational workbench views must not import runtime hooks, services, or task modules by value. Pass data/actions through props.");
      }
      if (isPureModel && hasValueBinding && moduleSpecifier === "react") {
        pushViolation(statement, "Workbench model/render/task files may import React types only, not React runtime values.");
      }
      if (
        (isPureModel || isRuntimeHook)
        && hasValueBinding
        && isLocalModuleSpecifier(moduleSpecifier)
        && isViewModuleSpecifier(moduleSpecifier)
      ) {
        pushViolation(statement, "Workbench model/runtime files must not import view components by value. Keep view dependencies one-way.");
      }
    }

    if (ts.isExportDeclaration(statement)) {
      const moduleSpecifier = moduleSpecifierText(statement);
      if (moduleSpecifier === null) {
        continue;
      }
      const hasValueBinding = hasValueExportBinding(statement);
      if (
        (isPureModel || isRuntimeHook)
        && hasValueBinding
        && isLocalModuleSpecifier(moduleSpecifier)
        && isViewModuleSpecifier(moduleSpecifier)
      ) {
        pushViolation(statement, "Workbench model/runtime files must not re-export view components by value. Keep view dependencies one-way.");
      }
    }
  }

  if (isPresentationalView && STATEFUL_VIEW_HOOK_PATTERN.test(text)) {
    violations.push(`${relativePath}:1 Presentational workbench views must not call React state/effect hooks. Move runtime behavior into a model or runtime hook.`);
  }
  if (isPresentationalView && /\bgetDesktopApi\b|\blyraDesktop\b/.test(text)) {
    violations.push(`${relativePath}:1 Presentational workbench views must not call the desktop bridge directly. Pass bridge-backed actions through props.`);
  }

  return violations;
};

export const scanWorkbenchDesignContracts = (filePath: string, text: string): string[] => {
  const normalizedPath = normalizePath(filePath);
  const relativePath = reportPath(filePath);
  const violations: string[] = [];

  if (normalizedPath.endsWith(".tsx")) {
    if (hasExactClassToken(text, DISALLOWED_TITLEBAR_CONTEXT_TITLE_CLASS)) {
      violations.push(`${relativePath}:1 Global titlebar contributions must not render visible title blocks; the active tab already carries the surface title.`);
    }
    for (const className of DISALLOWED_LOCAL_TITLEBAR_CLASSES) {
      if (hasExactClassToken(text, className)) {
        violations.push(`${relativePath}:1 Workspace surfaces must move ${className} controls into the global titlebar contribution.`);
      }
    }
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/ai-panel\/plan-card\.tsx$/.test(normalizedPath)
    && /\bStatusIndicator\b/.test(text)
  ) {
    violations.push(`${relativePath}:1 PlanCard title must not render a decorative status dot.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/ai-history\/surface-view\.tsx$/.test(normalizedPath)
    && (/\bprojectLogoUrlForRoot\b/.test(text) || /projectLogoUrl=\{(?!null\})/u.test(text))
  ) {
    violations.push(`${relativePath}:1 AI history rows must use neutral project symbols, not colored project logos.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/ai-panel\/thread-tabs\.tsx$/.test(normalizedPath)
    && (/\bprojectLogoUrlForRoot\b/.test(text) || /projectLogoUrl=\{(?!null\})/u.test(text))
  ) {
    violations.push(`${relativePath}:1 AI thread tabs must use neutral project symbols, not colored project logos.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/ai-panel\/plan-question-bar\.tsx$/.test(normalizedPath)
    && /progress-dot/.test(text)
  ) {
    violations.push(`${relativePath}:1 Plan question navigation must not use decorative dot indicators.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/browser-search\/(?:result-engine-overview|deep-search-overview-sections|result-web-section)\.tsx$/.test(normalizedPath)
    && /style=\{\{[^}]*accentColor/u.test(text)
  ) {
    violations.push(`${relativePath}:1 Browser search surfaces must not render per-engine accent colors inline.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/browser-search\/(?:result-engine-overview|deep-search-overview-sections)\.tsx$/.test(normalizedPath)
    && /engine-dot/.test(text)
  ) {
    violations.push(`${relativePath}:1 Browser search source markers must not use decorative dot indicators.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/browser-search\/deep-search-canvas\.tsx$/.test(normalizedPath)
    && /#[0-9a-fA-F]{6}/u.test(text)
  ) {
    violations.push(`${relativePath}:1 Deep search minimap nodes must stay neutral, not per-kind accent colors.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/browser-search\/result-surface-model\.ts$/.test(normalizedPath)
    && /sourceChips:[\s\S]*accentColor/u.test(text)
  ) {
    violations.push(`${relativePath}:1 Browser result source chips must stay neutral and not carry accentColor.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/command-approval-bar\/view\.tsx$/.test(normalizedPath)
    && (/risk\.color/.test(text) || /style=\{\{[^}]*color/u.test(text) || /#[0-9a-fA-F]{6}/u.test(text))
  ) {
    violations.push(`${relativePath}:1 Command approval risk display must stay neutral; reserve red for deny/error actions.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/shell\/element-picker-appearance\.ts$/.test(normalizedPath)
    && (/--lyra-(?:line-focused|text-accent)/.test(text) || /#7d82e8|#5c78e2/i.test(text))
  ) {
    violations.push(`${relativePath}:1 Browser element picker appearance must use neutral workbench tones, not accent tokens.`);
  }

  if (
    /apps\/desktop\/src\/modules\/workbench\/ai-panel\/rich-content\.tsx$/.test(normalizedPath)
    && /--lyra-line-focused/.test(text)
  ) {
    violations.push(`${relativePath}:1 AI rich content diagrams must use neutral line tokens, not focused accent tokens.`);
  }

  return violations;
};

export const scanWorkbenchShellEntrypointSize = (filePath: string, text: string): string[] => {
  const normalizedPath = normalizePath(filePath);
  if (
    normalizedPath !== normalizePath(WORKBENCH_SHELL_ENTRYPOINT)
    && normalizedPath !== WORKBENCH_SHELL_ENTRYPOINT_RELATIVE
  ) {
    return [];
  }
  const lineCount = text.split(/\r?\n/).length;
  if (lineCount <= WORKBENCH_SHELL_ENTRYPOINT_MAX_LINES) {
    return [];
  }
  return [
    `${reportPath(filePath)}:${WORKBENCH_SHELL_ENTRYPOINT_MAX_LINES + 1} shell/index.tsx is ${String(lineCount)} lines; keep WorkbenchShell as a composition layer and extract new UI/runtime logic into shell hooks, render models, or surface adapters.`
  ];
};

export const runUiStyleGuard = (): string[] => {
  const violations: string[] = [];

  const cssPaths = collectCssPaths();
  const cssByPath = new Map(cssPaths.map((cssPath) => [cssPath, fs.readFileSync(cssPath, "utf8")]));
  const combinedCss = [...cssByPath.values()].join("\n\n");
  violations.push(...validateSelectorRules(combinedCss));
  violations.push(...validateGlobalPatterns(combinedCss));
  violations.push(...validateIconOnlyHoverRules(combinedCss));
  violations.push(...validateTransparentMenuSelections(combinedCss));

  for (const [cssPath, cssText] of cssByPath) {
    violations.push(...scanCssText(cssPath, cssText));
  }

  for (const filePath of collectWorkbenchTsPaths()) {
    const text = fs.readFileSync(filePath, "utf8");
    violations.push(...scanInlineStyleLiterals(filePath, text));
    violations.push(...scanWorkbenchUiComposition(filePath, text));
    violations.push(...scanWorkbenchDesignContracts(filePath, text));
    violations.push(...scanWorkbenchShellEntrypointSize(filePath, text));
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
