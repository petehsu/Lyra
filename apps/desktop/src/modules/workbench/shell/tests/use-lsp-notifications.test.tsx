import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LspRuntimeEvent } from "../../../../shared/desktop-bridge";
import { useLspNotifications } from "../use-lsp-notifications";

describe("useLspNotifications", () => {
  it("publishes start, ready, and failure notifications for acquire events", () => {
    const publishNotification = vi.fn();
    const listenerRef: { current: ((event: LspRuntimeEvent) => void) | null } = {
      current: null
    };
    const desktopApi = {
      lsp: {
        onEvent: (callback: (event: LspRuntimeEvent) => void) => {
          listenerRef.current = callback;
          return () => {
            listenerRef.current = null;
          };
        }
      }
    };
    const t = ((key: string) => key) as never;

    renderHook(() =>
      useLspNotifications({
        desktopApi: desktopApi as never,
        publishNotification,
        t
      })
    );

    const listener = listenerRef.current;
    if (!listener) {
      throw new Error("lsp event listener was not registered");
    }

    listener({
      kind: "acquire",
      serverId: "gopls",
      status: "downloading",
      message: "Downloading gopls"
    });
    listener({
      kind: "acquire",
      serverId: "gopls",
      status: "completed",
      message: "gopls is ready"
    });
    listener({
      kind: "acquire",
      serverId: "zls",
      status: "failed",
      message: "no github asset"
    });

    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lsp-downloading-gopls",
        title: "lsp.startedTitle",
        level: "info",
        source: expect.objectContaining({ id: "lsp", iconKey: "file-editor" })
      })
    );
    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lsp-completed-gopls",
        title: "lsp.completedTitle",
        level: "success"
      })
    );
    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lsp-failed-zls",
        title: "lsp.failedTitle",
        level: "error"
      })
    );
  });

  it("publishes a ready notification when a local language server starts without downloading", () => {
    const publishNotification = vi.fn();
    const listenerRef: { current: ((event: LspRuntimeEvent) => void) | null } = {
      current: null
    };
    const desktopApi = {
      lsp: {
        onEvent: (callback: (event: LspRuntimeEvent) => void) => {
          listenerRef.current = callback;
          return () => {
            listenerRef.current = null;
          };
        }
      }
    };
    const t = ((key: string) => key) as never;

    renderHook(() =>
      useLspNotifications({
        desktopApi: desktopApi as never,
        publishNotification,
        t
      })
    );

    const listener = listenerRef.current;
    if (!listener) {
      throw new Error("lsp event listener was not registered");
    }

    listener({
      kind: "server-status",
      serverId: "rust",
      languageId: "rust",
      status: "starting"
    });
    listener({
      kind: "server-status",
      serverId: "rust",
      languageId: "rust",
      status: "ready"
    });
    listener({
      kind: "server-status",
      serverId: "rust",
      languageId: "rust",
      status: "ready"
    });

    expect(publishNotification).toHaveBeenCalledTimes(1);
    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lsp-ready-rust",
        title: "lsp.completedTitle",
        level: "success",
        source: expect.objectContaining({ id: "lsp", iconKey: "file-editor" })
      })
    );
  });

  it("treats toolchain stderr as a workspace warning, not Language server failed", () => {
    const publishNotification = vi.fn();
    const listenerRef: { current: ((event: LspRuntimeEvent) => void) | null } = {
      current: null
    };
    const desktopApi = {
      lsp: {
        onEvent: (callback: (event: LspRuntimeEvent) => void) => {
          listenerRef.current = callback;
          return () => {
            listenerRef.current = null;
          };
        }
      }
    };
    const t = ((key: string) => key) as never;

    renderHook(() =>
      useLspNotifications({
        desktopApi: desktopApi as never,
        publishNotification,
        t
      })
    );

    const listener = listenerRef.current;
    if (!listener) {
      throw new Error("lsp event listener was not registered");
    }

    listener({
      kind: "server-status",
      serverId: "rust",
      languageId: "rust",
      status: "ready"
    });
    listener({
      kind: "server-status",
      serverId: "rust",
      languageId: "rust",
      status: "workspace",
      message: "rustc --print cfg: toolchain is not installed"
    });

    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "lsp-workspace-rust",
        title: "lsp.notificationSource",
        level: "warning"
      })
    );
    expect(publishNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: "lsp.failedTitle"
      })
    );
  });

  it("does not toast diagnostics; VS Code puts them on DiagnosticCollection", () => {
    const publishNotification = vi.fn();
    const listenerRef: { current: ((event: LspRuntimeEvent) => void) | null } = {
      current: null
    };
    const desktopApi = {
      lsp: {
        onEvent: (callback: (event: LspRuntimeEvent) => void) => {
          listenerRef.current = callback;
          return () => {
            listenerRef.current = null;
          };
        }
      }
    };
    const t = ((key: string) => key) as never;

    renderHook(() =>
      useLspNotifications({
        desktopApi: desktopApi as never,
        publishNotification,
        t
      })
    );

    const listener = listenerRef.current;
    if (!listener) {
      throw new Error("lsp event listener was not registered");
    }

    const diagnostic = {
      filePath: "/work/Lyra/apps/desktop/tsconfig.json",
      severity: 1,
      message: "Option 'baseUrl' is deprecated",
      startLine: 12,
      startCharacter: 4,
      endLine: 12,
      endCharacter: 13
    };
    listener({
      kind: "diagnostics",
      filePath: diagnostic.filePath,
      diagnostics: [diagnostic]
    });
    listener({
      kind: "diagnostics",
      filePath: "/work/Lyra/src/file.ts",
      diagnostics: [{
        filePath: "/work/Lyra/src/file.ts",
        severity: 1,
        message: "Relative import paths need explicit file extensions",
        startLine: 0,
        startCharacter: 0,
        endLine: 0,
        endCharacter: 1
      }]
    });

    expect(publishNotification).not.toHaveBeenCalled();
  });
});
