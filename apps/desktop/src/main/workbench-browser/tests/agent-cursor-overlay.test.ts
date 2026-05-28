import { describe, expect, test } from "vitest";

import {
  LYRA_AGENT_PAGE_CURSOR_HOST_ID,
  buildAgentCursorOverlayScript
} from "../agent-cursor-overlay";

describe("buildAgentCursorOverlayScript", () => {
  test("injects the Bibata cursor overlay at the requested page point", () => {
    const script = buildAgentCursorOverlayScript({
      action: "act",
      durationMs: 1_900,
      cursor: { x: 42.4, y: 84.6 }
    });

    expect(script).toContain(LYRA_AGENT_PAGE_CURSOR_HOST_ID);
    expect(script).toContain('"action":"act"');
    expect(script).toContain('"durationMs":1900');
    expect(script).toContain('"x":42');
    expect(script).toContain('"y":85');
    expect(script).toContain("M201.163 133.54");
    expect(script).toContain("attachShadow");
  });

  test("falls back to the focused element or page center when no cursor point is available", () => {
    const script = buildAgentCursorOverlayScript({
      action: "type",
      durationMs: 1_200
    });

    expect(script).toContain('"x":null');
    expect(script).toContain('"y":null');
    expect(script).toContain("document.activeElement");
    expect(script).toContain("viewportWidth / 2");
    expect(script).toContain("window.__lyraAgentCursorTimer");
  });

  test("mounts a visible cursor host into the page DOM", () => {
    document.body.innerHTML = "<button id=\"target\">Target</button>";

    const script = buildAgentCursorOverlayScript({
      action: "press",
      durationMs: 800,
      cursor: { x: 24, y: 36 }
    });
    expect(window.eval(script)).toBe(true);

    const host = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID);
    expect(host).toBeInstanceOf(HTMLElement);
    expect(host?.style.position).toBe("fixed");
    expect(host?.style.zIndex).toBe("2147483647");
    expect(host?.style.contain).toBe("layout style");
    expect(host?.style.overflow).toBe("visible");
    expect(host?.shadowRoot?.querySelector("svg")).toBeInstanceOf(SVGElement);
  });
});
