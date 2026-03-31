import { describe, expect, test } from "vitest";

import { resolveLinuxCompatPlan } from "../service";

const baseEnv = (): NodeJS.ProcessEnv => ({
  XDG_SESSION_TYPE: "wayland",
  WAYLAND_DISPLAY: "wayland-0",
  DISPLAY: ":1",
  XDG_CURRENT_DESKTOP: "KDE"
});

describe("linux compat resolver", () => {
  test("prefers wayland backend when session is wayland", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv()
    });

    expect(plan.enabled).toBe(true);
    expect(plan.backend).toBe("wayland");
    expect(plan.gpuMode).toBe("hardware");
    expect(plan.appliedEnv.ELECTRON_OZONE_PLATFORM_HINT).toBe("wayland");
    expect(plan.appliedEnv.DISPLAY).toBe("");
  });

  test("supports explicit backend override via argv", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra", "--lyra-backend=x11"],
      env: baseEnv()
    });

    expect(plan.backend).toBe("x11");
    expect(plan.backendSource).toBe("cli");
    expect(plan.appliedEnv.ELECTRON_OZONE_PLATFORM_HINT).toBe("x11");
  });

  test("enables software mode in safe mode", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra", "--safe-mode"],
      env: baseEnv()
    });

    expect(plan.safeMode).toBe(true);
    expect(plan.gpuMode).toBe("software");
    expect(plan.disableHardwareAcceleration).toBe(true);
    expect(plan.appliedSwitches["disable-gpu"]).toBe("true");
  });

  test("disables linux compat outside linux", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "darwin",
      argv: ["lyra"],
      env: baseEnv()
    });

    expect(plan.enabled).toBe(false);
    expect(plan.appliedSwitches).toEqual({});
    expect(plan.appliedEnv).toEqual({});
  });
});
