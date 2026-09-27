import { describe, expect, test } from "vitest";

import { activateStampedSurfaceScript } from "../view-manager-runtime/surface-control-names";

describe("activateStampedSurfaceScript", () => {
  test("prepares a hit-tested point without dispatching synthetic events", async () => {
    const shell = document.createElement("div");
    shell.setAttribute("data-lyra-surface", "lumen:settings");
    shell.textContent = "Settings";
    const chat = document.createElement("a");
    chat.href = "/chat";
    chat.textContent = "Agent工具开发建议";
    shell.append(chat);
    document.body.append(shell);
    shell.getBoundingClientRect = () => ({
      x: 12, y: 40, width: 180, height: 32,
      top: 40, left: 12, right: 192, bottom: 72, toJSON() { return this; }
    }) as DOMRect;
    const clicks: string[] = [];
    shell.addEventListener("click", () => clicks.push("settings"));
    chat.addEventListener("click", () => clicks.push("chat"));
    const originalHit = document.elementFromPoint;
    document.elementFromPoint = () => chat;
    const result = await window.eval(activateStampedSurfaceScript("lumen:settings")) as { width: number; trusted: boolean } | null;
    expect(result?.width).toBeGreaterThan(0);
    expect(result?.trusted).toBe(true);
    expect(clicks).toEqual([]);
    document.elementFromPoint = originalHit;
    document.body.replaceChildren();
  });
});
