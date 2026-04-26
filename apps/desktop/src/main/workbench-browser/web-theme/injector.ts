import type { WebContents } from "electron";

import {
  buildAreaRetintDisableScript,
  buildAreaRetintScript,
  buildAreaRetintUpdateScript
} from "./area-retint";
import { buildDarkReaderBootScript, buildDarkReaderDisableScript } from "./darkreader-source";
import { buildFallbackRemapCss, buildFallbackRemapScript } from "./fallback-remap";
import { buildShieldCss, buildShieldScript, SHIELD_STYLE_ID } from "./shield";
import {
  areSnapshotsEquivalent,
  DEFAULT_WEB_THEME_SNAPSHOT
} from "./theme-bridge";
import type { WebThemeSnapshot } from "./types";

const DEBUGGER_PROTOCOL_VERSION = "1.3";

const isInjectableUrl = (url: string): boolean => {
  if (typeof url !== "string" || url.length === 0) {
    return false;
  }
  if (url.startsWith("about:")) {
    return false;
  }
  if (url.startsWith("chrome-error://")) {
    return false;
  }
  if (url.startsWith("chrome-extension://")) {
    return false;
  }
  if (url.startsWith("devtools://")) {
    return false;
  }
  if (url === "about:blank") {
    return false;
  }
  return true;
};

type TabState = {
  readonly tabId: string;
  readonly webContents: WebContents;
  snapshotRevision: number;
  shieldScriptId: string | null;
  darkReaderScriptId: string | null;
  fallbackScriptId: string | null;
  areaRetintScriptId: string | null;
  cdpAttached: boolean;
  disposed: boolean;
};

export type WebThemeInjector = {
  /**
   * Register a new tab with the injector. The injector will attach to the
   * `webContents`, install pre-paint scripts, and manage updates through
   * {@link updateSnapshot}.
   */
  readonly attach: (tabId: string, webContents: WebContents) => void;
  /**
   * Remove a previously attached tab. Safe to call multiple times or with an
   * unknown tabId.
   */
  readonly detach: (tabId: string) => void;
  /**
   * Push a new snapshot. Pre-paint scripts on new tabs will automatically use
   * it; existing tabs get a runtime update if possible.
   */
  readonly updateSnapshot: (snapshot: WebThemeSnapshot) => Promise<void>;
  /**
   * Returns the currently held snapshot. Mostly used by tests.
   */
  readonly readCurrentSnapshot: () => WebThemeSnapshot;
  /**
   * Drop all per-tab state. Idempotent.
   */
  readonly dispose: () => void;
};

export type CreateWebThemeInjectorOptions = {
  /**
   * Logger used when an individual stage falls through to its fallback path.
   * Intentionally optional so consumers don't have to plumb anything to use
   * the injector.
   */
  readonly onStageFallback?: (info: {
    readonly tabId: string;
    readonly stage: "shield" | "darkreader" | "fallback" | "area-retint";
    readonly cause: unknown;
  }) => void;
};

export const createWebThemeInjector = (
  options: CreateWebThemeInjectorOptions = {}
): WebThemeInjector => {
  const tabs = new Map<string, TabState>();
  let currentSnapshot: WebThemeSnapshot = DEFAULT_WEB_THEME_SNAPSHOT;

  const logFallback = (
    tabId: string,
    stage: "shield" | "darkreader" | "fallback" | "area-retint",
    cause: unknown
  ): void => {
    try {
      options.onStageFallback?.({ tabId, stage, cause });
    } catch {
      // Logger must never throw back at us.
    }
  };

  const ensureCdpAttached = async (state: TabState): Promise<boolean> => {
    if (state.cdpAttached) {
      return true;
    }
    if (state.webContents.isDestroyed()) {
      return false;
    }
    try {
      if (state.webContents.debugger.isAttached()) {
        state.cdpAttached = true;
        return true;
      }
      state.webContents.debugger.attach(DEBUGGER_PROTOCOL_VERSION);
      state.cdpAttached = true;
      return true;
    } catch (error) {
      logFallback(state.tabId, "shield", error);
      return false;
    }
  };

  const sendCdp = async (
    state: TabState,
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> => {
    const attached = await ensureCdpAttached(state);
    if (attached === false) {
      return null;
    }
    try {
      const response = await state.webContents.debugger.sendCommand(method, params);
      if (response !== null && typeof response === "object" && !Array.isArray(response)) {
        return response as Record<string, unknown>;
      }
      return {};
    } catch {
      return null;
    }
  };

  const addDocumentScript = async (
    state: TabState,
    source: string
  ): Promise<string | null> => {
    const response = await sendCdp(state, "Page.addScriptToEvaluateOnNewDocument", {
      source,
      runImmediately: true
    });
    if (response === null) {
      return null;
    }
    const identifier = response.identifier;
    if (typeof identifier !== "string" || identifier.length === 0) {
      return null;
    }
    return identifier;
  };

  const removeDocumentScript = async (
    state: TabState,
    scriptId: string | null
  ): Promise<void> => {
    if (scriptId === null) {
      return;
    }
    await sendCdp(state, "Page.removeScriptToEvaluateOnNewDocument", {
      identifier: scriptId
    });
  };

  const insertCssFallback = async (
    state: TabState,
    css: string
  ): Promise<void> => {
    if (state.webContents.isDestroyed()) {
      return;
    }
    try {
      await state.webContents.insertCSS(css, { cssOrigin: "user" });
    } catch (error) {
      logFallback(state.tabId, "shield", error);
    }
  };

  const installStagesForTab = async (
    state: TabState,
    snapshot: WebThemeSnapshot
  ): Promise<void> => {
    if (state.disposed) {
      return;
    }
    if (snapshot.enabled === false) {
      await removeDocumentScript(state, state.shieldScriptId);
      await removeDocumentScript(state, state.darkReaderScriptId);
      await removeDocumentScript(state, state.fallbackScriptId);
      await removeDocumentScript(state, state.areaRetintScriptId);
      state.shieldScriptId = null;
      state.darkReaderScriptId = null;
      state.fallbackScriptId = null;
      state.areaRetintScriptId = null;
      return;
    }
    const shieldSource = buildShieldScript({ snapshot });
    const fallbackSource = buildFallbackRemapScript({ snapshot });
    const areaRetintSource = buildAreaRetintScript({ snapshot });
    let darkReaderSource: string | null = null;
    try {
      darkReaderSource = buildDarkReaderBootScript(snapshot);
    } catch (error) {
      logFallback(state.tabId, "darkreader", error);
    }

    const cdpOk = await ensureCdpAttached(state);

    // Replace previous stage scripts (they run only once-per-document, so we
    // need fresh copies when the palette changes).
    await removeDocumentScript(state, state.shieldScriptId);
    await removeDocumentScript(state, state.darkReaderScriptId);
    await removeDocumentScript(state, state.fallbackScriptId);
    await removeDocumentScript(state, state.areaRetintScriptId);

    if (cdpOk === false) {
      // Cascading fallback: no CDP -> insertCSS path for shield + fallback.
      await insertCssFallback(state, buildShieldCss({ snapshot }));
      await insertCssFallback(state, buildFallbackRemapCss({ snapshot }));
      return;
    }

    state.shieldScriptId = await addDocumentScript(state, shieldSource);
    if (state.shieldScriptId === null) {
      await insertCssFallback(state, buildShieldCss({ snapshot }));
      logFallback(state.tabId, "shield", "addScriptToEvaluateOnNewDocument returned null");
    }

    if (darkReaderSource !== null) {
      state.darkReaderScriptId = await addDocumentScript(state, darkReaderSource);
      if (state.darkReaderScriptId === null) {
        logFallback(state.tabId, "darkreader", "addScriptToEvaluateOnNewDocument returned null");
      }
    }

    state.fallbackScriptId = await addDocumentScript(state, fallbackSource);
    if (state.fallbackScriptId === null) {
      await insertCssFallback(state, buildFallbackRemapCss({ snapshot }));
      logFallback(state.tabId, "fallback", "addScriptToEvaluateOnNewDocument returned null");
    }

    state.areaRetintScriptId = await addDocumentScript(state, areaRetintSource);
    if (state.areaRetintScriptId === null) {
      logFallback(
        state.tabId,
        "area-retint",
        "addScriptToEvaluateOnNewDocument returned null"
      );
    }

    state.snapshotRevision = snapshot.revision;
  };

  const hotSwapSnapshotForTab = async (
    state: TabState,
    snapshot: WebThemeSnapshot
  ): Promise<void> => {
    if (state.disposed || state.webContents.isDestroyed()) {
      return;
    }
    const currentUrl = state.webContents.getURL();
    if (isInjectableUrl(currentUrl) === false) {
      return;
    }
    if (snapshot.enabled === false) {
      try {
        await state.webContents.executeJavaScript(buildDarkReaderDisableScript(), true);
      } catch (error) {
        logFallback(state.tabId, "darkreader", error);
      }
      try {
        await state.webContents.executeJavaScript(buildAreaRetintDisableScript(), true);
      } catch (error) {
        logFallback(state.tabId, "area-retint", error);
      }
      try {
        await state.webContents.executeJavaScript(
          `(() => {
            const shield = document.getElementById(${JSON.stringify(SHIELD_STYLE_ID)});
            if (shield && shield.parentNode) { shield.parentNode.removeChild(shield); }
          })();`,
          true
        );
      } catch {
        // Non-fatal; next navigation will no-op.
      }
      return;
    }
    try {
      const payload = JSON.stringify(snapshot);
      await state.webContents.executeJavaScript(
        `(() => {
          try {
            if (typeof window.__lyraWebThemeUpdate === "function") {
              window.__lyraWebThemeUpdate(${payload});
            }
          } catch (_err) {}
        })();`,
        true
      );
    } catch (error) {
      logFallback(state.tabId, "darkreader", error);
    }
    try {
      await state.webContents.executeJavaScript(
        buildAreaRetintUpdateScript(snapshot),
        true
      );
    } catch (error) {
      logFallback(state.tabId, "area-retint", error);
    }
  };

  const disposeTabState = (state: TabState): void => {
    if (state.disposed) {
      return;
    }
    state.disposed = true;
    if (state.cdpAttached && state.webContents.isDestroyed() === false) {
      try {
        if (state.webContents.debugger.isAttached()) {
          state.webContents.debugger.detach();
        }
      } catch {
        // detach failures are safe to ignore during teardown.
      }
    }
    state.cdpAttached = false;
  };

  return {
    attach: (tabId, webContents) => {
      if (tabs.has(tabId)) {
        return;
      }
      const state: TabState = {
        tabId,
        webContents,
        snapshotRevision: -1,
        shieldScriptId: null,
        darkReaderScriptId: null,
        fallbackScriptId: null,
        areaRetintScriptId: null,
        cdpAttached: false,
        disposed: false
      };
      tabs.set(tabId, state);
      void installStagesForTab(state, currentSnapshot);
    },
    detach: (tabId) => {
      const state = tabs.get(tabId);
      if (state === undefined) {
        return;
      }
      tabs.delete(tabId);
      disposeTabState(state);
    },
    updateSnapshot: async (snapshot) => {
      if (areSnapshotsEquivalent(snapshot, currentSnapshot)) {
        currentSnapshot = { ...snapshot, revision: currentSnapshot.revision };
        return;
      }
      currentSnapshot = snapshot;
      const tasks: Promise<void>[] = [];
      for (const state of tabs.values()) {
        if (state.disposed) {
          continue;
        }
        tasks.push(
          (async () => {
            await installStagesForTab(state, snapshot);
            await hotSwapSnapshotForTab(state, snapshot);
          })()
        );
      }
      await Promise.allSettled(tasks);
    },
    readCurrentSnapshot: () => currentSnapshot,
    dispose: () => {
      for (const state of tabs.values()) {
        disposeTabState(state);
      }
      tabs.clear();
    }
  };
};
