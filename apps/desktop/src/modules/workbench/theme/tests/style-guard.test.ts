import { describe, expect, test } from "vitest";

import {
  scanCssText,
  scanInlineStyleLiterals,
  scanWorkbenchShellEntrypointSize,
  scanWorkbenchUiComposition
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
