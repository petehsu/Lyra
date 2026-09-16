import { describe, expect, test } from "vitest";

import {
  COMPLETE_STATUS,
  elideInstallPath,
  formatPercent,
  formatSpeedBps,
  hasInstalledRelease,
  isIndeterminateProgress,
  parsePromoVideoUrl,
  progressFraction,
  readInstallerForceFromSearch,
  resolveInstallerChannel,
  shouldRunInstaller,
  SpeedEstimator,
  statusPoolForProgress
} from "./installer-copy";

describe("installer copy", () => {
  test("packaged first launch without components shows the installer", () => {
    expect(shouldRunInstaller({
      isPackaged: true,
      force: false,
      hasCompletedMarker: false,
      hasInstalledRelease: false
    })).toBe(true);
  });

  test("dev launches skip the installer unless forced", () => {
    expect(shouldRunInstaller({
      isPackaged: false,
      force: false,
      hasCompletedMarker: false,
      hasInstalledRelease: false
    })).toBe(false);
    expect(shouldRunInstaller({
      isPackaged: false,
      force: true,
      hasCompletedMarker: true,
      hasInstalledRelease: true
    })).toBe(true);
  });

  test("an existing release or completion marker skips the installer", () => {
    expect(shouldRunInstaller({
      isPackaged: true,
      force: false,
      hasCompletedMarker: true,
      hasInstalledRelease: false
    })).toBe(false);
    expect(shouldRunInstaller({
      isPackaged: true,
      force: false,
      hasCompletedMarker: false,
      hasInstalledRelease: true
    })).toBe(false);
  });

  test("installed release is any active component pointer", () => {
    expect(hasInstalledRelease([])).toBe(false);
    expect(hasInstalledRelease([{
      componentId: "lyra.runtime",
      kind: "runtime",
      versions: []
    }])).toBe(false);
    expect(hasInstalledRelease([{
      componentId: "lyra.runtime",
      kind: "runtime",
      active: "0.1.0",
      versions: []
    }])).toBe(true);
  });

  test("preview versions use the preview channel", () => {
    expect(resolveInstallerChannel("0.1.0-preview.15")).toBe("preview");
    expect(resolveInstallerChannel("1.0.0")).toBe("stable");
    expect(readInstallerForceFromSearch("?installer=1")).toBe(true);
    expect(readInstallerForceFromSearch("")).toBe(false);
  });

  test("status pools stay English and rotate by phase", () => {
    const idle = statusPoolForProgress(null, false, false, false);
    expect(idle.length).toBeGreaterThan(1);
    for (const line of idle) {
      expect(line).toBe(line.replace(/[^\x00-\x7F]/gu, ""));
    }
    expect(statusPoolForProgress(null, false, false, true)[0]).toBe(COMPLETE_STATUS);
    const download = statusPoolForProgress({
      phase: "download",
      componentId: "lyra.runtime",
      completed: 10,
      total: 100,
      completedComponents: 0,
      totalComponents: 4
    }, true, false, false);
    expect(download.some((line) => line.includes("lyra.runtime"))).toBe(true);
    expect(statusPoolForProgress({
      phase: "cleanup",
      componentId: "process",
      completed: 0,
      total: 8,
      completedComponents: 0,
      totalComponents: 8
    }, false, false, false, true)[0]).toMatch(/Stopping/u);
    const cleanup = statusPoolForProgress({
      phase: "cleanup",
      componentId: "cache-v1",
      completed: 2,
      total: 8,
      completedComponents: 2,
      totalComponents: 8
    }, false, false, false, true);
    expect(cleanup.some((line) => /cache|staged|leftover|registry|temporary/iu.test(line))).toBe(true);
  });

  test("progress metrics match the installer copy", () => {
    expect(formatSpeedBps(800)).toBe("800 B/s");
    expect(formatPercent(0.372)).toBe("37%");
    expect(progressFraction({
      phase: "download",
      completed: 25,
      total: 100,
      completedComponents: 0,
      totalComponents: 1
    })).toBe(0.25);
    expect(isIndeterminateProgress(true, null)).toBe(true);
    const path = String.raw`D:\Very\Long\Windows\Path\Lyra`;
    const elided = elideInstallPath(path, 18);
    expect(elided.startsWith("D")).toBe(true);
    expect(elided.endsWith("Lyra")).toBe(true);
    expect(elided.includes("…")).toBe(true);
    const estimator = new SpeedEstimator();
    expect(estimator.update(0, 0)).toBe(0);
    expect(estimator.update(1_024_000, 1_000)).toBeGreaterThan(900_000);
  });

  test("promo manifest requires a credential-free HTTPS video", () => {
    expect(parsePromoVideoUrl({
      videoUrl: "https://example.supabase.co/storage/v1/object/public/installer/promotional.mp4",
      updatedAt: "2026-09-16T01:16:00Z"
    })).toBe("https://example.supabase.co/storage/v1/object/public/installer/promotional.mp4");
    expect(parsePromoVideoUrl({
      videoUrl: "https://example.supabase.co/storage/v1/object/public/installer/promotional.mp4?v=20260916T120000Z"
    })).toBe("https://example.supabase.co/storage/v1/object/public/installer/promotional.mp4?v=20260916T120000Z");
    expect(() => parsePromoVideoUrl({ videoUrl: "http://example.test/video.mp4" })).toThrow();
    expect(() => parsePromoVideoUrl({
      videoUrl: "https://user:pass@example.test/video.mp4"
    })).toThrow();
  });
});
