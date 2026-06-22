import { describe, expect, test } from "vitest";

import {
  buildRenderSurfaceIframeDocument,
  buildRenderSurfaceIframeSrcDoc
} from "../render-surface-html";

describe("render-surface-html", () => {
  test("builds sandboxed iframe documents with CSP and optional bridge", () => {
    const srcDoc = buildRenderSurfaceIframeSrcDoc(
      "html",
      "<main><button data-lyra-action=\"ship\">Ship</button></main>",
      {
        theme: "dark",
        interactive: true,
        title: "Release Radar",
        surfaceId: "release-radar"
      }
    );

    expect(srcDoc).toContain("Content-Security-Policy");
    expect(srcDoc).toContain("lyra-render-surface-event");
    expect(srcDoc).toContain('data-lyra-surface-id="release-radar"');
    expect(srcDoc).toContain("Ship");
  });

  test("escapes unsafe text content", () => {
    const srcDoc = buildRenderSurfaceIframeDocument(
      "<pre>&lt;script&gt;alert(1)&lt;/script&gt;</pre>",
      {
        theme: "light",
        interactive: false,
        title: "Safe <surface>"
      }
    );

    expect(srcDoc).toContain("<title>Safe &lt;surface&gt;</title>");
    expect(srcDoc).not.toContain("<title>Safe <surface></title>");
  });
});
