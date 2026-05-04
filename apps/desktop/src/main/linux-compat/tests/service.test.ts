import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { createLinuxCompatBridge, resolveLinuxCompatPlan } from "../service";

const baseEnv = (): NodeJS.ProcessEnv => ({
  XDG_SESSION_TYPE: "wayland",
  WAYLAND_DISPLAY: "wayland-0",
  DISPLAY: ":1",
  XDG_CURRENT_DESKTOP: "KDE"
});

const ubuntuRelease = [
  "ID=ubuntu",
  "VERSION_ID=\"24.04\"",
  "ID_LIKE=\"debian\""
].join("\n");

const withLinuxRecoveryEnvRestore = (testBody: () => void): void => {
  const previousRecovery = process.env.LYRA_LINUX_RECOVERY;
  const previousAutoRestart = process.env.LYRA_LINUX_AUTO_RESTART;
  try {
    testBody();
  } finally {
    if (previousRecovery === undefined) {
      delete process.env.LYRA_LINUX_RECOVERY;
    } else {
      process.env.LYRA_LINUX_RECOVERY = previousRecovery;
    }
    if (previousAutoRestart === undefined) {
      delete process.env.LYRA_LINUX_AUTO_RESTART;
    } else {
      process.env.LYRA_LINUX_AUTO_RESTART = previousAutoRestart;
    }
  }
};

describe("linux compat resolver", () => {
  test("defaults to reliable startup when both display servers are present", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv(),
      osReleaseText: ubuntuRelease
    });

    expect(plan.enabled).toBe(true);
    expect(plan.profile).toBe("reliable");
    expect(plan.backend).toBe("x11");
    expect(plan.gpuMode).toBe("software");
    expect(plan.appliedEnv.LYRA_LINUX_PACKAGE_TYPE).toBe("unknown");
    expect(plan.appliedSwitches["ozone-platform"]).toBe("x11");
    expect(plan.facts.distributionId).toBe("ubuntu");
    expect(plan.facts.distributionVersion).toBe("24.04");
    expect(plan.facts.distributionLike).toEqual(["debian"]);
  });

  test("uses native profile to prefer wayland on a wayland session", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv(),
      config: {
        version: 1,
        profile: "native",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      osReleaseText: ubuntuRelease
    });

    expect(plan.profile).toBe("native");
    expect(plan.backend).toBe("wayland");
    expect(plan.profileSource).toBe("config");
  });

  test("supports explicit backend override via argv", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra", "--lyra-backend=x11"],
      env: baseEnv()
    });

    expect(plan.backend).toBe("x11");
    expect(plan.backendSource).toBe("cli");
    expect(plan.appliedSwitches["ozone-platform"]).toBe("x11");
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

  test("recovery mode forces reliable software startup", () => {
    const plan = resolveLinuxCompatPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        ...baseEnv(),
        LYRA_LINUX_RECOVERY: "1",
        LYRA_LINUX_LAUNCH_ID: "launch-1"
      },
      config: {
        version: 1,
        profile: "performance",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    });

    expect(plan.recovery.active).toBe(true);
    expect(plan.recovery.launchId).toBe("launch-1");
    expect(plan.profile).toBe("reliable");
    expect(plan.profileSource).toBe("recovery");
    expect(plan.gpuMode).toBe("software");
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

  test("manual restart uses stored profile instead of forcing reliable args", () => {
    withLinuxRecoveryEnvRestore(() => {
      const storageRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-linux-compat-"));
      const relaunch = vi.fn();
      const exit = vi.fn();
      const bridge = createLinuxCompatBridge({
        platform: "linux",
        argv: [
          "/opt/Lyra/Lyra",
          "--lyra-linux-profile=performance",
          "--lyra-linux-recovery",
          "--foo"
        ],
        env: baseEnv(),
        storageRoot
      });

      const response = bridge.requestRestart(
        { relaunch, exit } as unknown as Electron.App,
        { reason: "linux-compat-profile-change" }
      );

      expect(response.ok).toBe(true);
      const args = relaunch.mock.calls[0]?.[0]?.args as readonly string[];
      expect(args).toContain("--foo");
      expect(args.some((argument) => argument.startsWith("--lyra-linux-profile="))).toBe(false);
      expect(args).not.toContain("--lyra-linux-recovery");
      expect(args).toContain("--lyra-linux-restart-reason=linux-compat-profile-change");
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  test("recovery restart keeps recovery marker without overriding future profile config", () => {
    withLinuxRecoveryEnvRestore(() => {
      const relaunch = vi.fn();
      const bridge = createLinuxCompatBridge({
        platform: "linux",
        argv: ["/opt/Lyra/Lyra", "--lyra-linux-profile=native"],
        env: baseEnv()
      });

      const response = bridge.requestRestart(
        { relaunch, exit: vi.fn() } as unknown as Electron.App,
        { recovery: true, reason: "renderer-startup-crashed-1" }
      );

      expect(response.ok).toBe(true);
      const args = relaunch.mock.calls[0]?.[0]?.args as readonly string[];
      expect(args).toContain("--lyra-linux-recovery");
      expect(args.some((argument) => argument.startsWith("--lyra-linux-profile="))).toBe(false);
      expect(args).toContain("--lyra-linux-restart-reason=renderer-startup-crashed-1");
    });
  });
});
