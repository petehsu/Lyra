import { beforeEach, describe, expect, test, vi } from "vitest";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";

const electronMock = vi.hoisted(() => ({
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  }
}));

vi.mock("electron", () => electronMock);

import { createProductUninstallBridgeApi } from "../bridges/product-uninstall-bridge";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("product uninstall preload bridge", () => {
  test("forwards uninstall and registration through their IPC channels", async () => {
    const api = createProductUninstallBridgeApi().productUninstall;
    await api.run({ removeUserData: true });
    await api.registerEntry();
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      LYRA_CHANNELS.appUninstallProduct,
      { removeUserData: true }
    );
    expect(electronMock.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      LYRA_CHANNELS.appRegisterUninstall
    );
  });
});
