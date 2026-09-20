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

const personaMock = vi.hoisted(() => ({
  enabled: true
}));

vi.mock("electron", () => ({
  app: electronMock
}));

vi.mock("node:os", () => ({
  hostname: osMock.hostname,
  userInfo: osMock.userInfo
}));

vi.mock("../../persona/consent-service", () => ({
  readConsent: () => ({ osintEnabled: personaMock.enabled, grantedAt: null })
}));

import { readHostPersonaContextPayload } from "../host-persona-context";
import { createWorkbenchStateMock } from "./workbench-state-mock";

afterEach(() => {
  vi.clearAllMocks();
  osMock.hostname.mockReturnValue("Test-Mac");
  osMock.userInfo.mockImplementation(() => ({ username: "alex" }));
  personaMock.enabled = true;
  delete process.env.USER;
  delete process.env.USERNAME;
});

describe("readHostPersonaContextPayload", () => {
  test("does not inject workbench location state into Agent context", () => {
    const workbenchState = createWorkbenchStateMock({
      readState: vi.fn(() =>
        JSON.stringify({
          consent: "granted",
          fix: {
            displayName: "31.2304, 121.4737",
            address: { displayName: "Shanghai, China" }
          }
        })
      )
    });

    const payload = readHostPersonaContextPayload(workbenchState);

    expect(payload.locationLabel).toBeUndefined();
    expect(payload.userName).toBe("alex");
    expect(payload.deviceSummary).toBeTypeOf("string");
    expect(payload.deviceSummary).toContain("Test-Mac");
    expect(payload.deviceSummary).toContain("Lyra 1.2.3");
    expect(payload.currentTime).toBeTypeOf("string");
    expect(payload.currentTime?.length).toBeGreaterThan(0);
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

  test("does not read or return identity and device signals before consent", () => {
    personaMock.enabled = false;
    const payload = readHostPersonaContextPayload(createWorkbenchStateMock());

    expect(osMock.userInfo).not.toHaveBeenCalled();
    expect(osMock.hostname).not.toHaveBeenCalled();
    expect(payload.userName).toBeUndefined();
    expect(payload.deviceSummary).toBeUndefined();
    expect(payload.screen).toBeUndefined();
  });
});
