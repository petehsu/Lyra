import { afterEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  getVersion: vi.fn(() => "1.2.3"),
  getLocale: vi.fn(() => "en-US"),
  isPackaged: false
}));

const osMock = vi.hoisted(() => ({
  hostname: vi.fn(() => "Test-Mac"),
  userInfo: vi.fn(() => ({ username: "alex" }))
}));

vi.mock("electron", () => ({
  app: electronMock
}));

vi.mock("node:os", () => ({
  hostname: osMock.hostname,
  userInfo: osMock.userInfo
}));

import { readHostPersonaContextPayload } from "../host-persona-context";
import { createWorkbenchStateMock } from "./workbench-state-mock";

afterEach(() => {
  osMock.hostname.mockReturnValue("Test-Mac");
  osMock.userInfo.mockImplementation(() => ({ username: "alex" }));
  delete process.env.USER;
  delete process.env.USERNAME;
});

describe("readHostPersonaContextPayload", () => {
  test("includes location when consent is granted", () => {
    const workbenchState = createWorkbenchStateMock({
      readState: vi.fn(() =>
        JSON.stringify({
          consent: "granted",
          fix: { displayName: "Shanghai, China" }
        })
      )
    });

    const payload = readHostPersonaContextPayload(workbenchState);

    expect(payload.locationLabel).toBe("Shanghai, China");
    expect(payload.userName).toBe("alex");
    expect(payload.deviceSummary).toMatch(/^macOS · /);
    expect(payload.deviceSummary).toContain("Test-Mac");
    expect(payload.deviceSummary).toContain("Lyra 1.2.3");
    expect(payload.currentTime).toBeTypeOf("string");
    expect(payload.currentTime?.length).toBeGreaterThan(0);
  });

  test("omits location when consent is not granted", () => {
    const workbenchState = createWorkbenchStateMock({
      readState: vi.fn(() =>
        JSON.stringify({
          consent: "denied",
          fix: { displayName: "Shanghai, China" }
        })
      )
    });

    const payload = readHostPersonaContextPayload(workbenchState);

    expect(payload.locationLabel).toBeUndefined();
    expect(payload.userName).toBe("alex");
    expect(payload.deviceSummary).toContain("Test-Mac");
  });

  test("omits userName when user identity is unavailable", () => {
    osMock.userInfo.mockImplementation(() => {
      throw new Error("user info unavailable");
    });

    const payload = readHostPersonaContextPayload(createWorkbenchStateMock());

    expect(payload.userName).toBeUndefined();
    expect(payload.deviceSummary).toContain("Test-Mac");
    expect(payload.currentTime).toBeTypeOf("string");
  });
});