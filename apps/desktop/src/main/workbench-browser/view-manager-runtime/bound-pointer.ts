import { delay } from "./normalizers";
import { CHOICE_CONTROL_RUNTIME } from "./choice-control-runtime";

export type PointerOptions = {
  readonly modifiers?: readonly ("shift" | "control" | "alt" | "meta")[];
  readonly button?: "left" | "middle" | "right";
  readonly holdMs?: number;
  readonly position?: { readonly x: number; readonly y: number };
};
export const validatePointerOptions = (options: PointerOptions): void => {
  if (options.modifiers !== undefined && (!Array.isArray(options.modifiers) || options.modifiers.some(value => !["shift","control","alt","meta"].includes(value)))) throw new Error("Invalid pointer modifiers");
  if (options.button !== undefined && !["left","middle","right"].includes(options.button)) throw new Error("Invalid mouse button");
  if (options.holdMs !== undefined && (!Number.isInteger(options.holdMs) || options.holdMs < 0 || options.holdMs > 3000)) throw new Error("holdMs must be 0..3000");
  if (options.position !== undefined && (!options.position || [options.position.x, options.position.y].some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error("position must contain fractions from 0 to 1");
};
export const cdpPointerModifiers = (modifiers: readonly string[] = []): number =>
  (modifiers.includes("alt") ? 1 : 0) | (modifiers.includes("control") ? 2 : 0) | (modifiers.includes("meta") ? 4 : 0) | (modifiers.includes("shift") ? 8 : 0);

type Point = { readonly x: number; readonly y: number };
export class BoundPointerError extends Error {
  constructor(message: string, readonly reason = "unconfirmed") { super(message); }
  get nextAction(): string {
    if (this.reason === "disabled") return "Wait for targetEnabled on the same targetRef; do not click again while disabled.";
    if (this.reason === "moving") return "Retry the same targetRef once after motion settles.";
    if (this.reason === "covered") return "Inspect the blocking dialog or overlay with a focused map; resolve it before retrying this targetRef.";
    if (this.reason === "hidden") return "Reveal the containing section before retrying this targetRef.";
    return "Inspect the action outcome or current map before retrying; do not repeat a possibly delivered action.";
  }
}

// Capture actual Chromium events, not a synthetic DOM click or a snapshot box.
// The guard lives only during one gesture and expires even if its caller dies.
export const INSTALL_POINTER_GUARD = `function(token) {
  const node = this, store = globalThis.__lyraPointerGuards ??= new Map();
  const choices = ${CHOICE_CONTROL_RUNTIME};
  const nativeControl = node.tagName === 'LABEL' ? node.control : null;
  const localChoice = choices.inputOf(node);
  const forwardedControl = nativeControl && (!localChoice || localChoice === nativeControl) ? nativeControl : null;
  store.get(token)?.dispose();
  const state = { accepted: false, activated: false, blocked: false };
  let labelClick = null, forwardedEvent = null;
  const removers = [];
  const types = ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','auxclick','contextmenu'];
  const listen = (root, outer = false) => {
    const handler = event => {
      if (!event.isTrusted) return;
      const path = event.composedPath();
      const direct = !outer && (path.includes(node) || node.contains(path[0]));
      let matches = direct;
      // Chromium's default label activation emits a second trusted click on its
      // control. It is not an off-target pointer gesture. Bind to the
      // original native association and only accept it after this label's click;
      // never permit a changed for/id or an ambiguous structural association.
      if (!matches && !outer && event.type === 'click' && (event === forwardedEvent || labelClick && !labelClick.defaultPrevented
        && event.clientX === labelClick.clientX && event.clientY === labelClick.clientY && event.button === labelClick.button)
        && state.accepted && state.activated && !state.blocked
        && forwardedControl?.isConnected && node.control === forwardedControl && path[0] === forwardedControl
        && !forwardedControl.matches(':disabled') && !forwardedControl.closest('[aria-disabled=true],[inert]')) {
        matches = true; labelClick = null; forwardedEvent = event;
      } else if (direct && event.type === 'click' && forwardedControl && path[0] !== forwardedControl) labelClick = event;
      // Outside a closed shadow root the path contains only the host; the
      // inner listener checks the actual target before the event reaches it.
      for (let r = node.getRootNode(); !matches && !outer && r.host; r = r.host.getRootNode()) {
        if (r !== root && path.includes(r.host)) matches = true;
      }
      if (!matches || !node.isConnected || node.matches(':disabled') || node.closest('[aria-disabled="true"], [inert]')) {
        state.blocked = true; event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (event.type === 'pointerdown' || event.type === 'mousedown') state.accepted = true;
      if (['click','dblclick','auxclick','contextmenu'].includes(event.type)) state.activated = true;
    };
    for (const type of types) root.addEventListener(type, handler, true);
    removers.push(() => { for (const type of types) root.removeEventListener(type, handler, true); });
  };
  const view = node.ownerDocument.defaultView;
  listen(view);
  for (let root = node.getRootNode(); root.host; root = root.host.getRootNode()) listen(root);
  try { for (let parent = view; parent.frameElement;) { parent = parent.frameElement.ownerDocument.defaultView; listen(parent, true); } } catch (_) {}
  const timer = setTimeout(() => { for (const remove of removers) remove(); store.delete(token); }, 5000);
  store.set(token, { state, dispose: () => { clearTimeout(timer); for (const remove of removers) remove(); store.delete(token); } });
  return true;
}`;
export const FINISH_POINTER_GUARD = `function(token) {
  const entry = globalThis.__lyraPointerGuards?.get(token);
  if (!entry) return null;
  const state = entry.state; entry.dispose(); return state;
}`;
export type PointerReceipt = { accepted: boolean; activated: boolean; blocked: boolean };

// Only relocate before mouseDown. Once input may have reached the page, never
// replay a mutation automatically, including on navigation or a lost receipt.
export const dispatchBoundPointer = async (options: {
  options?: PointerOptions;
  prepare: () => Promise<Point | null>;
  send: (event: Electron.MouseInputEvent) => void | Promise<void>;
  interaction: "click" | "doubleClick" | "rightClick" | "hover";
  beforeMove?: (point: Point) => Promise<void>;
}): Promise<Point> => {
  const pointer = options.options ?? {};
  validatePointerOptions(pointer);
  if (options.interaction === "doubleClick" && (pointer.holdMs ?? 0) > 0) {
    throw new Error("holdMs applies to a single press; a long-held double click is not supported");
  }
  const modifiers = [...(pointer.modifiers ?? [])];
  let point = await options.prepare();
  if (!point) throw new BoundPointerError("Target is detached, disabled, moving, or covered. No activation was sent.");
  let stable = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    await options.beforeMove?.(point);
    await options.send({ type: "mouseMove", ...point, button: "left", clickCount: 1, modifiers });
    await delay(20);
    const current = await options.prepare();
    if (!current) throw new BoundPointerError("Target stopped receiving events before activation. No activation was sent.");
    stable = current.x === point.x && current.y === point.y;
    point = current;
    if (stable) break;
  }
  if (!stable) throw new BoundPointerError("Target kept moving. No activation was sent.");
  if (options.interaction === "hover") return point;
  const button = options.interaction === "rightClick" ? "right" : pointer.button ?? "left";
  for (const clickCount of options.interaction === "doubleClick" ? [1, 2] : [1]) {
    try {
      await options.send({ type: "mouseDown", ...point, button, clickCount, modifiers });
      await delay(pointer.holdMs ?? 20);
    } finally { await options.send({ type: "mouseUp", ...point, button, clickCount, modifiers }); }
    await delay(30);
  }
  return point;
};
