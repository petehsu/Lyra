import {
  ipcMain,
  type BrowserWindow,
  type Session,
  type WebContents
} from "electron";

import {
  LYRA_CHANNELS,
  type LoginManagerClearSiteRequest,
  type LoginManagerClearSiteResponse,
  type LoginManagerDeleteCredentialRequest,
  type LoginManagerEvent,
  type LoginManagerFillCredentialRequest,
  type LoginManagerFillCredentialResponse,
  type LoginManagerRevealCredentialRequest,
  type LoginManagerRevealCredentialResponse,
  type LoginManagerSnapshot,
  type LoginManagerUpdateSessionRequest
} from "../../shared/desktop-bridge";
import {
  createLoginManagerFaviconCache,
  readPageFaviconUrl,
  normalizeFaviconUrl,
  fallbackFaviconUrl
} from "./favicon-cache";
import {
  buildFillScript,
  buildObserverScript,
  parseBridgePayload
} from "./page-scripts";
import { createLoginManagerPasswordVault } from "./password-vault";
import { clearSiteData } from "./site-data";
import {
  createLoginManagerSessionModel,
  hostnameFromOrigin,
  inferAuthProvider,
  normalizeOrigin,
  normalizeString
} from "./session-model";
import {
  readLoginManagerStore,
  writeLoginManagerStore,
  type StoredCredential
} from "./store";

type AttachedTab = {
  readonly tabId: string;
  readonly webContents: WebContents;
};

export type LoginManagerIpcBridge = {
  readonly dispose: () => void;
  readonly attachWebContents: (tabId: string, webContents: WebContents) => () => void;
  readonly list: () => LoginManagerSnapshot;
  readonly setCredentialCaptureEnabled: (enabled: boolean) => LoginManagerSnapshot;
  readonly updateSession: (request: LoginManagerUpdateSessionRequest) => LoginManagerSnapshot;
  readonly deleteCredential: (request: LoginManagerDeleteCredentialRequest) => LoginManagerSnapshot;
  readonly revealCredential: (
    request: LoginManagerRevealCredentialRequest
  ) => LoginManagerRevealCredentialResponse;
  readonly fillCredential: (
    request: LoginManagerFillCredentialRequest
  ) => Promise<LoginManagerFillCredentialResponse>;
  readonly clearSite: (
    request: LoginManagerClearSiteRequest
  ) => Promise<LoginManagerClearSiteResponse>;
};

export const createLoginManagerIpcBridge = ({
  storageRoot,
  getWindow
}: {
  readonly storageRoot: string;
  readonly getWindow: () => BrowserWindow | null;
}): LoginManagerIpcBridge => {
  const attachedTabs = new Map<string, AttachedTab>();
  const electronSessions = new Set<Session>();
  const activeOriginByTab = new Map<string, string>();

  let publishSnapshot = (): void => undefined;
  const passwordVault = createLoginManagerPasswordVault();
  const faviconCache = createLoginManagerFaviconCache({
    storageRoot,
    onCacheUpdated: () => {
      publishSnapshot();
    }
  });
  const sessionModel = createLoginManagerSessionModel({
    storageRoot,
    initialStore: readLoginManagerStore(storageRoot),
    saveStore: (store) => {
      writeLoginManagerStore(storageRoot, store);
    },
    passwordVault,
    faviconCache
  });

  const snapshot = (): LoginManagerSnapshot => sessionModel.snapshot();

  publishSnapshot = (): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    const event: LoginManagerEvent = {
      kind: "snapshot",
      snapshot: snapshot()
    };
    window.webContents.send(LYRA_CHANNELS.loginManagerEvent, event);
  };

  const observePage = async (
    tabId: string,
    webContents: WebContents,
    url = webContents.getURL()
  ): Promise<void> => {
    const origin = normalizeOrigin(url);
    if (origin === null || webContents.isDestroyed()) {
      return;
    }
    const previousOrigin = activeOriginByTab.get(tabId);
    const authHint = inferAuthProvider(url);
    if (authHint !== null && previousOrigin !== undefined && previousOrigin !== origin) {
      sessionModel.upsertSession(previousOrigin, {
        authMethod: authHint,
        signals: { oauthHint: authHint.label }
      });
    }
    activeOriginByTab.set(tabId, origin);

    const cookieCount = await webContents.session.cookies
      .get({ url: origin })
      .then((cookies) => cookies.length)
      .catch(() => 0);
    const storageObserved = await webContents.executeJavaScript(
      `(() => {
        try {
          return Boolean(
            (window.localStorage && window.localStorage.length > 0)
            || (window.sessionStorage && window.sessionStorage.length > 0)
          );
        } catch (_error) {
          return false;
        }
      })()`,
      true
    ).then((value) => value === true).catch(() => false);

    const pageFaviconUrl = await readPageFaviconUrl(webContents, origin);
    if (pageFaviconUrl !== null) {
      sessionModel.setFaviconForOrigin(origin, pageFaviconUrl);
      faviconCache.queue(origin, pageFaviconUrl, webContents.session);
    }
    const pageTitle = normalizeString(webContents.getTitle());
    const faviconUrl = pageFaviconUrl
      ?? normalizeFaviconUrl(snapshot().sessions.find((entry) => entry.origin === origin)?.faviconUrl, origin)
      ?? fallbackFaviconUrl(origin)
      ?? undefined;
    sessionModel.upsertSession(origin, {
      address: url,
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      ...(pageTitle === null ? {} : { title: pageTitle }),
      signals: {
        cookieCount,
        storageObserved
      }
    });
    publishSnapshot();
  };

  const injectObserver = (webContents: WebContents): void => {
    if (webContents.isDestroyed()) {
      return;
    }
    const origin = normalizeOrigin(webContents.getURL());
    if (origin === null) {
      return;
    }
    if (sessionModel.isCredentialCaptureEnabled() === false) {
      return;
    }
    const credentials = sessionModel.fillSuggestionsForOrigin(origin);
    void webContents.executeJavaScript(buildObserverScript(credentials), true)
      .catch(() => undefined);
  };

  const findCredentialForFill = (
    request: LoginManagerFillCredentialRequest
  ): StoredCredential | null => sessionModel.findCredentialForFill(request);

  const findTabForFill = (
    request: LoginManagerFillCredentialRequest,
    credential: StoredCredential
  ): AttachedTab | null => {
    const tabId = normalizeString(request.tabId);
    if (tabId !== null) {
      return attachedTabs.get(tabId) ?? null;
    }
    for (const entry of attachedTabs.values()) {
      if (normalizeOrigin(entry.webContents.getURL()) === credential.origin) {
        return entry;
      }
    }
    return null;
  };

  const fillCredential = async (
    request: LoginManagerFillCredentialRequest
  ): Promise<LoginManagerFillCredentialResponse> => {
    const credential = findCredentialForFill(request);
    if (credential === null || credential.passwordCiphertextBase64 === undefined) {
      return {
        filled: false,
        message: "No available saved credential matched the request."
      };
    }
    const tab = findTabForFill(request, credential);
    if (tab === null || tab.webContents.isDestroyed()) {
      return {
        filled: false,
        origin: credential.origin,
        username: credential.username,
        message: "No matching Lyra browser tab is available for filling."
      };
    }
    const password = passwordVault.decryptPassword(credential.passwordCiphertextBase64);
    const result = await tab.webContents.executeJavaScript(
      buildFillScript(credential.username, password),
      true
    ).catch((error: unknown) => ({
      filled: false,
      reason: error instanceof Error ? error.message : String(error)
    }));
    const filled =
      result !== null
      && typeof result === "object"
      && (result as { readonly filled?: unknown }).filled === true;
    if (filled) {
      sessionModel.markCredentialUsed(credential.id);
      publishSnapshot();
    }
    return {
      filled,
      tabId: tab.tabId,
      origin: credential.origin,
      username: credential.username,
      ...(filled ? {} : { message: "Login form was not found on the current page." })
    };
  };

  const clearSite = async (
    request: LoginManagerClearSiteRequest
  ): Promise<LoginManagerClearSiteResponse> => {
    const origin = sessionModel.resolveClearOrigin(request);
    const { cookiesRemoved, storageCleared } = await clearSiteData(
      origin,
      electronSessions.size > 0 ? [...electronSessions] : []
    );
    sessionModel.markSiteCleared(origin);
    publishSnapshot();
    return {
      cleared: true,
      origin,
      hostname: hostnameFromOrigin(origin),
      cookiesRemoved,
      storageCleared
    };
  };

  const updateSession = (
    request: LoginManagerUpdateSessionRequest
  ): LoginManagerSnapshot => {
    const result = sessionModel.updateSession(request);
    publishSnapshot();
    return result;
  };

  const deleteCredential = (
    request: LoginManagerDeleteCredentialRequest
  ): LoginManagerSnapshot => {
    const result = sessionModel.deleteCredential(request);
    publishSnapshot();
    return result;
  };

  const revealCredential = (
    request: LoginManagerRevealCredentialRequest
  ): LoginManagerRevealCredentialResponse => sessionModel.revealCredential(request);

  const setCredentialCaptureEnabled = (enabled: boolean): LoginManagerSnapshot => {
    const result = sessionModel.setCredentialCaptureEnabled(enabled);
    if (enabled) {
      for (const tab of attachedTabs.values()) {
        injectObserver(tab.webContents);
      }
    }
    publishSnapshot();
    return result;
  };

  const attachWebContents = (tabId: string, webContents: WebContents): (() => void) => {
    attachedTabs.set(tabId, { tabId, webContents });
    electronSessions.add(webContents.session);

    const onNavigate = (_event: unknown, url: string): void => {
      void observePage(tabId, webContents, url).finally(() => {
        injectObserver(webContents);
      });
    };
    const onStopLoading = (): void => {
      void observePage(tabId, webContents).finally(() => {
        injectObserver(webContents);
      });
    };
    const onFaviconUpdated = (_event: unknown, favicons: readonly unknown[]): void => {
      const origin = normalizeOrigin(webContents.getURL());
      if (origin === null) {
        return;
      }
      const faviconUrl = favicons
        .map((candidate) => normalizeFaviconUrl(candidate, origin))
        .find((candidate): candidate is string => candidate !== null);
      if (faviconUrl === undefined) {
        return;
      }
      sessionModel.setFaviconForOrigin(origin, faviconUrl);
      sessionModel.updateCredentialFaviconsForOrigin(origin, faviconUrl);
      faviconCache.queue(origin, faviconUrl, webContents.session);
      const pageTitle = normalizeString(webContents.getTitle());
      sessionModel.upsertSession(origin, {
        address: webContents.getURL(),
        faviconUrl,
        ...(pageTitle === null ? {} : { title: pageTitle })
      });
      publishSnapshot();
    };
    const onConsoleMessage = (_event: unknown, _level: unknown, message: string): void => {
      const payload = parseBridgePayload(message);
      if (payload === null) {
        return;
      }
      if (payload.type === "credential-submit") {
        if (sessionModel.isCredentialCaptureEnabled() === false) {
          return;
        }
        if (sessionModel.recordCredentialSubmit(payload, webContents.getURL(), webContents.session)) {
          injectObserver(webContents);
          publishSnapshot();
        }
        return;
      }
      void fillCredential({
        credentialId: payload.credentialId,
        tabId
      }).catch(() => undefined);
    };

    webContents.on("did-navigate", onNavigate);
    webContents.on("did-navigate-in-page", onNavigate);
    webContents.on("did-stop-loading", onStopLoading);
    webContents.on("dom-ready", onStopLoading);
    webContents.on("page-favicon-updated", onFaviconUpdated);
    webContents.on("console-message", onConsoleMessage);

    return () => {
      attachedTabs.delete(tabId);
      activeOriginByTab.delete(tabId);
      if (webContents.isDestroyed() === false) {
        webContents.off("did-navigate", onNavigate);
        webContents.off("did-navigate-in-page", onNavigate);
        webContents.off("did-stop-loading", onStopLoading);
        webContents.off("dom-ready", onStopLoading);
        webContents.off("page-favicon-updated", onFaviconUpdated);
        webContents.off("console-message", onConsoleMessage);
      }
    };
  };

  ipcMain.handle(LYRA_CHANNELS.loginManagerList, () => snapshot());
  ipcMain.handle(
    LYRA_CHANNELS.loginManagerSetCredentialCaptureEnabled,
    (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean") {
        throw new Error("credential capture enabled must be a boolean");
      }
      return setCredentialCaptureEnabled(enabled);
    }
  );
  ipcMain.handle(LYRA_CHANNELS.loginManagerUpdateSession, (_event, request: unknown) =>
    updateSession(request as LoginManagerUpdateSessionRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerDeleteCredential, (_event, request: unknown) =>
    deleteCredential(request as LoginManagerDeleteCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerRevealCredential, (_event, request: unknown) =>
    revealCredential(request as LoginManagerRevealCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerFillCredential, async (_event, request: unknown) =>
    await fillCredential(request as LoginManagerFillCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerClearSite, async (_event, request: unknown) =>
    await clearSite(request as LoginManagerClearSiteRequest));

  sessionModel.warmFavicons();

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerList);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerSetCredentialCaptureEnabled);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerUpdateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerDeleteCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerRevealCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerFillCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerClearSite);
      attachedTabs.clear();
      electronSessions.clear();
      activeOriginByTab.clear();
      faviconCache.clearInFlight();
    },
    attachWebContents,
    list: snapshot,
    setCredentialCaptureEnabled,
    updateSession,
    deleteCredential,
    revealCredential,
    fillCredential,
    clearSite
  };
};
