import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentModelCatalogSnapshot,
  AgentRuntimeEvent,
  AgentSessionListResponse,
  AgentSessionSnapshot
} from "../../../../shared/agent";
import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { useLyraAgentDataProvider } from "../use-lyra-agent-data-provider";

const emptyModelCatalog = (): AgentModelCatalogSnapshot => ({
  sessionId: null,
  currentModel: "mimo-v2.5-pro",
  currentProvider: "mimo",
  defaultModel: "mimo-v2.5-pro",
  defaultProvider: "mimo",
  models: [],
  routes: [],
  reasoningEffort: {
    current: null,
    options: [],
    supported: false
  },
  verbosity: {
    current: null,
    options: [],
    supported: false
  },
  serviceTier: {
    current: null,
    options: [],
    supported: false
  }
});

describe("useLyraAgentDataProvider", () => {
  test("removes a stale persisted session before readSession is invoked", async () => {
    const onMissingSession = vi.fn();
    const readSession = vi.fn<
      (request: { readonly sessionId: string }) => Promise<AgentSessionSnapshot>
    >();
    const listSessions = vi.fn<
      () => Promise<AgentSessionListResponse>
    >(async () => ({
      sessionsDir: "/tmp/lyra-agent-runtime/sessions",
      sessions: []
    }));
    const desktopApi = {
      agent: {
        onEvent: vi.fn((_: (event: AgentRuntimeEvent) => void) => () => undefined),
        createSession: vi.fn(),
        readSession,
        listSessions,
        listAgentModels: vi.fn(async () => emptyModelCatalog()),
        readBrowserFollowMode: vi.fn(async () => ({ enabled: false }))
      }
    } as unknown as LyraDesktopApi;

    const { result } = renderHook(() =>
      useLyraAgentDataProvider(
        desktopApi,
        undefined,
        "session-stale",
        null,
        true,
        { onMissingSession }
      )
    );

    await waitFor(() => {
      expect(onMissingSession).toHaveBeenCalledWith("session-stale");
    });

    expect(listSessions).toHaveBeenCalledWith({});
    expect(readSession).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
