import type { BrowserAgentPageTarget } from "./types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { VisualPoint, VisualStep } from "./visual-scene-types";
import { cdpPointerModifiers } from "./bound-pointer";
import { browserKeyEvents } from "./agent-keyboard";
import { focusBrowserPageForInput } from "../workspace-focus-isolation";
import { delay } from "./normalizers";

type Host = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "openDebuggerSessionForTarget"
  | "sendAgentInputEvent"
  | "markSyntheticInput"
  | "assertSharedControlCanContinue"
>;
export const dispatchVisualGesture = async (
  host: Host,
  input: {
    tabId: string;
    target: BrowserAgentPageTarget;
    step: VisualStep;
    points: readonly VisualPoint[];
    check: () => Promise<void>;
    arm?: () => Promise<void>;
    accepted?: () => Promise<void>;
  },
) => {
  const { step, target, tabId } = input;
  await focusBrowserPageForInput(target.webContents);
  await input.check();
  const check = async () => {
    host.assertSharedControlCanContinue(tabId);
    await input.check();
  };
  const pause = async (ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      await delay(Math.min(25, until - Date.now()));
      await check();
    }
  };
  if (step.interaction === "press") {
    const events = browserKeyEvents(step.key!);
    try {
      for (const event of events)
        if (event.type !== "keyUp") {
          await check();
          host.sendAgentInputEvent(target, event);
        }
      await pause(step.holdMs ?? 0);
    } finally {
      for (const event of events)
        if (event.type === "keyUp") host.sendAgentInputEvent(target, event);
    }
    return;
  }
  const session = await host.openDebuggerSessionForTarget(target);
  let pressed = false,
    current = input.points[0]!;
  const button =
    step.interaction === "rightClick" ? "right" : (step.button ?? "left");
  const buttonMask = button === "right" ? 2 : button === "middle" ? 4 : 1;
  const modifiers = cdpPointerModifiers(step.modifiers);
  const send = async (
    type: string,
    point: VisualPoint = current,
    clickCount = 0,
  ) => {
    if (type !== "mouseReleased") await check();
    host.markSyntheticInput(tabId);
    current = point;
    await session.sendCommand("Input.dispatchMouseEvent", {
      type,
      ...point,
      button: pressed || type === "mouseReleased" ? button : "none",
      buttons: pressed ? buttonMask : 0,
      clickCount,
      modifiers,
    });
  };
  try {
    await send("mouseMoved");
    await pause(16);
    await input.arm?.();
    if (step.interaction === "hover") return;
    if (step.interaction === "scroll") {
      await check();
      host.markSyntheticInput(tabId);
      await session.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...current,
        deltaX: step.scrollDx ?? 0,
        deltaY: step.scrollDy ?? (step.scrollDx === undefined ? 480 : 0),
        modifiers,
      });
      return;
    }
    for (const count of step.interaction === "doubleClick" ? [1, 2] : [1]) {
      await check();
      pressed = true;
      await send("mousePressed", current, count);
      await input.accepted?.();
      await pause(step.holdMs ?? 0);
      if (step.interaction === "drag") {
        const duration = step.durationMs ?? 300,
          segments = input.points.length - 1;
        const started = performance.now();
        for (let i = 1; i <= segments; i++) {
          const from = input.points[i - 1]!,
            to = input.points[i]!;
          const ticks = Math.max(1, Math.ceil(duration / segments / 16));
          for (let tick = 1; tick <= ticks; tick++) {
            const due =
              started + (duration * (i - 1 + tick / ticks)) / segments;
            if (due > performance.now()) await pause(due - performance.now());
            await send("mouseMoved", {
              x: from.x + ((to.x - from.x) * tick) / ticks,
              y: from.y + ((to.y - from.y) * tick) / ticks,
            });
          }
        }
      }
      await check();
      await send("mouseReleased", current, count);
      pressed = false;
      if (step.interaction === "doubleClick" && count === 1) await pause(30);
    }
  } finally {
    // Cleanup bypasses cancellation/takeover checks. Never leave a held button.
    if (pressed) await send("mouseReleased", current, 1).catch(() => {});
    await session.close();
  }
};
