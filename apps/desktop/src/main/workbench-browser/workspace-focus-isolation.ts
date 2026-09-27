import type { BrowserWindow, WebContents } from "electron";
import { createWorkbenchBrowserSharedDebuggerSession } from "./debugger";
import type { WorkbenchBrowserDebuggerSession } from "./types";

export type WorkspaceFocusSurface = {
  readonly webContents: WebContents;
  readonly acquire: () => Promise<WorkbenchBrowserDebuggerSession>;
};

// Logical document focus is independent of the one native keyboard recipient.
// Agent input can address a retained document without stealing that recipient.
const retainedFocus = new WeakMap<WebContents, () => Promise<boolean>>();

export const focusBrowserPageForInput = async (contents: WebContents): Promise<void> => {
  if (await retainedFocus.get(contents)?.()) return;
  contents.focus();
};

type SurfaceState = WorkspaceFocusSurface & {
  desired: boolean;
  enabled: boolean;
  session: WorkbenchBrowserDebuggerSession | null;
  unsubscribe: (() => void) | null;
  pending: Promise<void> | null;
  warning: string | null;
  destroyed: () => void;
};

export const createWorkspaceFocusIsolation = ({
  onError = (error: unknown) => console.warn("[lyra-browser] workspace focus isolation unavailable", error)
}: { readonly onError?: (error: unknown) => void } = {}) => {
  const states = new Map<WebContents, SurfaceState>();
  let owner: BrowserWindow | null = null;
  let shell: WorkspaceFocusSurface | null = null;
  let visible: readonly WorkspaceFocusSurface[] = [];
  let disposed = false;

  const release = async (state: SurfaceState) => {
    const session = state.session;
    state.session = null;
    state.unsubscribe?.();
    state.unsubscribe = null;
    state.enabled = false;
    await session?.close();
  };

  const apply = (state: SurfaceState): Promise<void> => {
    if (state.pending) return state.pending;
    if (state.desired === state.enabled && (state.desired || !state.session)) return Promise.resolve();
    state.pending = (async () => {
      try {
        do {
          if (state.webContents.isDestroyed()) { await release(state); return; }
          if (state.desired) {
            if (!state.session) {
              state.session = await state.acquire();
              state.unsubscribe = state.session.subscribe(event => {
                if (event.kind === "detached") state.enabled = false;
              });
            }
            // Layout or window visibility may change while acquire is in flight.
            if (!state.desired) continue;
            await state.session.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
            state.enabled = true;
          } else {
            if (state.session && state.enabled) {
              await state.session.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: false });
            }
            await release(state);
          }
          state.warning = null;
        } while (state.desired !== state.enabled || (!state.desired && state.session));
      } catch (error) {
        await release(state).catch(() => undefined);
        const message = String(error);
        if (!state.webContents.isDestroyed() && state.warning !== message) {
          state.warning = message;
          onError(error);
        }
      }
    })().finally(() => { state.pending = null; });
    return state.pending;
  };

  const ensure = (surface: WorkspaceFocusSurface): SurfaceState => {
    const existing = states.get(surface.webContents);
    if (existing) return existing;
    const state: SurfaceState = {
      ...surface, desired: false, enabled: false, session: null,
      unsubscribe: null, pending: null, warning: null,
      destroyed: () => {
        state.desired = false;
        states.delete(state.webContents);
        retainedFocus.delete(state.webContents);
        void apply(state);
      }
    };
    states.set(surface.webContents, state);
    surface.webContents.once("destroyed", state.destroyed);
    retainedFocus.set(surface.webContents, async () => {
      await apply(state);
      return state.desired && state.enabled;
    });
    return state;
  };

  const refresh = async (): Promise<void> => {
    const active = !disposed && owner && !owner.isDestroyed()
      && owner.isVisible() && !owner.isMinimized() && owner.isFocused();
    const next = new Set<WebContents>();
    if (active && visible.length > 0) {
      for (const surface of [...visible, ...(shell ? [shell] : [])]) {
        if (surface.webContents.isDestroyed()) continue;
        ensure(surface);
        next.add(surface.webContents);
      }
    }
    for (const state of states.values()) state.desired = next.has(state.webContents);
    await Promise.all([...states.values()].map(apply));
  };

  // Never pin hidden tabs/windows as visible: focus emulation also affects the
  // Page Visibility API. Only retain documents belonging to the active window.
  const onWindowChanged = () => { void refresh(); };
  const bind = (window: BrowserWindow | null) => {
    if (owner === window) return;
    owner?.off("focus", onWindowChanged).off("blur", onWindowChanged)
      .off("show", onWindowChanged).off("hide", onWindowChanged)
      .off("minimize", onWindowChanged).off("restore", onWindowChanged)
      .off("closed", onWindowChanged);
    owner = window;
    shell = null;
    if (owner && !owner.isDestroyed()) {
      const contents = owner.webContents;
      const shared = createWorkbenchBrowserSharedDebuggerSession({
        tabId: "workbench-shell", webContents: contents, readPageAddress: () => contents.getURL()
      });
      shell = { webContents: contents, acquire: shared.acquire };
      owner.on("focus", onWindowChanged).on("blur", onWindowChanged)
        .on("show", onWindowChanged).on("hide", onWindowChanged)
        .on("minimize", onWindowChanged).on("restore", onWindowChanged)
        .on("closed", onWindowChanged);
    }
  };

  return {
    sync: async (window: BrowserWindow | null, surfaces: readonly WorkspaceFocusSurface[]) => {
      if (disposed) return;
      bind(window);
      visible = surfaces;
      await refresh();
    },
    dispose: async () => {
      disposed = true;
      bind(null);
      visible = [];
      await refresh();
      for (const state of states.values()) {
        state.webContents.off("destroyed", state.destroyed);
        retainedFocus.delete(state.webContents);
      }
      states.clear();
    }
  };
};
