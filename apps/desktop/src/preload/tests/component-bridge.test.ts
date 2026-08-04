import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  LYRA_CHANNELS,
  type ComponentUpdateProgress
} from "../../shared/desktop-bridge";

const electronMock = vi.hoisted(() => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

vi.mock("electron", () => electronMock);

import { createComponentsBridgeApi } from "../bridges/component-bridge";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("component preload bridge", () => {
  test("forwards component update requests through their narrow IPC channels", async () => {
    const api = createComponentsBridgeApi().components;
    const request = {
      channel: "preview" as const,
      releaseVersion: "0.2.0"
    };
    const activation = {
      componentId: "lyra.core",
      confirmedReasons: ["permission-increase" as const]
    };

    await api.stageUpdate(request);
    await api.cancelUpdate();
    await api.readCoreProjectionStatus();
    await api.applyCore(activation);

    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LYRA_CHANNELS.componentsStageUpdate,
      request
    );
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LYRA_CHANNELS.componentsCancelUpdate
    );
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
      LYRA_CHANNELS.componentsCoreProjectionStatus
    );
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      4,
      LYRA_CHANNELS.componentsApplyCore,
      activation
    );
  });

  test("subscribes and removes the exact progress listener", () => {
    const api = createComponentsBridgeApi().components;
    const listener = vi.fn();
    const progress: ComponentUpdateProgress = {
      phase: "download",
      completed: 10,
      total: 20,
      completedComponents: 1,
      totalComponents: 2
    };

    const dispose = api.onUpdateProgress(listener);
    const wrappedListener = electronMock.ipcRenderer.on.mock.calls[0]?.[1] as
      | ((_event: unknown, value: ComponentUpdateProgress) => void)
      | undefined;
    expect(electronMock.ipcRenderer.on).toHaveBeenCalledWith(
      LYRA_CHANNELS.componentsUpdateProgress,
      expect.any(Function)
    );

    wrappedListener?.({}, progress);
    expect(listener).toHaveBeenCalledWith(progress);

    dispose();
    expect(electronMock.ipcRenderer.removeListener).toHaveBeenCalledWith(
      LYRA_CHANNELS.componentsUpdateProgress,
      wrappedListener
    );
  });
});
