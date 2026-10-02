import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  createLinuxCompatBridge,
  inferX11Display,
  pickCompositorGpu,
  resolveLinuxCompatPlan
} from "../service";
import type { LinuxGpuFacts, LinuxGpuVendor } from "../types";

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

const gpuFacts = (
  vendor: LinuxGpuVendor,
  extra: Partial<Pick<LinuxGpuFacts, "isHybrid" | "vendors" | "preferredRenderNode" | "deviceCount">> = {}
): LinuxGpuFacts => {
  const vendors = extra.vendors ?? [vendor];
  return {
    vendor,
    deviceCount: extra.deviceCount ?? vendors.length,
    hasDiscreteGpu: vendors.includes("nvidia") || vendors.includes("amd"),
    driverHint: null,
    hardwareAccelerationEnabled: null,
    featureStatus: null,
    vendors,
    isHybrid: extra.isHybrid ?? false,
    preferredRenderNode: extra.preferredRenderNode ?? null
  };
};

const isolatedPlan = (
  input: Parameters<typeof resolveLinuxCompatPlan>[0]
): ReturnType<typeof resolveLinuxCompatPlan> =>
  resolveLinuxCompatPlan({
    ...input,
    x11Sockets: input.x11Sockets ?? [],
    gpu: input.gpu ?? gpuFacts("unknown")
  });

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
  test("picks the compositor GPU on hybrid NVIDIA laptops", () => {
    expect(pickCompositorGpu(["nvidia", "intel"])).toEqual({ vendor: "intel", isHybrid: true });
    expect(pickCompositorGpu(["amd", "nvidia"])).toEqual({ vendor: "amd", isHybrid: true });
    expect(pickCompositorGpu(["nvidia"])).toEqual({ vendor: "nvidia", isHybrid: false });
  });

  test("recovers X11 from the XWayland socket when DISPLAY was stripped", () => {
    expect(inferX11Display(undefined, ["X0"])).toBe(":0");
    expect(inferX11Display(":1", ["X0"])).toBe(":1");
    expect(inferX11Display(undefined, [])).toBeNull();
  });

  test("keeps native wayland on a wayland session without input-method signals", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv(),
      osReleaseText: ubuntuRelease
    });

    expect(plan.enabled).toBe(true);
    expect(plan.profile).toBe("reliable");
    expect(plan.backend).toBe("wayland");
    expect(plan.displayBackendReason).toBe("wayland-default");
    expect(plan.inputMethod).toBe("none");
    expect(plan.gpuMode).toBe("software");
    expect(plan.appliedEnv.LYRA_LINUX_PACKAGE_TYPE).toBe("unknown");
    expect(plan.appliedEnv.GTK_IM_MODULE).toBeUndefined();
    expect(plan.appliedEnv.XMODIFIERS).toBeUndefined();
    expect(plan.appliedSwitches["ozone-platform"]).toBe("wayland");
    expect(plan.facts.distributionId).toBe("ubuntu");
    expect(plan.facts.distributionVersion).toBe("24.04");
    expect(plan.facts.distributionLike).toEqual(["debian"]);
  });

  test("hyprland + fcitx5 auto-selects xwayland compatibility with the input-method env", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        ...baseEnv(),
        XDG_CURRENT_DESKTOP: "Hyprland"
      },
      processNames: ["hyprland", "fcitx5", "dunst"],
      osReleaseText: ubuntuRelease
    });

    expect(plan.backend).toBe("x11");
    expect(plan.displayBackendReason).toBe("wayland-ime-candidate-position-compat");
    expect(plan.inputMethod).toBe("fcitx5");
    expect(plan.appliedSwitches["ozone-platform"]).toBe("x11");
    expect(plan.appliedEnv.GTK_IM_MODULE).toBe("fcitx");
    expect(plan.appliedEnv.XMODIFIERS).toBe("@im=fcitx");
    // QT_IM_MODULE is deliberately not injected.
    expect(plan.appliedEnv.QT_IM_MODULE).toBeUndefined();
  });

  test("fcitx5 detected without env vars still routes hyprland to xwayland", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        XDG_SESSION_TYPE: "wayland",
        WAYLAND_DISPLAY: "wayland-1",
        DISPLAY: ":0",
        XDG_CURRENT_DESKTOP: "Hyprland"
      },
      processNames: ["fcitx5"],
      osReleaseText: ubuntuRelease
    });

    expect(plan.inputMethod).toBe("fcitx5");
    expect(plan.backend).toBe("x11");
    expect(plan.displayBackendReason).toBe("wayland-ime-candidate-position-compat");
  });

  test("unknown wayland compositor + fcitx5 takes the conservative xwayland path", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        ...baseEnv(),
        XDG_CURRENT_DESKTOP: "wlroots"
      },
      processNames: ["fcitx5"],
      osReleaseText: ubuntuRelease
    });

    expect(plan.facts.desktop).toBe("wlroots");
    expect(plan.backend).toBe("x11");
    expect(plan.displayBackendReason).toBe("wayland-ime-candidate-position-compat");
  });

  test("LYRA_DISPLAY_BACKEND forces the backend and reports the override", () => {
    const waylandPlan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: { ...baseEnv(), XDG_CURRENT_DESKTOP: "Hyprland", LYRA_DISPLAY_BACKEND: "wayland" },
      processNames: ["fcitx5"],
      osReleaseText: ubuntuRelease
    });
    expect(waylandPlan.backend).toBe("wayland");
    expect(waylandPlan.displayBackendReason).toBe("user-override");
    expect(waylandPlan.backendSource).toBe("env");
    expect(waylandPlan.appliedSwitches["ozone-platform"]).toBe("wayland");

    const xwaylandPlan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: { ...baseEnv(), XDG_CURRENT_DESKTOP: "KDE", LYRA_DISPLAY_BACKEND: "xwayland" },
      processNames: [],
      osReleaseText: ubuntuRelease
    });
    expect(xwaylandPlan.backend).toBe("x11");
    expect(xwaylandPlan.displayBackendReason).toBe("user-override");
    expect(xwaylandPlan.appliedSwitches["ozone-platform"]).toBe("x11");
  });

  test("an invalid LYRA_DISPLAY_BACKEND warns and falls back to auto", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: { ...baseEnv(), LYRA_DISPLAY_BACKEND: "max-vibrancy" },
      osReleaseText: ubuntuRelease
    });

    expect(plan.backend).toBe("wayland");
    expect(plan.displayBackendReason).toBe("wayland-default");
    expect(plan.warnings.some((warning) => warning.code === "invalid-display-backend-override")).toBe(true);
  });

  test("explicit ozone argv overrides keep the automatic switches off", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra", "--ozone-platform=wayland"],
      env: {
        ...baseEnv(),
        XDG_CURRENT_DESKTOP: "Hyprland",
        GTK_IM_MODULE: "fcitx",
        XMODIFIERS: "@im=fcitx"
      },
      processNames: ["fcitx5"],
      osReleaseText: ubuntuRelease
    });

    expect(plan.appliedSwitches["ozone-platform"]).toBeUndefined();
    expect(plan.inputMethod).toBe("fcitx5");
  });


  test("uses native profile to prefer wayland on a wayland session", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv(),
      config: {
        version: 1,
        profile: "native",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      osReleaseText: ubuntuRelease,
      gpu: gpuFacts("intel")
    });

    expect(plan.profile).toBe("native");
    expect(plan.backend).toBe("wayland");
    expect(plan.profileSource).toBe("config");
    expect(plan.appliedSwitches["enable-wayland-ime"]).toBe("true");
  });

  test("supports explicit backend override via argv", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra", "--lyra-backend=x11"],
      env: baseEnv()
    });

    expect(plan.backend).toBe("x11");
    expect(plan.backendSource).toBe("cli");
    expect(plan.appliedSwitches["ozone-platform"]).toBe("x11");
  });

  test("enables software mode in safe mode", () => {
    const plan = isolatedPlan({
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
    const plan = isolatedPlan({
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
    const plan = isolatedPlan({
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

  test("hybrid NVIDIA+Intel Wayland native uses the iGPU instead of software NVIDIA fallback", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        XDG_SESSION_TYPE: "wayland",
        WAYLAND_DISPLAY: "wayland-0",
        XDG_CURRENT_DESKTOP: "ubuntu:GNOME"
      },
      config: {
        version: 1,
        profile: "native",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      osReleaseText: ubuntuRelease,
      gpu: gpuFacts("intel", {
        isHybrid: true,
        vendors: ["intel", "nvidia"],
        preferredRenderNode: "/dev/dri/renderD128",
        deviceCount: 2
      }),
      x11Sockets: ["X0"]
    });

    expect(plan.profile).toBe("native");
    expect(plan.recommendedProfile).toBe("native");
    expect(plan.backend).toBe("wayland");
    expect(plan.gpuMode).toBe("hardware");
    expect(plan.appliedSwitches["render-node-override"]).toBe("/dev/dri/renderD128");
    expect(plan.appliedSwitches["disable-gpu-sandbox"]).toBe("true");
    expect(plan.appliedSwitches["disable-gpu"]).toBeUndefined();
    expect(plan.appliedEnv.GBM_BACKEND).toBeUndefined();
    expect(plan.appliedEnv.DISPLAY).toBe(":0");
  });

  test("NVIDIA-only Wayland native keeps hardware and disables the GPU sandbox", () => {
    const plan = isolatedPlan({
      platform: "linux",
      argv: ["lyra"],
      env: {
        XDG_SESSION_TYPE: "wayland",
        WAYLAND_DISPLAY: "wayland-0",
        XDG_CURRENT_DESKTOP: "GNOME"
      },
      config: {
        version: 1,
        profile: "native",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      gpu: gpuFacts("nvidia", {
        preferredRenderNode: "/dev/dri/renderD129"
      })
    });

    expect(plan.backend).toBe("wayland");
    expect(plan.gpuMode).toBe("hardware");
    expect(plan.appliedSwitches["disable-gpu-sandbox"]).toBe("true");
    expect(plan.appliedEnv.GBM_BACKEND).toBe("nvidia-drm");
    expect(plan.appliedEnv.__GLX_VENDOR_LIBRARY_NAME).toBe("nvidia");
  });

  test("successful window ready clears a stale renderer failure", () => {
    const storageRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-linux-compat-"));
    writeFileSync(
      path.join(storageRoot, "runtime-state.v1.json"),
      JSON.stringify({
        version: 1,
        lastFailureReason: "renderer-crashed-5",
        lastFailureAt: "2026-09-13T13:49:14.352Z"
      }),
      "utf8"
    );
    const bridge = createLinuxCompatBridge({
      platform: "linux",
      argv: ["lyra"],
      env: baseEnv(),
      storageRoot
    });

    expect(bridge.status.recovery.previousFailureReason).toBe("renderer-crashed-5");
    bridge.markWindowReady();
    expect(bridge.status.recovery.previousFailureReason).toBeNull();
    expect(bridge.status.warnings.some((warning) => warning.code === "previous-launch-failed")).toBe(false);
    const state = JSON.parse(
      readFileSync(path.join(storageRoot, "runtime-state.v1.json"), "utf8")
    ) as { readonly lastFailureReason?: string };
    expect(state.lastFailureReason).toBeUndefined();
  });

  test("software GPU probe errors are not recorded as launch failures", async () => {
    const storageRoot = mkdtempSync(path.join(os.tmpdir(), "lyra-linux-compat-"));
    const bridge = createLinuxCompatBridge({
      platform: "linux",
      argv: ["lyra", "--disable-gpu"],
      env: baseEnv(),
      storageRoot
    });

    await bridge.captureGpuSnapshot({
      getGPUFeatureStatus: () => ({}),
      isHardwareAccelerationEnabled: () => false,
      getGPUInfo: async () => {
        throw new Error(
          "GPU access not allowed. Reason: GPU access is disabled through commandline switch --disable-gpu and --disable-software-rasterizer."
        );
      }
    } as unknown as Electron.App);

    expect(bridge.status.gpuMode).toBe("software");
    const statePath = path.join(storageRoot, "runtime-state.v1.json");
    expect(
      existsSync(statePath)
        ? (JSON.parse(readFileSync(statePath, "utf8")) as { readonly lastFailureReason?: string })
          .lastFailureReason
        : undefined
    ).toBeUndefined();
  });
});
