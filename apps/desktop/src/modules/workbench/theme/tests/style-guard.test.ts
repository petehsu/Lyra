import { describe, expect, test } from "vitest";

import { scanCssText, scanInlineStyleLiterals } from "../../../../../../../tools/verify-workbench-style";

describe("workbench UI guard", () => {
  test("allows approved breakpoint literals in CSS", () => {
    const css = `
      @media (max-width: 980px) {
        .demo { padding: var(--lyra-unit-12); }
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
});
