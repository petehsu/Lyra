import { describe, expect, test } from "vitest";

import {
  LYRA_AGENT_PAGE_CURSOR_HOST_ID,
  buildAgentCursorOverlayScript
} from "../agent-cursor-overlay";

describe("buildAgentCursorOverlayScript", () => {
  test("injects the Bibata cursor overlay at the requested page point", () => {
    const script = buildAgentCursorOverlayScript({
      action: "act",
      phase: "move",
      durationMs: 1_900,
      cursor: { x: 42.4, y: 84.6 }
    });

    expect(script).toContain(LYRA_AGENT_PAGE_CURSOR_HOST_ID);
    expect(script).toContain('"action":"act"');
    expect(script).toContain('"phase":"move"');
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
      phase: "down",
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
    expect(host?.dataset.lyraAgentPhase).toBe("down");
    expect(host?.shadowRoot?.querySelector("svg")).toBeInstanceOf(SVGElement);
    expect(host?.shadowRoot?.querySelector("[data-lyra-agent-cursor-sway]")).toBeInstanceOf(HTMLElement);
  });

  test("sways around the icon center while the trail is still moving", () => {
    document.body.innerHTML = "";
    const script = buildAgentCursorOverlayScript({
      action: "observe",
      phase: "move",
      durationMs: 60_000,
      hold: true,
      cursor: { x: 10, y: 20 },
      points: [
        { x: 10, y: 20 },
        { x: 80, y: 40 }
      ]
    });
    expect(script).toContain('"hold":true');
    expect(script).toContain("lyra-agent-cursor-sway");
    expect(script).toContain("rotate(6deg) scale(0.9)");
    expect(script).toContain("transformOrigin = \"21px 21px\"");
    expect(window.eval(script)).toBe(true);
    const sway = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID)
      ?.shadowRoot
      ?.querySelector("[data-lyra-agent-cursor-sway]");
    expect(sway).toBeInstanceOf(HTMLElement);
    expect((sway as HTMLElement).style.animation).toContain("lyra-agent-cursor-sway");
  });

  test("sizes the thought to its text, hides it when empty, and caps the box", () => {
    document.body.innerHTML = "";
    const empty = buildAgentCursorOverlayScript({
      action: "act",
      phase: "move",
      durationMs: 800,
      cursor: { x: 24, y: 36 }
    });
    expect(window.eval(empty)).toBe(true);
    const hidden = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID)
      ?.shadowRoot
      ?.querySelector("[data-lyra-agent-cursor-thought]");
    expect(hidden).toBeInstanceOf(HTMLElement);
    expect((hidden as HTMLElement).style.display).toBe("none");
    expect((hidden as HTMLElement).style.maxWidth).toBe("220px");
    expect((hidden as HTMLElement).style.maxHeight).toBe("88px");
    expect((hidden as HTMLElement).style.width).toBe("max-content");

    const shown = buildAgentCursorOverlayScript({
      action: "act",
      phase: "move",
      durationMs: 800,
      cursor: { x: 24, y: 36 },
      thought: "先点登录"
    });
    expect(window.eval(shown)).toBe(true);
    const note = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID)
      ?.shadowRoot
      ?.querySelector("[data-lyra-agent-cursor-thought]");
    expect((note as HTMLElement).style.display).toBe("block");
    expect((note as HTMLElement).textContent).toBe("先点登录");
    expect((note as HTMLElement).style.overflow).toBe("auto");
    expect(Number.parseFloat((note as HTMLElement).style.left)).toBeGreaterThanOrEqual(58);
    expect((note as HTMLElement).parentElement?.getAttribute("data-lyra-agent-cursor-wrap")).toBe("true");
  });

  test("bows the move off a straight line and eases to a stop", () => {
    document.body.innerHTML = "";
    const script = buildAgentCursorOverlayScript({
      action: "act",
      phase: "move",
      durationMs: 800,
      cursor: { x: 20, y: 40 }
    });
    expect(window.eval(script)).toBe(true);
    const host = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID) as HTMLElement & {
      __lyraMoveCursor?: (x: number, y: number) => Promise<void>;
    };
    expect(typeof host.__lyraMoveCursor).toBe("function");
    const samples: string[] = [];
    const queue: FrameRequestCallback[] = [];
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      queue.push(callback);
      return queue.length;
    }) as typeof window.requestAnimationFrame;
    void host.__lyraMoveCursor?.(220, 40);
    let now = performance.now();
    let guard = 0;
    while (queue.length > 0 && guard < 12) {
      const callback = queue.shift();
      now += 40;
      guard += 1;
      callback?.(now);
      samples.push(host.style.transform);
    }
    const bowed = samples.some((transform) => {
      const match = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(transform);
      if (match === null) return false;
      return Math.abs(Number(match[2]) - (40 - 5)) > 2;
    });
    expect(bowed).toBe(true);
    expect(samples[samples.length - 1]).toContain("214px, 35px");
  });

  test("plays one quick scale on the click down phase", () => {
    document.body.innerHTML = "";
    const script = buildAgentCursorOverlayScript({
      action: "act",
      phase: "down",
      durationMs: 800,
      cursor: { x: 24, y: 36 }
    });
    expect(script).toContain("lyra-agent-cursor-click");
    expect(script).toContain("scale(0.8)");
    expect(window.eval(script)).toBe(true);
    const sway = document.getElementById(LYRA_AGENT_PAGE_CURSOR_HOST_ID)
      ?.shadowRoot
      ?.querySelector("[data-lyra-agent-cursor-sway]");
    expect((sway as HTMLElement).style.animation).toContain("lyra-agent-cursor-click");
  });
});
