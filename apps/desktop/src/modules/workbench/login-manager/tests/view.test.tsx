import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type {
  LoginManagerSnapshot,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import { createTranslator } from "../../i18n";
import { useWorkbenchLabels } from "../../shell/use-workbench-labels";
import { LoginManagerSurface } from "../view";

const createLabels = () => {
  const { result } = renderHook(() => useWorkbenchLabels(createTranslator("en-US")));
  return result.current.loginManager;
};

const createSnapshot = (): LoginManagerSnapshot => ({
  version: 1,
  generatedAt: "2026-05-31T00:00:00.000Z",
  storageRoot: "/Users/tester/.lyra/modules/login-manager",
  credentialCaptureEnabled: false,
  passwordsAvailable: true,
  sessions: [
    {
      id: "https://example.com",
      origin: "https://example.com",
      hostname: "example.com",
      faviconUrl: "https://example.com/favicon.ico",
      title: "Example",
      address: "https://example.com/login",
      status: "observed",
      accountHint: "alice@example.com",
      notes: "team account",
      authMethod: {
        kind: "password",
        label: "Password",
        source: "observed",
        confidence: 1
      },
      authMethodSource: "observed",
      signals: {
        cookieCount: 2,
        storageObserved: true,
        formSubmitted: true
      },
      credentialIds: ["credential-example"],
      firstSeenAt: "2026-05-31T00:00:00.000Z",
      lastSeenAt: "2026-05-31T00:01:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z"
    }
  ],
  credentials: [
    {
      id: "credential-example",
      origin: "https://example.com",
      hostname: "example.com",
      faviconUrl: "https://example.com/favicon.ico",
      username: "alice@example.com",
      authMethod: {
        kind: "password",
        label: "Password",
        source: "observed",
        confidence: 1
      },
      hasPassword: true,
      passwordAvailable: true,
      createdAt: "2026-05-31T00:00:00.000Z",
      updatedAt: "2026-05-31T00:01:00.000Z"
    }
  ]
});

const createDesktopApi = (snapshot = createSnapshot()) => {
  const list = vi.fn(async () => snapshot);
  const updateSession = vi.fn(async () => ({
    ...snapshot,
    sessions: snapshot.sessions.map((session) => ({
      ...session,
      authMethod: {
        kind: "oauth" as const,
        label: "OAuth",
        source: "manual" as const,
        confidence: 1
      },
      authMethodSource: "manual" as const
    }))
  }));
  const deleteCredential = vi.fn(async () => ({
    ...snapshot,
    credentials: []
  }));
  const revealCredential = vi.fn(async () => ({
    credentialId: "credential-example",
    username: "alice@example.com",
    password: "super-secret-password"
  }));
  const fillCredential = vi.fn(async () => ({
    filled: true,
    origin: "https://example.com",
    username: "alice@example.com"
  }));
  const clearSite = vi.fn(async () => ({
    cleared: true,
    origin: "https://example.com",
    hostname: "example.com",
    cookiesRemoved: 2,
    storageCleared: true
  }));
  const clearSiteData = vi.fn(async () => ({
    ok: true,
    origin: "https://example.com",
    profilePartitions: ["persist:lyra-browser-live"],
    cookiesRemoved: 2,
    storageCleared: true,
    snapshot: {
      schemaVersion: 1,
      snapshotId: "browser-session-cleared",
      capturedAt: 100,
      activeTabId: "browser-tab-1",
      layout: {
        windowWidth: 0,
        windowHeight: 0,
        layouts: []
      },
      tabs: [
        {
          tabId: "browser-tab-1",
          address: "https://example.com/login",
          title: "Example",
          isActive: true,
          canGoBack: false,
          canGoForward: false,
          profilePartition: "persist:lyra-browser-live",
          restoreState: {
            capturedAt: 100,
            storage: {
              origin: "https://example.com",
              cookieCount: 0,
              localStorage: "unavailable",
              sessionStorage: "unavailable",
              indexedDB: "unavailable",
              capturedAt: 100
            }
          }
        }
      ],
      storageState: {
        schemaVersion: 1,
        profileId: "lyra-browser-live",
        profileMode: "live",
        profilePartition: "persist:lyra-browser-live",
        persistence: "chromium-profile"
      },
      migrations: []
    }
  }));
  return {
    api: {
      loginManager: {
        list,
        updateSession,
        deleteCredential,
        revealCredential,
        fillCredential,
        clearSite,
        onEvent: vi.fn(() => vi.fn())
      },
      workbenchBrowser: {
        clearSiteData
      }
    } as unknown as LyraDesktopApi,
    list,
    updateSession,
    deleteCredential,
    revealCredential,
    fillCredential,
    clearSite,
    clearSiteData
  };
};

describe("LoginManagerSurface", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => undefined)
      }
    });
  });

  test("lists sessions and lets users edit login method or clear a site", async () => {
    const { api, updateSession, clearSite, clearSiteData } = createDesktopApi();
    const onOpenSite = vi.fn();
    render(
      <LoginManagerSurface
        desktopApi={api}
        labels={createLabels()}
        onOpenSite={onOpenSite}
      />
    );

    expect(await screen.findAllByText("example.com")).not.toHaveLength(0);
    expect(
      document.querySelectorAll(".lyra-login-manager-site-favicon[src='https://example.com/favicon.ico']")
    ).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Open site" }));
    expect(onOpenSite).toHaveBeenCalledWith("https://example.com/login", "Example");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Login method" }));
    fireEvent.click(screen.getByRole("option", { name: "OAuth" }));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "manual GitHub login" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(updateSession).toHaveBeenCalledWith({
        sessionId: "https://example.com",
        accountHint: "alice@example.com",
        notes: "manual GitHub login",
        authMethod: {
          kind: "oauth",
          label: "OAuth",
          source: "manual",
          confidence: 1
        }
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Log out site" }));
    await waitFor(() => {
      expect(clearSite).toHaveBeenCalledWith({
        sessionId: "https://example.com"
      });
    });
    await waitFor(() => {
      expect(clearSiteData).toHaveBeenCalledWith({
        origin: "https://example.com"
      });
    });
  });

  test("renders embedded login management as action rows without a detail pane", async () => {
    const { api, clearSite, clearSiteData } = createDesktopApi();
    const onOpenSite = vi.fn();
    render(
      <LoginManagerSurface
        desktopApi={api}
        labels={createLabels()}
        onOpenSite={onOpenSite}
        embedded
      />
    );

    expect(await screen.findAllByText("example.com")).not.toHaveLength(0);
    expect(document.querySelector(".lyra-login-manager-detail")).toBeNull();
    expect(document.querySelector(".lyra-login-manager-embedded-list")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open site" }));
    expect(onOpenSite).toHaveBeenCalledWith("https://example.com/login", "Example");

    fireEvent.click(screen.getByRole("button", { name: "Log out site" }));
    await waitFor(() => {
      expect(clearSite).toHaveBeenCalledWith({
        sessionId: "https://example.com"
      });
    });
    await waitFor(() => {
      expect(clearSiteData).toHaveBeenCalledWith({
        origin: "https://example.com"
      });
    });
  });

  test("keeps saved password actions behind explicit user controls", async () => {
    const {
      api,
      deleteCredential,
      fillCredential,
      revealCredential
    } = createDesktopApi();
    render(
      <LoginManagerSurface
        desktopApi={api}
        labels={createLabels()}
        onOpenSite={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("tab", { name: "Passwords" }));
    expect(await screen.findAllByText("alice@example.com")).not.toHaveLength(0);
    expect(screen.queryByText("super-secret-password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fill" }));
    await waitFor(() => {
      expect(fillCredential).toHaveBeenCalledWith({
        credentialId: "credential-example",
        reason: "user-fill"
      });
    });
    expect(revealCredential).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(await screen.findByText("super-secret-password")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("super-secret-password");
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete password" }));
    await waitFor(() => {
      expect(deleteCredential).toHaveBeenCalledWith({
        credentialId: "credential-example"
      });
    });
  });
});
