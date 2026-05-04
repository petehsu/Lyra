import { describe, expect, test } from "vitest";

import {
  scanWorkbenchDesignContracts,
  scanCssText,
  scanInlineStyleLiterals,
  validateGlobalPatterns,
  scanWorkbenchShellEntrypointSize,
  scanWorkbenchUiComposition,
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
    expect(scanCssText("apps/desktop/src/renderer/styles/workbench/demo.css", css)).toEqual([]);
  });

  test("flags raw px literals in CSS", () => {
    const css = `.demo { padding: 12px; }`;
    expect(scanCssText("apps/desktop/src/renderer/styles/workbench/demo.css", css)[0]).toContain("raw length literal 12px");
  });

  test("keeps composer send ready state icon-only", () => {
    const css = `
      .lyra-ai-agent-send-ready {
        border-color: color-mix(in srgb, var(--lyra-text-accent) 68%, transparent);
        background: color-mix(in srgb, var(--lyra-text-accent) 82%, var(--lyra-bg-panel) 18%);
        box-shadow: 0 var(--lyra-unit-4) var(--lyra-unit-11) color-mix(in srgb, var(--lyra-line-focused) 34%, transparent);
      }
    `;
    const violations = validateSelectorRules(css);
    expect(violations.some((violation) => violation.includes(".lyra-ai-agent-send-ready"))).toBe(true);
  });

  test("keeps tab hover from changing the tab chrome", () => {
    const css = `
      .lyra-browser-tab-item:hover {
        z-index: 4;
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
    expect(violations.some((violation) => violation.includes("tab stacking"))).toBe(true);
  });

  test("keeps plan cards free of decorative status dots", () => {
    const source = `
      import { StatusIndicator } from "./status-primitives";
      export const PlanCard = () => <StatusIndicator tone="info" variant="dot" />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/ai-panel/plan-card.tsx",
      source
    )[0]).toContain("must not render a decorative status dot");
  });

  test("keeps AI history rows free of colored project logos", () => {
    const source = `
      import { projectLogoUrlForRoot } from "../project-identity";
      export const Row = () => <ProjectIdentityIcon projectLogoUrl={projectLogoUrlForRoot(logos, root)} />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/ai-history/surface-view.tsx",
      source
    )[0]).toContain("neutral project symbols");
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

  test("keeps command approval risk labels neutral", () => {
    const source = `
      const risk = { color: "#eab308" };
      export const Risk = () => <span style={{ color: risk.color }} />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/command-approval-bar/view.tsx",
      source
    )[0]).toContain("risk display must stay neutral");
  });

  test("keeps element picker appearance away from accent tokens", () => {
    const source = `
      const lineFocused = readVar(styles, "--lyra-line-focused", "#7d82e8");
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/shell/element-picker-appearance.ts",
      source
    )[0]).toContain("neutral workbench tones");
  });

  test("keeps agent question navigation from using decorative dots", () => {
    const source = `
      export const AgentQuestion = () => <button className="lyra-ai-plan-bar__progress-dot" />;
    `;
    expect(scanWorkbenchDesignContracts(
      "apps/desktop/src/modules/workbench/ai-panel/plan-question-bar.tsx",
      source
    )[0]).toContain("decorative dot");
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
    const source = Array.from({ length: 651 }, (_, index) => `export const line${index} = ${index};`).join("\n");
    const violations = scanWorkbenchShellEntrypointSize(
      "apps/desktop/src/modules/workbench/shell/index.tsx",
      source
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain("keep WorkbenchShell as a composition layer");
  });
});
