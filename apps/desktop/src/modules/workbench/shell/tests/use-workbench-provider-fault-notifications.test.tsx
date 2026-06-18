import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentRuntimeEvent } from "../../../../shared/agent";
import { useWorkbenchProviderFaultNotifications } from "../use-workbench-provider-fault-notifications";

describe("useWorkbenchProviderFaultNotifications", () => {
  it("publishes a deduped notification for providerFault events", () => {
    const publishNotification = vi.fn();
    let listener: ((event: AgentRuntimeEvent) => void) | null = null;
    const desktopApi = {
      agent: {
        onEvent: (callback: (event: AgentRuntimeEvent) => void) => {
          listener = callback;
          return () => {
            listener = null;
          };
        }
      }
    };

    const t = ((key: string) => key) as never;

    renderHook(() =>
      useWorkbenchProviderFaultNotifications({
        desktopApi: desktopApi as never,
        notificationModel: { publishNotification } as never,
        publishNotification,
        t
      })
    );

    listener?.({
      kind: "providerFault",
      sessionId: "session-1",
      turnId: "turn-1",
      fault: {
        httpStatus: 402,
        code: "insufficient_balance",
        category: "balance",
        providerId: "mimo_token_plan_sgp",
        modelId: "mimo-v2.5-pro",
        dedupeKey: "mimo-fault-402-mimo_token_plan_sgp",
        titleKey: "notification.mimoFault402Title",
        bodyKey: "notification.mimoFault402Body"
      }
    });

    expect(publishNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mimo-fault-402-mimo_token_plan_sgp",
        title: "notification.mimoFault402Title",
        level: "error",
        source: expect.objectContaining({ id: "mimo-provider" })
      })
    );
  });
});