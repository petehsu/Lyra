import { describe, expect, test } from "vitest";

import {
  scanWorkbenchDesignContracts,
  scanCssText,
  scanInlineStyleLiterals,
  scanLegacyVisualTokenConsumers,
  scanUiImportBoundaries,
  validateGlobalPatterns,
  scanWorkbenchShellEntrypointSize,
  scanWorkbenchUiComposition,
  validateDeletedStyleEntrypoints,
  validateSelectorRules
} from "../../../../../../../tools/verify-workbench-style";

describe("workbench UI guard", () => {
  test("allows approved breakpoint literals in CSS", () => {
    const css = `
      @media (max-width: 980px) {
        .demo { padding: var(--lyra-unit-12); }
      }
      @media (max-width: 720px) {
        .demo { gap: var(--lyra-unit-8); }
      }
    `;
    expect(scanCssText("apps/desktop/src/renderer/styles/surfaces.scss", css)).toEqual([]);
  });

  test("flags raw px literals in CSS", () => {
    const css = `.demo { padding: 12px; }`;
    expect(scanCssText("apps/desktop/src/renderer/styles/surfaces.scss", css)[0]).toContain("raw length literal 12px");
  });

  test("allows raw values only in token and material sources", () => {
    const rawColorCss = `.demo { color: #ffffff; background: rgba(0, 0, 0, 0.2); }`;
    expect(scanCssText("apps/desktop/src/renderer/styles/surfaces.scss", rawColorCss)[0]).toContain("raw color literal #ffffff");
    expect(scanCssText("apps/desktop/src/renderer/styles/tokens.css", rawColorCss)).toEqual([]);
    expect(scanCssText("apps/desktop/src/renderer/styles/material.scss", rawColorCss)).toEqual([]);
  });

  test("keeps deleted workbench CSS entrypoints physically removed", () => {
    expect(validateDeletedStyleEntrypoints()).toEqual([]);
  });

  test("keeps all workbench business TSX on App components and tokenized CSS", () => {
    const source = `export const AgentGitSurface = () => <button type="button">Refresh</button>;`;
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/agent-git/view.tsx",
      source
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/context-menu/view.tsx",
      source
    )[0]).toContain("Workbench business TSX");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/browser-tabs/page-surface.tsx",
      `export const SearchScope = () => <select aria-label="Scope" />;`
    )[0]).toContain("bare <select>");

    const css = `.lyra-agent-git-empty { max-width: 380px; }`;
    expect(scanCssText(
      "apps/desktop/src/renderer/styles/agents.scss",
      css
    )[0]).toContain("raw length literal 380px");
  });

  test("allows intrinsic controls only inside renderer UI implementation layers and tests", () => {
    expect(scanUiImportBoundaries(
      "apps/desktop/src/renderer/ui/components/app-demo.tsx",
      `export const AppDemo = () => <button type="button">Demo</button>;`
    )).toEqual([]);
    expect(scanUiImportBoundaries(
      "apps/desktop/src/renderer/ui/primitives/input.tsx",
      `export const Input = () => <input aria-label="Demo" />;`
    )).toEqual([]);
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/example/tests/view.test.tsx",
      `test("demo", () => <button type="button">Demo</button>);`
    )).toEqual([]);
  });

  test("keeps shell titlebar surfaces on App components", () => {
    const buttonSource = `export const TitlebarAction = () => <button type="button">Open</button>;`;
    const inputSource = `export const TitlebarInput = () => <input aria-label="Address" />;`;
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/shell/titlebar-ai-launch-pill.tsx",
      buttonSource
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/shell/titlebar-element-picker-button.tsx",
      buttonSource
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/intent-bar/index.tsx",
      buttonSource
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/shell/titlebar-navigation.tsx",
      inputSource
    )[0]).toContain("Lyra App components");
  });

  test("keeps settings AI surfaces on App components", () => {
    const buttonSource = `export const SettingsAiAction = () => <button type="button">Save</button>;`;
    const inputSource = `export const SettingsAiInput = () => <input aria-label="API key" />;`;
    const textareaSource = `export const SettingsAiText = () => <textarea aria-label="Models" />;`;

    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/settings-ai/view.tsx",
      buttonSource
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/settings-ai/field-renderer.tsx",
      inputSource
    )[0]).toContain("Lyra App components");
    expect(scanUiImportBoundaries(
      "apps/desktop/src/modules/workbench/settings-ai/model-picker.tsx",
      textareaSource
    )[0]).toContain("Lyra App components");
  });

  test("keeps composer send ready state icon-only", () => {
    const css = `
      .lyra-ai-agent-send-ready {
        border-color: color-mix(in srgb, var(--lyra-text-accent) 68%, transparent);
        background: color-mix(in srgb, var(--lyra-text-accent) 82%, var(--lyra-app-panel-bg) 18%);
        box-shadow: 0 var(--lyra-unit-4) var(--lyra-unit-11) color-mix(in srgb, var(--lyra-app-focus) 34%, transparent);
      }
    `;
    const violations = validateSelectorRules(css);
    expect(violations.some((violation) => violation.includes(".lyra-ai-agent-send-ready"))).toBe(true);
  });

  test("keeps tab hover from changing the tab chrome", () => {
    const css = `
      .lyra-browser-tab-item:hover {
        box-shadow: 0 0 1px currentColor;
      }

      .lyra-browser-tab-item:hover .lyra-chrome-tab-background {
        opacity: 1;
      }

      .lyra-browser-tab-item:hover .lyra-chrome-tab-dividers::before {
        opacity: 0;
      }
    `;
    const violations = validateGlobalPatterns(css);
    expect(violations.some((violation) => violation.includes("tab shape"))).toBe(true);
    expect(violations.some((violation) => violation.includes("tab dividers"))).toBe(true);
    expect(violations.some((violation) => violation.includes("tab shadow"))).toBe(true);
  });

  test("keeps AI thread tabs free of colored project logos", () => {
    const source = `
      import { projectLogoUrlForRoot } from "../project-identity";
      export const Tab = () => <ProjectIdentityIcon projectLogoUrl={projectLogoUrlForRoot(logos, root)} />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/ai-panel/thread-tabs.tsx",
      source
    )[0]).toContain("AI thread tabs");
  });

  test("keeps AI Panel free of old demo paths and local style imports", () => {
    const oldDemoPath = "./agent-chat-" + "demo/AgentChatApp";
    const localTokenPath = "./lyra-agents/styles/" + "tokens.css";
    const source = `
      import { LyraAgentsApp } from "${oldDemoPath}";
      import "${localTokenPath}";
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/ai-panel/view.tsx",
      source
    )[0]).toContain("old demo paths");
  });

  test("keeps Lyra Agents styles in the global workbench stylesheet", () => {
    const css = `.demo { color: var(--lyra-text-primary); }`;
    const localCssPath = "apps/desktop/src/modules/workbench/ai-panel/lyra-agents/" + "App.css";
    expect(scanCssText(
      localCssPath,
      css
    )[0]).toContain("renderer/styles/agents.scss");
  });

  test("keeps browser search engine accents out of visible result chips", () => {
    const source = `
      export const Row = ({ bucket }) => <span style={{ background: bucket.engine.accentColor }} />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/browser-search/result-engine-overview.tsx",
      source
    )[0]).toContain("per-engine accent colors");
  });

  test("keeps browser search source markers from becoming decorative dots", () => {
    const source = `
      export const Row = () => <span className="lyra-engine-dot" />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/browser-search/result-engine-overview.tsx",
      source
    )[0]).toContain("decorative dot");
  });

  test("keeps element picker appearance away from accent tokens", () => {
    const source = `
      const accent = readVar(styles, "--lyra-app-primary-button", "#7d82e8");
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/shell/element-picker-appearance.ts",
      source
    )[0]).toContain("neutral workbench tones");
  });

  test("keeps removed visual tokens out of product consumers", () => {
    const css = `.demo { background: var(--lyra-bg-app); border-color: var(--lyra-line-default); }`;
    const violations = scanLegacyVisualTokenConsumers(
      "apps/desktop/src/renderer/styles/surfaces.scss",
      css
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("removed visual system");
  });

  test("flags removed visual tokens even in token source files", () => {
    const css = `:root { --lyra-bg-app: var(--lyra-app-bg); }`;
    expect(scanLegacyVisualTokenConsumers(
      "apps/desktop/src/renderer/styles/tokens.css",
      css
    )[0]).toContain("removed visual system");
  });

  test("flags raw inline style literals in TSX", () => {
    const source = `
      export const Demo = () => <div style={{ fontSize: 12, borderRadius: "8px" }} />;
    `;
    const violations = scanInlineStyleLiterals(
      "apps/desktop/src/modules/workbench/demo.tsx",
      source
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("fontSize");
    expect(violations[1]).toContain("borderRadius");
  });

  test("keeps presentational surface views free of runtime hooks", () => {
    const source = `
      import { useState } from "react";
      import { useDemoRuntime } from "./use-demo-runtime";

      export const DemoSurfaceView = () => {
        const [open] = useState(false);
        const runtime = useDemoRuntime();
        return <div>{String(open)}{runtime.label}</div>;
      };
    `;
    const violations = scanWorkbenchUiComposition(
      "apps/desktop/src/modules/workbench/demo/surface-view.tsx",
      source
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("must not own React state/effect hooks");
    expect(violations[1]).toContain("must not import runtime hooks");
  });

  test("allows presentational views to consume typed runtime contracts", () => {
    const source = `
      import type { DemoRuntime } from "./use-demo-runtime";
      import { EMPTY_DEMO_STATE } from "./surface-model";

      export const DemoSurfaceView = ({ runtime }: { runtime: DemoRuntime }) => (
        <div>{runtime.label || EMPTY_DEMO_STATE.label}</div>
      );
    `;
    expect(scanWorkbenchUiComposition(
      "apps/desktop/src/modules/workbench/demo/surface-view.tsx",
      source
    )).toEqual([]);
  });

  test("keeps model files independent from view components", () => {
    const source = `
      import { DemoView } from "./surface-view";

      export const createDemoModel = () => DemoView;
    `;
    const violations = scanWorkbenchUiComposition(
      "apps/desktop/src/modules/workbench/demo/surface-model.ts",
      source
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("must not import view components");
  });

  test("caps the workbench shell entrypoint size", () => {
    const source = Array.from({ length: 801 }, (_, index) => `export const line${index} = ${index};`).join("\n");
    const violations = scanWorkbenchShellEntrypointSize(
      "apps/desktop/src/modules/workbench/shell/index.tsx",
      source
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("keep WorkbenchShell as a composition layer");
  });
});
