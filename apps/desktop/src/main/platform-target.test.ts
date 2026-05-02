import { describe, expect, test } from "vitest";

import { resolveDesktopTarget } from "./platform-target";

describe("desktop platform target resolver", () => {
  test("marks macOS and Windows arm64 as tier1 packaged targets", () => {
    expect(resolveDesktopTarget({ platform: "darwin", arch: "arm64" }).id).toBe("darwin-arm64");
    expect(resolveDesktopTarget({ platform: "darwin", arch: "arm64" }).supportTier).toBe("tier1");
    expect(resolveDesktopTarget({ platform: "win32", arch: "arm64" }).id).toBe("win32-arm64");
    expect(resolveDesktopTarget({ platform: "win32", arch: "arm64" }).rustTargetTriple).toBe("aarch64-pc-windows-msvc");
  });

  test("detects Linux glibc and musl as separate support modes", () => {
    const glibc = resolveDesktopTarget({
      platform: "linux",
      arch: "x64",
      report: {
        getReport: () => ({ header: { glibcVersionRuntime: "2.39" } }),
      },
    });
    expect(glibc.id).toBe("linux-x64");
    expect(glibc.libc).toBe("glibc");
    expect(glibc.supportTier).toBe("tier1");
    expect(glibc.rustTargetTriple).toBe("x86_64-unknown-linux-gnu");

    const musl = resolveDesktopTarget({
      platform: "linux",
      arch: "arm64",
      env: { LYRA_LINUX_LIBC: "musl" },
    });
    expect(musl.id).toBe("linux-arm64");
    expect(musl.libc).toBe("musl");
    expect(musl.supportTier).toBe("tier2");
    expect(musl.rustTargetTriple).toBe("aarch64-unknown-linux-musl");
  });

  test("keeps long-tail architectures explicit but best effort", () => {
    const target = resolveDesktopTarget({
      platform: "linux",
      arch: "riscv64" as NodeJS.Architecture,
      report: {
        getReport: () => ({ header: { glibcVersionRuntime: "2.39" } }),
      },
    });
    expect(target.id).toBe("linux-riscv64");
    expect(target.supportTier).toBe("tier2");
    expect(target.rustTargetTriple).toBe("riscv64gc-unknown-linux-gnu");
  });
});
