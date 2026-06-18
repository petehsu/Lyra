import type { BrowserHealthAlert, BrowserHealthWatchdogKind } from "../types";

export type { BrowserHealthAlert, BrowserHealthWatchdogKind };

export type BrowserHealthSnapshot = {
  readonly alerts: readonly BrowserHealthAlert[];
  readonly activeKinds: readonly BrowserHealthWatchdogKind[];
};

const MAX_ALERTS_PER_TAB = 24;

export const createBrowserHealthWatchdog = () => {
  const alertsByTab = new Map<string, BrowserHealthAlert[]>();

  const recordAlert = (
    tabId: string,
    alert: Omit<BrowserHealthAlert, "at"> & { readonly at?: number }
  ): void => {
    const existing = alertsByTab.get(tabId) ?? [];
    const next: BrowserHealthAlert = {
      kind: alert.kind,
      severity: alert.severity,
      message: alert.message,
      at: alert.at ?? Date.now()
    };
    existing.push(next);
    if (existing.length > MAX_ALERTS_PER_TAB) {
      existing.splice(0, existing.length - MAX_ALERTS_PER_TAB);
    }
    alertsByTab.set(tabId, existing);
  };

  const consumeAlerts = (tabId: string): readonly BrowserHealthAlert[] => {
    const existing = alertsByTab.get(tabId) ?? [];
    alertsByTab.delete(tabId);
    return existing;
  };

  const readSnapshot = (tabId: string): BrowserHealthSnapshot => {
    const alerts = alertsByTab.get(tabId) ?? [];
    return {
      alerts,
      activeKinds: [...new Set(alerts.map((alert) => alert.kind))]
    };
  };

  const clearTab = (tabId: string): void => {
    alertsByTab.delete(tabId);
  };

  return {
    clearTab,
    consumeAlerts,
    readSnapshot,
    onCaptchaDetected: (tabId: string, label: string): void => {
      recordAlert(tabId, {
        kind: "captcha",
        severity: "warning",
        message: `Captcha challenge detected (${label}). Agent actions are blocked until the user completes it.`
      });
    },
    onCrash: (tabId: string): void => {
      recordAlert(tabId, {
        kind: "crash",
        severity: "error",
        message: "Browser render process crashed; page must be reloaded before agent actions can continue."
      });
    },
    onDomCacheInvalidated: (
      tabId: string,
      reason: "navigation" | "frameReload"
    ): void => {
      recordAlert(tabId, {
        kind: "dom_cache",
        severity: "info",
        message: `DOM observation cache invalidated after ${reason}.`
      });
    },
    onDownloadStarted: (tabId: string, url: string): void => {
      recordAlert(tabId, {
        kind: "download",
        severity: "info",
        message: `Download started: ${url}`
      });
    },
    onNavigationFailed: (tabId: string, message: string): void => {
      recordAlert(tabId, {
        kind: "crash",
        severity: "error",
        message: `Navigation failed: ${message}`
      });
    },
    onPermissionPrompt: (tabId: string, kind: string): void => {
      recordAlert(tabId, {
        kind: "permission",
        severity: "warning",
        message: `Permission prompt detected (${kind}). User approval may be required.`
      });
    },
    onPopupRequested: (tabId: string, url: string): void => {
      recordAlert(tabId, {
        kind: "popup",
        severity: "warning",
        message: `Popup or new-tab request intercepted: ${url}`
      });
    }
  };
};

export type BrowserHealthWatchdog = ReturnType<typeof createBrowserHealthWatchdog>;

export const browserHealthWarningsFromAlerts = (
  alerts: readonly BrowserHealthAlert[]
): readonly string[] =>
  alerts.map((alert) => `browser_health:${alert.kind}:${alert.message}`);