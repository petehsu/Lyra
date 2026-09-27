import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AgentRuntimeEvent } from "../../../../shared/agent";
import { buildProviderRouteNotification, useWorkbenchProviderFaultNotifications } from "../use-workbench-provider-fault-notifications";

describe("useWorkbenchProviderFaultNotifications", () => {
  it("publishes a deduped notification for providerFault events", () => {
    const publishNotification = vi.fn();
    const listenerRef: { current: ((event: AgentRuntimeEvent) => void) | null } = {
      current: null
    };
    const desktopApi = {
      agent: {
        onEvent: (callback: (event: AgentRuntimeEvent) => void) => {
          listenerRef.current = callback;
          return () => {
            listenerRef.current = null;
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

    const listener = listenerRef.current;
    if (!listener) {
      throw new Error("provider event listener was not registered");
    }
    listener({
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


it("formats verified route changes for the unified notification publisher", () => {
  const t = ((key: string, values?: Record<string, unknown>) =>
    key === "notification.providerRouteAdjustedTitle" ? "MiMo connection updated"
      : `${values?.from} → ${values?.to}`) as never;
  expect(buildProviderRouteNotification({
    profileId: "my-account", fromRouteId: "mimo", fromLabel: "MiMo OpenAI",
    toRouteId: "mimo_token_plan_cn", toLabel: "MiMo Token Plan (CN, OpenAI)",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  }, t)).toEqual({
    title: "MiMo connection updated",
    preview: "MiMo OpenAI → MiMo Token Plan (CN, OpenAI)",
    level: "success",
    source: { id: "provider-settings", title: "MiMo", iconKey: "system" },
    target: { kind: "none" },
  });
});
