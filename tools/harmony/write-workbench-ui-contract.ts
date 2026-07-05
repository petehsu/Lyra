import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LYRA_RESOLVED_THEMES } from "../../apps/desktop/src/modules/workbench/theme/presets/lyra";

type ContractDocument = {
  readonly contractId: "lyra-workbench-shell-v1";
  readonly sourceHashes: Record<string, string>;
  readonly brandAssets: Record<string, string>;
  readonly tokens: {
    readonly light: Record<string, string>;
    readonly dark: Record<string, string>;
  };
  readonly chrome: {
    readonly layout: Record<string, number | string>;
    readonly titlebarActions: readonly string[];
    readonly workspaceTabs: readonly string[];
    readonly panels: readonly string[];
  };
  readonly contractHash: string;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACT_JSON_PATH = path.join(ROOT, "apps/harmony_pc/ui-contract/workbench-shell.json");
const CONTRACT_ETS_PATH = path.join(
  ROOT,
  "apps/harmony_pc/entry/src/main/ets/contracts/WorkbenchShellContract.ets"
);

const SOURCE_FILES = [
  "apps/desktop/src/modules/workbench/shell/workbench-chrome.tsx",
  "apps/desktop/src/modules/workbench/shell/use-workbench-shell-adapter-props.ts",
  "apps/desktop/src/modules/workbench/shell/use-workbench-shell-slots.tsx",
  "apps/desktop/src/modules/workbench/theme/foundation.ts",
  "apps/desktop/src/modules/workbench/theme/semantic.ts",
  "apps/desktop/src/modules/workbench/theme/presets/lyra.ts",
  "apps/desktop/src/renderer/styles/shell.scss",
  "apps/desktop/src/renderer/styles/tokens.css",
  "apps/desktop/src/renderer/assets/brand/lyra-mark.svg",
  "apps/desktop/resources/icons/app/lyra-app-icon-light-1024.png"
] as const;

const TOKEN_NAMES = [
  "--lyra-app-bg",
  "--lyra-app-sidebar-bg",
  "--lyra-app-panel-bg",
  "--lyra-app-surface-bg",
  "--lyra-app-surface-strong-bg",
  "--lyra-app-muted-bg",
  "--lyra-app-row-hover-bg",
  "--lyra-app-row-active-bg",
  "--lyra-app-input-bg",
  "--lyra-app-input-border",
  "--lyra-app-border",
  "--lyra-app-border-strong",
  "--lyra-app-primary-button",
  "--lyra-app-primary-button-fg",
  "--lyra-text-primary",
  "--lyra-text-secondary",
  "--lyra-text-muted",
  "--lyra-status-success",
  "--lyra-status-warning",
  "--lyra-status-error"
] as const;

const TOKEN_FIELD_NAMES: Record<(typeof TOKEN_NAMES)[number], string> = {
  "--lyra-app-bg": "appBg",
  "--lyra-app-sidebar-bg": "appSidebarBg",
  "--lyra-app-panel-bg": "appPanelBg",
  "--lyra-app-surface-bg": "appSurfaceBg",
  "--lyra-app-surface-strong-bg": "appSurfaceStrongBg",
  "--lyra-app-muted-bg": "appMutedBg",
  "--lyra-app-row-hover-bg": "appRowHoverBg",
  "--lyra-app-row-active-bg": "appRowActiveBg",
  "--lyra-app-input-bg": "appInputBg",
  "--lyra-app-input-border": "appInputBorder",
  "--lyra-app-border": "appBorder",
  "--lyra-app-border-strong": "appBorderStrong",
  "--lyra-app-primary-button": "appPrimaryButton",
  "--lyra-app-primary-button-fg": "appPrimaryButtonFg",
  "--lyra-text-primary": "textPrimary",
  "--lyra-text-secondary": "textSecondary",
  "--lyra-text-muted": "textMuted",
  "--lyra-status-success": "statusSuccess",
  "--lyra-status-warning": "statusWarning",
  "--lyra-status-error": "statusError"
};

const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

const readSourceHashes = (): Record<string, string> =>
  Object.fromEntries(
    SOURCE_FILES.map((file) => {
      const absolutePath = path.join(ROOT, file);
      return [file, sha256(fs.readFileSync(absolutePath))];
    })
  );

const pickTokens = (vars: Record<string, string>): Record<string, string> =>
  Object.fromEntries(TOKEN_NAMES.map((name) => [name, vars[name] ?? ""])) ;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

const createContract = (): ContractDocument => {
  const draft = {
    contractId: "lyra-workbench-shell-v1" as const,
    sourceHashes: readSourceHashes(),
    brandAssets: {
      appIcon: "AppScope/resources/base/media/app_icon.png",
      entryIcon: "entry/src/main/resources/base/media/app_icon.png",
      desktopSourceIcon: "apps/desktop/resources/icons/app/lyra-app-icon-light-1024.png",
      desktopSourceMark: "apps/desktop/src/renderer/assets/brand/lyra-mark.svg"
    },
    tokens: {
      light: pickTokens(LYRA_RESOLVED_THEMES["lyra-light"].vars),
      dark: pickTokens(LYRA_RESOLVED_THEMES["lyra-dark"].vars)
    },
    chrome: {
      layout: {
        titlebarHeight: 34,
        titlebarNavigationHeight: 28,
        aiPanelWidth: 320,
        terminalHeight: 180,
        browserTabbarHeight: 34,
        radius: 8,
        gap: 10
      },
      titlebarActions: ["history", "terminal", "settings", "store", "files", "ai"],
      workspaceTabs: ["Search", "Files", "Agent"],
      panels: ["ai", "workspace", "terminal"]
    }
  };
  return {
    ...draft,
    contractHash: sha256(stableStringify(draft))
  };
};

const generatedHeader = "// Generated by tools/harmony/write-workbench-ui-contract.ts. Do not edit by hand.";

const renderJson = (contract: ContractDocument): string =>
  `${JSON.stringify(contract, null, 2)}\n`;

const renderTokenInterface = (): string =>
  TOKEN_NAMES.map((name) => `  ${TOKEN_FIELD_NAMES[name]}: string;`).join("\n");

const renderTokenValue = (vars: Record<string, string>): string =>
  `{\n${TOKEN_NAMES.map((name) => `  ${TOKEN_FIELD_NAMES[name]}: ${JSON.stringify(vars[name] ?? "")}`).join(",\n")}\n}`;

const renderLayoutInterface = (layout: Record<string, number | string>): string =>
  Object.entries(layout)
    .map(([key, value]) => `  ${key}: ${typeof value === "number" ? "number" : "string"};`)
    .join("\n");

const renderLayoutValue = (layout: Record<string, number | string>): string =>
  `{\n${Object.entries(layout)
    .map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`)
    .join(",\n")}\n}`;

const renderArkTs = (contract: ContractDocument): string => `${generatedHeader}

export const WORKBENCH_SHELL_CONTRACT_HASH: string = ${JSON.stringify(contract.contractHash)};

export interface WorkbenchTokens {
${renderTokenInterface()}
}

export interface WorkbenchLayout {
${renderLayoutInterface(contract.chrome.layout)}
}

export const WORKBENCH_LIGHT_TOKENS: WorkbenchTokens = ${renderTokenValue(contract.tokens.light)};

export const WORKBENCH_DARK_TOKENS: WorkbenchTokens = ${renderTokenValue(contract.tokens.dark)};

export const WORKBENCH_LAYOUT: WorkbenchLayout = ${renderLayoutValue(contract.chrome.layout)};

export const WORKBENCH_TITLEBAR_ACTIONS: string[] = ${JSON.stringify(contract.chrome.titlebarActions, null, 2)};
`;

const writeIfChanged = (filePath: string, content: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
    return;
  }
  fs.writeFileSync(filePath, content);
};

const assertCurrent = (filePath: string, expected: string): string | null => {
  if (!fs.existsSync(filePath)) {
    return `${path.relative(ROOT, filePath)} is missing`;
  }
  const actual = fs.readFileSync(filePath, "utf8");
  if (actual !== expected) {
    return `${path.relative(ROOT, filePath)} is stale`;
  }
  return null;
};

const main = (): void => {
  const check = process.argv.includes("--check");
  const contract = createContract();
  const json = renderJson(contract);
  const arkTs = renderArkTs(contract);

  if (check) {
    const failures = [
      assertCurrent(CONTRACT_JSON_PATH, json),
      assertCurrent(CONTRACT_ETS_PATH, arkTs)
    ].filter((failure): failure is string => failure !== null);
    if (failures.length > 0) {
      throw new Error(`Harmony UI contract drift detected:\n${failures.join("\n")}`);
    }
    console.log("[harmony-ui] contract OK");
    return;
  }

  writeIfChanged(CONTRACT_JSON_PATH, json);
  writeIfChanged(CONTRACT_ETS_PATH, arkTs);
  console.log(`[harmony-ui] wrote ${path.relative(ROOT, CONTRACT_JSON_PATH)}`);
};

main();
